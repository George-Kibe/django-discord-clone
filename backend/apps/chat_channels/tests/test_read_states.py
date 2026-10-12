"""Read states and acks (FR-CH-04)."""

import uuid
from typing import Any

import pytest
from django.urls import reverse

from apps.chat_channels.models import Channel, ReadState
from apps.core.permissions import Perm
from apps.servers.models import Role

pytestmark = pytest.mark.django_db


@pytest.fixture
def channel(server) -> Channel:
    return Channel.objects.get(server=server, name="general")


def post(client, channel, content="hi"):
    response = client.post(
        reverse("channel-messages", args=[channel.pk]), {"content": content}, format="json"
    )
    assert response.status_code == 201, response.content
    return response.json()["id"]


def states(client) -> dict[str, dict[str, Any]]:
    response = client.get(reverse("read-states"))
    assert response.status_code == 200
    return {row["channel_id"]: row for row in response.json()}


def test_unread_until_acked(user, make_user, server, join, channel, client_for):
    reader = make_user()
    join(server, reader)
    owner, client = client_for(user), client_for(reader)

    assert states(client)[str(channel.pk)] == {
        "channel_id": str(channel.pk),
        "server_id": str(server.pk),
        "last_message_id": None,
        "last_read_message_id": None,
        "mention_count": 0,
    }
    first = post(owner, channel)
    second = post(owner, channel)
    row = states(client)[str(channel.pk)]
    assert row["last_message_id"] == second and row["last_read_message_id"] is None

    response = client.post(
        reverse("channel-ack", args=[channel.pk]), {"message_id": second}, format="json"
    )
    assert response.status_code == 200
    assert response.json()["last_read_message_id"] == second

    # Acks never move backwards (e.g. a stale tab acking an older message).
    client.post(reverse("channel-ack", args=[channel.pk]), {"message_id": first}, format="json")
    assert states(client)[str(channel.pk)]["last_read_message_id"] == second


def test_sending_marks_own_message_read(user, server, channel, client_for):
    owner = client_for(user)
    sent = post(owner, channel)
    assert states(owner)[str(channel.pk)]["last_read_message_id"] == sent


def test_ack_is_clamped_to_newest_message(user, server, channel, client_for):
    owner = client_for(user)
    url = reverse("channel-ack", args=[channel.pk])
    future = str(uuid.uuid7())
    assert owner.post(url, {"message_id": future}, format="json").status_code == 400  # empty
    sent = post(owner, channel)
    ReadState.objects.all().delete()
    response = owner.post(url, {"message_id": str(uuid.uuid7())}, format="json")
    assert response.json()["last_read_message_id"] == sent


def test_hidden_channels_are_excluded(user, make_user, server, join, channel, client_for):
    outsider = make_user()
    assert states(client_for(outsider)) == {}
    reader = make_user()
    join(server, reader)
    everyone = Role.objects.get(server=server, is_default=True)
    client_for(user).put(
        reverse("channel-overwrites", args=[channel.pk]),
        {"role_id": str(everyone.pk), "allow": 0, "deny": int(Perm.VIEW_CHANNEL)},
        format="json",
    )
    assert str(channel.pk) not in states(client_for(reader))
    message = post(client_for(user), channel)
    response = client_for(reader).post(
        reverse("channel-ack", args=[channel.pk]), {"message_id": message}, format="json"
    )
    assert response.status_code in (403, 404)
    assert (
        client_for(outsider)
        .post(reverse("channel-ack", args=[channel.pk]), {"message_id": message}, format="json")
        .status_code
        == 404
    )


def test_read_states_query_count(user, server, client_for, django_assert_max_num_queries):
    client = client_for(user)
    with django_assert_max_num_queries(10):
        states(client)
