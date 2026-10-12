"""Account deletion and data export (FR-AUTH-09, NFR-PRIV-02)."""

import json

import pytest
from django.urls import reverse

from apps.accounts.models import AuthAuditEvent, User
from apps.chat_channels.models import Channel
from apps.messaging.models import Message
from apps.servers.models import Server
from conftest import PASSWORD

pytestmark = pytest.mark.django_db


def test_delete_account_keeps_messages_as_deleted_user(client_for, user, make_user, server, join):
    leaver = make_user()
    join(server, leaver)
    channel = Channel.objects.get(server=server, name="general")
    client_for(leaver).post(
        reverse("channel-messages", args=[channel.pk]), {"content": "bye"}, format="json"
    )
    client = client_for(leaver)
    assert (
        client.post(reverse("users-me-delete"), {"password": "wrong"}, format="json").status_code
        == 400
    )
    response = client.post(reverse("users-me-delete"), {"password": PASSWORD}, format="json")
    assert response.status_code == 204
    assert not User.objects.filter(pk=leaver.pk).exists()
    message = Message.objects.get(content="bye")
    assert message.author is None
    history = client_for(user).get(reverse("channel-messages", args=[channel.pk])).json()
    assert history["results"][0]["author"] is None
    assert Server.objects.get(pk=server.pk).member_count == 1
    assert AuthAuditEvent.objects.filter(event="account_deleted").exists()


def test_owners_must_transfer_servers_first(client_for, user, server):
    response = client_for(user).post(
        reverse("users-me-delete"), {"password": PASSWORD}, format="json"
    )
    assert response.status_code == 400 and response.json()["code"] == "owns_servers"
    assert User.objects.filter(pk=user.pk).exists()


def test_data_export(client_for, user, server):
    channel = Channel.objects.get(server=server, name="general")
    client_for(user).post(
        reverse("channel-messages", args=[channel.pk]), {"content": "my words"}, format="json"
    )
    response = client_for(user).get(reverse("users-me-export"))
    assert response.status_code == 200
    assert "attachment" in response["Content-Disposition"]
    data = json.loads(response.content)
    assert data["profile"]["email"] == user.email
    assert [s["name"] for s in data["servers"]] == ["Test Server"]
    assert [m["content"] for m in data["messages"]] == ["my words"]
