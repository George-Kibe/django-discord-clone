"""Inbox and mute settings API (FR-PRES-02, FR-PRES-04)."""

import pytest
from django.urls import reverse

from apps.chat_channels.models import Channel
from apps.notifications.models import MuteSetting, Notification

pytestmark = pytest.mark.django_db


def make(user, n):
    return [Notification.objects.create(user=user, type="mention", data={"i": i}) for i in range(n)]


def test_inbox_pages_newest_first_and_counts_unread(client_for, user, make_user):
    make(make_user(), 2)  # someone else's
    make(user, 30)
    first = client_for(user).get(reverse("notifications"), {"limit": 20}).json()
    assert first["unread_count"] == 30 and len(first["results"]) == 20
    assert first["results"][0]["data"] == {"i": 29}
    rest = client_for(user).get(reverse("notifications"), {"cursor": first["next_cursor"]}).json()
    assert len(rest["results"]) == 10 and rest["next_cursor"] is None


def test_mark_read_by_id_and_all(client_for, user):
    rows = make(user, 3)
    client = client_for(user)
    assert (
        client.post(
            reverse("notifications-read"), {"ids": [str(rows[0].pk)]}, format="json"
        ).status_code
        == 204
    )
    assert client.get(reverse("notifications"), {"unread": True}).json()["unread_count"] == 2
    client.post(reverse("notifications-read"), {"all": True}, format="json")
    assert client.get(reverse("notifications")).json()["unread_count"] == 0
    assert client.post(reverse("notifications-read"), {}, format="json").status_code == 400


def test_mute_server_and_channel(client_for, user, server, make_user):
    channel = Channel.objects.get(server=server, name="general")
    client = client_for(user)
    for target_type, target_id in (("server", server.pk), ("channel", channel.pk)):
        response = client.put(
            reverse("mute-settings"),
            {"target_type": target_type, "target_id": str(target_id), "muted": True},
            format="json",
        )
        assert response.status_code == 200
    assert MuteSetting.objects.filter(user=user).count() == 2
    assert len(client.get(reverse("mute-settings")).json()) == 2
    outsider = client_for(make_user())
    response = outsider.put(
        reverse("mute-settings"),
        {"target_type": "server", "target_id": str(server.pk), "muted": True},
        format="json",
    )
    assert response.status_code == 404
