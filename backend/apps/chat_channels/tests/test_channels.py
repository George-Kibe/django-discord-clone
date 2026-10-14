"""Categories, channels, visibility and overwrites (FR-CH-01..03, FR-ROLE-05)."""

import uuid

import pytest
from django.urls import reverse

from apps.chat_channels.models import Category, Channel, PermissionOverwrite
from apps.chat_channels.services import normalize_channel_name
from apps.core.permissions import Perm
from apps.servers.models import Member, Role

pytestmark = pytest.mark.django_db


@pytest.fixture
def member(make_user, server, join):
    user = make_user()
    join(server, user)
    return user


def general(server):
    return Channel.objects.get(server=server, name="general")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("General Chat", "general-chat"),
        ("  Off--Topic!! ", "off-topic"),
        ("dev_talk", "dev_talk"),
        ("Ünïcode", "n-code"),
    ],
)
def test_normalize_channel_name(raw, expected):
    assert normalize_channel_name(raw) == expected


def test_channel_list_includes_my_permissions(client_for, user, member, server):
    rows = client_for(member).get(reverse("server-channels", args=[server.pk])).json()
    assert [r["name"] for r in rows] == ["general"]
    assert rows[0]["permissions"] & int(Perm.SEND_MESSAGES)
    assert not rows[0]["permissions"] & int(Perm.MANAGE_CHANNELS)
    owner_rows = client_for(user).get(reverse("server-channels", args=[server.pk])).json()
    assert owner_rows[0]["permissions"] & int(Perm.MANAGE_CHANNELS)


def test_create_category_and_channel(client_for, user, member, server):
    cats = reverse("server-categories", args=[server.pk])
    assert client_for(member).post(cats, {"name": "Voice"}).status_code == 403
    category = client_for(user).post(cats, {"name": "Projects"}).json()
    assert category["position"] == 1

    chans = reverse("server-channels", args=[server.pk])
    assert client_for(member).post(chans, {"name": "x"}).status_code == 403
    response = client_for(user).post(
        chans, {"name": "Show And Tell", "topic": "Share work", "category_id": category["id"]}
    )
    assert response.status_code == 201, response.content
    assert response.json()["name"] == "show-and-tell"
    assert response.json()["category_id"] == category["id"]
    assert (
        client_for(user).post(chans, {"name": "x", "category_id": str(uuid.uuid4())}).status_code
        == 400
    )
    assert client_for(user).post(chans, {"name": "!!!"}).status_code == 400


def test_update_and_delete_channel(client_for, user, member, server):
    url = reverse("channel", args=[general(server).pk])
    assert client_for(member).patch(url, {"topic": "x"}).status_code == 403
    response = client_for(user).patch(
        url, {"name": "Lobby Room", "topic": "Say hi", "slowmode_seconds": 5}
    )
    assert response.json()["name"] == "lobby-room" and response.json()["topic"] == "Say hi"
    assert client_for(member).delete(url).status_code == 403
    assert client_for(user).delete(url).status_code == 204
    assert not Channel.objects.filter(server=server).exists()


def test_deleting_category_keeps_channels(client_for, user, server):
    category = Category.objects.get(server=server)
    assert client_for(user).delete(reverse("category", args=[category.pk])).status_code == 204
    assert general(server).category_id is None


def test_rename_category(client_for, user, member, server):
    url = reverse("category", args=[Category.objects.get(server=server).pk])
    assert client_for(member).patch(url, {"name": "x"}).status_code == 403
    assert client_for(user).patch(url, {"name": "Chat"}).json()["name"] == "Chat"
    assert (
        client_for(user).patch(reverse("category", args=[uuid.uuid4()]), {"name": "x"}).status_code
        == 404
    )


def test_reorder_channels(client_for, user, member, server):
    chans = reverse("server-channels", args=[server.pk])
    second = client_for(user).post(chans, {"name": "second"}).json()
    url = reverse("server-channels-reorder", args=[server.pk])
    payload = {
        "channels": [
            {"id": second["id"], "category_id": None, "position": 0},
            {"id": str(general(server).pk), "category_id": None, "position": 1},
        ]
    }
    assert client_for(member).patch(url, payload, format="json").status_code == 403
    response = client_for(user).patch(url, payload, format="json")
    assert [c["name"] for c in response.json()] == ["second", "general"]
    bad = {"channels": [{"id": str(uuid.uuid4()), "category_id": None, "position": 0}]}
    assert client_for(user).patch(url, bad, format="json").status_code == 400


