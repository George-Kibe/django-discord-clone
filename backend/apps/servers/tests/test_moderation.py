"""Kick, ban/unban, audit log (FR-MOD-01/02) and discovery (FR-SRV-07/08)."""

import pytest
from django.urls import reverse

from apps.chat_channels.models import Channel
from apps.servers.models import Ban, Member, Role, Server, ServerAuditEvent, Topic

pytestmark = pytest.mark.django_db


@pytest.fixture
def mod(make_user, server, join):
    """A member with the default Moderator role (kick, manage messages, audit log)."""
    user = make_user(username="mod")
    member = join(server, user)
    member.roles.add(Role.objects.get(server=server, name="Moderator"))
    return user


@pytest.fixture
def member(make_user, server, join):
    user = make_user(username="member")
    join(server, user)
    return user


def kick(client, server, user):
    return client.post(reverse("server-member-kick", args=[server.pk, user.pk]), {}, format="json")


def test_moderator_kicks_a_member(client_for, server, mod, member):
    assert kick(client_for(member), server, mod).status_code == 403  # no KICK_MEMBERS
    response = kick(client_for(mod), server, member)
    assert response.status_code == 204
    assert not Member.objects.filter(server=server, user=member).exists()
    server.refresh_from_db()
    assert server.member_count == 2
    event = ServerAuditEvent.objects.get(action="member.kick")
    assert event.actor == mod and event.target_label == "member"


def test_kick_respects_hierarchy(client_for, user, server, mod, make_user, join):
    assert kick(client_for(mod), server, user).status_code == 403  # the owner
    peer = make_user()
    join(server, peer).roles.add(Role.objects.get(server=server, name="Moderator"))
    assert kick(client_for(mod), server, peer).status_code == 403  # same rank
    assert kick(client_for(mod), server, mod).status_code == 400  # yourself
    assert kick(client_for(user), server, mod).status_code == 204  # owner outranks all


def test_ban_blocks_rejoining_until_unbanned(client_for, user, server, member):
    server.is_public = True
    server.save()
    response = client_for(user).post(
        reverse("server-bans", args=[server.pk]),
        {"user_id": str(member.pk), "reason": "spam"},
        format="json",
    )
    assert response.status_code == 201
    assert response.json()["reason"] == "spam"
    assert not Member.objects.filter(server=server, user=member).exists()

    joined = client_for(member).post(reverse("server-join", args=[server.pk]))
    assert joined.status_code == 403 and joined.json()["code"] == "banned"
    invite = client_for(user).post(reverse("server-invites", args=[server.pk]), {}, format="json")
    code = invite.json()["code"]
    assert client_for(member).post(reverse("invite-accept", args=[code])).status_code == 403

    bans = client_for(user).get(reverse("server-bans", args=[server.pk])).json()
    assert [b["user"]["id"] for b in bans] == [str(member.pk)]
    assert (
        client_for(user).delete(reverse("server-ban", args=[server.pk, member.pk])).status_code
        == 204
    )
    assert client_for(member).post(reverse("server-join", args=[server.pk])).status_code in (
        200,
        201,
    )
    actions = list(ServerAuditEvent.objects.values_list("action", flat=True))
    assert {"member.ban", "member.unban"} <= set(actions)


def test_ban_needs_permission_and_can_target_non_members(client_for, user, server, mod, make_user):
    outsider = make_user()
    response = client_for(mod).post(
        reverse("server-bans", args=[server.pk]), {"user_id": str(outsider.pk)}, format="json"
    )
    assert response.status_code == 403  # Moderator has no BAN_MEMBERS by default
    response = client_for(user).post(
        reverse("server-bans", args=[server.pk]), {"user_id": str(outsider.pk)}, format="json"
    )
    assert response.status_code == 201 and Ban.objects.filter(user=outsider).exists()


def test_audit_log_records_changes_and_needs_permission(client_for, user, server, mod, member):
    client = client_for(user)
    role = client.post(
        reverse("server-roles", args=[server.pk]), {"name": "Helpers"}, format="json"
    )
    client.patch(
        reverse("server-role", args=[server.pk, role.json()["id"]]),
        {"name": "Helpers+"},
        format="json",
    )
    channel = Channel.objects.get(server=server, name="general")
    client.patch(reverse("channel", args=[channel.pk]), {"topic": "Say hi"}, format="json")
    message = (
        client_for(member)
        .post(reverse("channel-messages", args=[channel.pk]), {"content": "rude"}, format="json")
        .json()
    )
    client_for(mod).delete(reverse("message", args=[message["id"]]))

    log = client_for(mod).get(reverse("server-audit-log", args=[server.pk])).json()
    actions = [e["action"] for e in log["results"]]
    assert actions[:4] == ["message.delete", "channel.update", "role.update", "role.create"]
    deleted = log["results"][0]
    assert deleted["changes"]["content"] == "rude" and deleted["actor"]["username"] == "mod"
    renamed = log["results"][2]
    assert renamed["changes"] == {"name": {"from": "Helpers", "to": "Helpers+"}}
    assert client_for(member).get(reverse("server-audit-log", args=[server.pk])).status_code == 403
    filtered = (
        client_for(mod)
        .get(reverse("server-audit-log", args=[server.pk]), {"action": "role.create"})
        .json()
    )
    assert [e["action"] for e in filtered["results"]] == ["role.create"]


def test_discovery_lists_public_servers_with_search_and_topics(client_for, make_user, topics):
    from apps.servers.services import create_server

    owner = make_user()
    science = Topic.objects.get(slug="science")
    public = create_server(owner=owner, name="Biology Club", description="cells", is_public=True)
    Server.objects.filter(pk=public.pk).update(topic=science)
    create_server(owner=owner, name="Private Biology", is_public=False)
    create_server(owner=owner, name="Chess", is_public=True)
    viewer = make_user()
    client = client_for(viewer)

    names = [s["name"] for s in client.get(reverse("discover-servers")).json()["results"]]
    assert sorted(names) == ["Biology Club", "Chess"]
    found = client.get(reverse("discover-servers"), {"q": "cells"}).json()["results"]
    assert [s["name"] for s in found] == ["Biology Club"]
    assert found[0]["joined"] is False
    by_topic = client.get(reverse("discover-servers"), {"topic": "science"}).json()["results"]
    assert [s["name"] for s in by_topic] == ["Biology Club"]
    mine = client_for(owner).get(reverse("discover-servers"), {"q": "Chess"}).json()["results"]
    assert mine[0]["joined"] is True
