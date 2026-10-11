"""Invites (FR-SRV-04/05)."""

from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.core.permissions import Perm
from apps.servers.models import Invite, Member, Role

pytestmark = pytest.mark.django_db


def create(client, server, **payload):
    return client.post(reverse("server-invites", args=[server.pk]), payload)


def test_create_and_preview_invite(client_for, user, server, api_client):
    response = create(client_for(user), server, max_age=3600, max_uses=5)
    assert response.status_code == 201, response.content
    body = response.json()
    assert len(body["code"]) == 8 and body["max_uses"] == 5
    preview = api_client.get(reverse("invite", args=[body["code"]]))
    assert preview.status_code == 200
    assert preview.json()["server"]["name"] == "Test Server"
    assert preview.json()["inviter"]["username"] == user.username
    assert "owner_id" not in preview.json()["server"]


def test_invalid_max_age(client_for, user, server):
    assert create(client_for(user), server, max_age=123).status_code == 400


def test_accept_invite(client_for, user, make_user, server):
    code = create(client_for(user), server, max_uses=2).json()["code"]
    joiner = make_user()
    response = client_for(joiner).post(reverse("invite-accept", args=[code]))
    assert response.status_code == 200
    assert response.json()["id"] == str(server.pk)
    assert Member.objects.filter(server=server, user=joiner).exists()
    # Accepting again doesn't consume another use.
    client_for(joiner).post(reverse("invite-accept", args=[code]))
    invite = Invite.objects.get(code=code)
    assert invite.uses == 1
    server.refresh_from_db()
    assert server.member_count == 2


def test_unverified_users_cannot_accept(client_for, user, unverified_user, server):
    code = create(client_for(user), server).json()["code"]
    assert (
        client_for(unverified_user).post(reverse("invite-accept", args=[code])).status_code == 403
    )


@pytest.mark.parametrize("state", ["expired", "used_up", "revoked", "missing"])
def test_unusable_invites(client_for, user, make_user, server, api_client, state):
    code = create(client_for(user), server, max_uses=1).json()["code"]
    invite = Invite.objects.get(code=code)
    if state == "expired":
        invite.expires_at = timezone.now() - timedelta(seconds=1)
    elif state == "used_up":
        invite.uses = 1
    elif state == "revoked":
        invite.revoked_at = timezone.now()
    invite.save()
    if state == "missing":
        code = "nope1234"
    assert api_client.get(reverse("invite", args=[code])).status_code == 404
    response = client_for(make_user()).post(reverse("invite-accept", args=[code]))
    assert response.status_code == 404
    assert response.json()["detail"] == "This invite is invalid or has expired."


def test_create_invite_needs_permission(client_for, make_user, server, join):
    member = make_user()
    join(server, member)
    everyone = Role.objects.get(server=server, is_default=True)
    assert create(client_for(member), server).status_code == 201  # @everyone has CREATE_INVITE
    everyone.permissions &= ~int(Perm.CREATE_INVITE)
    everyone.save()
    assert create(client_for(member), server).status_code == 403


def test_invite_visibility_and_revocation(client_for, user, make_user, server, join):
    member = make_user()
    join(server, member)
    mine = create(client_for(member), server).json()["code"]
    owners = create(client_for(user), server).json()["code"]
    list_url = reverse("server-invites", args=[server.pk])
    assert [i["code"] for i in client_for(member).get(list_url).json()] == [mine]
    assert {i["code"] for i in client_for(user).get(list_url).json()} == {mine, owners}

    assert client_for(member).delete(reverse("invite", args=[owners])).status_code == 403
    assert client_for(member).delete(reverse("invite", args=[mine])).status_code == 204
    assert client_for(user).delete(reverse("invite", args=[owners])).status_code == 204
    assert client_for(user).get(list_url).json() == []


def test_invite_creation_is_throttled(client_for, user, server):
    client = client_for(user)
    for _ in range(20):
        assert create(client, server).status_code == 201
    assert create(client, server).status_code == 429