def test_private_channel_is_invisible(client_for, user, member, server):
    channel = general(server)
    everyone = Role.objects.get(server=server, is_default=True)
    PermissionOverwrite.objects.create(channel=channel, role=everyone, deny=int(Perm.VIEW_CHANNEL))

    assert client_for(member).get(reverse("server-channels", args=[server.pk])).json() == []
    assert client_for(member).get(reverse("channel", args=[channel.pk])).status_code == 404
    assert client_for(member).get(reverse("channel-messages", args=[channel.pk])).status_code == 404
    # The owner (all permissions) still sees it.
    assert len(client_for(user).get(reverse("server-channels", args=[server.pk])).json()) == 1

    # A member overwrite lets this one member back in.
    m = Member.objects.get(server=server, user=member)
    PermissionOverwrite.objects.create(channel=channel, member=m, allow=int(Perm.VIEW_CHANNEL))
    assert len(client_for(member).get(reverse("server-channels", args=[server.pk])).json()) == 1


def test_overwrite_api(client_for, user, member, server):
    channel = general(server)
    url = reverse("channel-overwrites", args=[channel.pk])
    moderator = Role.objects.get(server=server, name="Moderator")
    deny_send = {"role_id": str(moderator.pk), "allow": 0, "deny": int(Perm.SEND_MESSAGES)}

    assert client_for(member).put(url, deny_send).status_code == 403
    created = client_for(user).put(url, deny_send)
    assert created.status_code == 200, created.content
    # PUT again replaces rather than duplicates.
    client_for(user).put(url, deny_send | {"deny": int(Perm.ADD_REACTIONS)})
    assert PermissionOverwrite.objects.filter(channel=channel).count() == 1

    member_ow = client_for(user).put(
        url, {"user_id": str(member.pk), "allow": int(Perm.MANAGE_MESSAGES), "deny": 0}
    )
    assert member_ow.json()["user_id"] == str(member.pk)
    listed = client_for(member).get(url).json()
    assert len(listed) == 2

    for bad in (
        {"allow": 0, "deny": 0},
        {"role_id": str(moderator.pk), "user_id": str(member.pk), "allow": 0, "deny": 0},
        {"role_id": str(moderator.pk), "allow": 2, "deny": 2},
        {"role_id": str(uuid.uuid4()), "allow": 0, "deny": 0},
        {"user_id": str(uuid.uuid4()), "allow": 0, "deny": 0},
        {"role_id": str(moderator.pk), "allow": 1 << 40, "deny": 0},
    ):
        assert client_for(user).put(url, bad).status_code == 400, bad

    detail = reverse("channel-overwrite", args=[channel.pk, created.json()["id"]])
    assert client_for(member).delete(detail).status_code == 403
    assert client_for(user).delete(detail).status_code == 204
    assert client_for(user).delete(detail).status_code == 404


def test_overwrites_respect_grant_rules(client_for, make_user, server, join):
    manager_user = make_user()
    manager = join(server, manager_user)
    role = Role.objects.create(
        server=server,
        name="Mgr",
        position=3,
        permissions=int(Perm.MANAGE_ROLES | Perm.MANAGE_CHANNELS | Perm.VIEW_CHANNEL),
    )
    manager.roles.add(role)
    url = reverse("channel-overwrites", args=[general(server).pk])
    everyone = Role.objects.get(server=server, is_default=True)
    grant_admin = {"role_id": str(everyone.pk), "allow": int(Perm.ADMINISTRATOR), "deny": 0}
    assert (
        client_for(manager_user).put(url, grant_admin).json()["code"] == "cannot_grant_permission"
    )


def test_channel_list_query_count(client_for, user, server, django_assert_max_num_queries):
    chans = reverse("server-channels", args=[server.pk])
    client = client_for(user)
    for i in range(10):
        client.post(chans, {"name": f"c{i}"})
    with django_assert_max_num_queries(6):
        assert len(client.get(chans).json()) == 11


def test_reorder_categories(client_for, user, make_user, server, join):
    from apps.chat_channels.models import Category

    client = client_for(user)
    url = reverse("server-categories", args=[server.pk])
    for name in ("Study", "Fun"):
        assert client.post(url, {"name": name}, format="json").status_code == 201
    ids = list(
        Category.objects.filter(server=server).order_by("position").values_list("pk", flat=True)
    )
    reordered = [str(i) for i in reversed(ids)]
    reorder = reverse("server-categories-reorder", args=[server.pk])
    response = client.patch(reorder, {"category_ids": reordered}, format="json")
    assert response.status_code == 200
    assert [c["id"] for c in response.json()] == reordered
    assert client.patch(reorder, {"category_ids": reordered[:1]}, format="json").status_code == 400
    member = make_user()
    join(server, member)
    denied = client_for(member).patch(reorder, {"category_ids": reordered}, format="json")
    assert denied.status_code == 403
