"""Servers: create, read, update, delete, ownership, join/leave (FR-SRV-01..06, 09)."""

from unittest import mock

import pytest
from django.urls import reverse

from apps.chat_channels.models import Category, Channel
from apps.core.permissions import DEFAULT_EVERYONE, Perm
from apps.media.models import PendingUpload
from apps.servers.models import Member, Role, Server, Topic

pytestmark = pytest.mark.django_db


def test_create_server_seeds_roles_category_and_general(client_for, user):
    response = client_for(user).post(
        reverse("servers"), {"name": "  Study Group  ", "description": "hi"}
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["name"] == "Study Group"
    assert body["me"]["is_owner"] is True
    assert body["me"]["permissions"] == int(Perm(sum(Perm)))
    server = Server.objects.get(pk=body["id"])
    roles = {r.name: r for r in server.roles.all()}
    assert set(roles) == {"@everyone", "Moderator", "Admin"}
    assert roles["@everyone"].is_default and roles["@everyone"].permissions == int(DEFAULT_EVERYONE)
    assert roles["Admin"].permissions == int(Perm.ADMINISTRATOR)
    assert [c.name for c in Category.objects.filter(server=server)] == ["Text Channels"]
    assert [c.name for c in Channel.objects.filter(server=server)] == ["general"]
    assert server.member_count == 1


def test_create_requires_verified_email(client_for, unverified_user):
    response = client_for(unverified_user).post(reverse("servers"), {"name": "x"})
    assert response.status_code == 403
    assert response.json()["code"] == "email_not_verified"


@pytest.mark.parametrize("name", ["", "   ", "x" * 101])
def test_create_validation(client_for, user, name):
    assert client_for(user).post(reverse("servers"), {"name": name}).status_code == 400


def test_create_with_icon_and_topic(client_for, user, topics):
    PendingUpload.objects.create(user=user, public_id="test/server_icons/x", purpose="server_icon")
    topic = Topic.objects.get(slug="gaming")
    with mock.patch("cloudinary.api.resource", return_value={"bytes": 10, "format": "png"}):
        response = client_for(user).post(
            reverse("servers"),
            {
                "name": "Gamers",
                "icon_public_id": "test/server_icons/x",
                "topic_id": topic.pk,
                "is_public": True,
            },
        )
    assert response.status_code == 201, response.content
    assert "res.cloudinary.com" in response.json()["icon_url"]
    assert response.json()["topic"]["slug"] == "gaming"


def test_list_only_my_servers(client_for, user, make_user, server, join):
    other = make_user()
    from apps.servers.services import create_server

    create_server(owner=other, name="Not mine")
    assert [s["name"] for s in client_for(user).get(reverse("servers")).json()] == ["Test Server"]
    join(server, other)
    assert sorted(s["name"] for s in client_for(other).get(reverse("servers")).json()) == [
        "Not mine",
        "Test Server",
    ]


def test_non_members_get_404(client_for, make_user, server):
    outsider = client_for(make_user())
    assert outsider.get(reverse("server-detail", args=[server.pk])).status_code == 404
    assert outsider.get(reverse("server-channels", args=[server.pk])).status_code == 404
    assert outsider.get(reverse("server-members", args=[server.pk])).status_code == 404


def test_member_detail_shows_my_permissions(client_for, make_user, server, join):
    member = make_user()
    join(server, member)
    me = client_for(member).get(reverse("server-detail", args=[server.pk])).json()["me"]
    assert me == {
        "is_owner": False,
        "permissions": int(DEFAULT_EVERYONE),
        "role_ids": [],
        "nickname": "",
    }


def test_update_server_needs_manage_server(client_for, make_user, server, join):
    member = make_user()
    join(server, member)
    url = reverse("server-detail", args=[server.pk])
    assert client_for(member).patch(url, {"name": "Hacked"}).status_code == 403
    admin_role = Role.objects.get(server=server, name="Admin")
    Member.objects.get(server=server, user=member).roles.add(admin_role)
    response = client_for(member).patch(url, {"name": "Renamed", "is_public": True})
    assert response.status_code == 200
    assert response.json()["name"] == "Renamed" and response.json()["is_public"] is True


def test_only_owner_deletes(client_for, user, make_user, server, join):
    admin = make_user()
    join(server, admin)
    Member.objects.get(server=server, user=admin).roles.add(
        Role.objects.get(server=server, name="Admin")
    )
    url = reverse("server-detail", args=[server.pk])
    assert client_for(admin).delete(url).status_code == 403
    assert client_for(user).delete(url).status_code == 204
    assert not Server.objects.filter(pk=server.pk).exists()


def test_transfer_ownership(client_for, user, make_user, server, join):
    new_owner = make_user()
    url = reverse("server-transfer", args=[server.pk])
    assert (
        client_for(user).post(url, {"user_id": str(new_owner.pk)}).status_code == 400
    )  # not a member
    join(server, new_owner)
    assert (
        client_for(new_owner).post(url, {"user_id": str(user.pk)}).status_code == 403
    )  # not owner
    response = client_for(user).post(url, {"user_id": str(new_owner.pk)})
    assert response.status_code == 200
    assert response.json()["me"]["is_owner"] is False
    server.refresh_from_db()
    assert server.owner_id == new_owner.pk


def test_join_public_and_leave(client_for, user, make_user, server):
    joiner = make_user()
    join_url = reverse("server-join", args=[server.pk])
    assert client_for(joiner).post(join_url).status_code == 404  # private
    server.is_public = True
    server.save()
    assert client_for(joiner).post(join_url).status_code == 201
    assert client_for(joiner).post(join_url).status_code == 409
    server.refresh_from_db()
    assert server.member_count == 2

    assert client_for(joiner).post(reverse("server-leave", args=[server.pk])).status_code == 204
    server.refresh_from_db()
    assert server.member_count == 1
    owner_leave = client_for(user).post(reverse("server-leave", args=[server.pk]))
    assert owner_leave.status_code == 400
    assert owner_leave.json()["code"] == "owner_cannot_leave"


def test_topics_are_seeded_and_public(api_client, topics):
    slugs = [t["slug"] for t in api_client.get(reverse("topics")).json()]
    assert {"gaming", "programming", "study"} <= set(slugs)


def test_server_list_query_count(client_for, user, django_assert_max_num_queries):
    from apps.servers.services import create_server

    for i in range(5):
        create_server(owner=user, name=f"S{i}")
    with django_assert_max_num_queries(3):  # auth + servers (topic joined)
        assert len(client_for(user).get(reverse("servers")).json()) == 5
