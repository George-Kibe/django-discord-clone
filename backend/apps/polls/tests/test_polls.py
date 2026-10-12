"""Polls (FR-POLL-01..04)."""

from datetime import timedelta
from typing import Any

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.chat_channels.models import Channel
from apps.core.permissions import Perm
from apps.polls.models import Poll
from apps.polls.tasks import close_due
from apps.servers.models import Role

pytestmark = pytest.mark.django_db


@pytest.fixture
def channel(server):
    return Channel.objects.get(server=server, name="general")


@pytest.fixture
def voter(make_user, server, join):
    user = make_user(username="voter")
    join(server, user)
    return user


def post_poll(client, channel, **poll: Any):
    body = {
        "content": "",
        "poll": {"question": "Exam day?", "options": ["Monday", "Friday"], **poll},
    }
    return client.post(reverse("channel-messages", args=[channel.pk]), body, format="json")


def vote(client, poll_id, *option_ids):
    return client.put(
        reverse("poll-votes", args=[poll_id]), {"option_ids": list(option_ids)}, format="json"
    )


def poll_of(client, channel) -> dict[str, Any]:
    history = client.get(reverse("channel-messages", args=[channel.pk])).json()
    poll: dict[str, Any] = history["results"][0]["poll"]
    return poll


def test_create_vote_change_and_withdraw(client_for, user, voter, channel):
    created = post_poll(client_for(user), channel)
    assert created.status_code == 201, created.content
    message = created.json()
    assert message["type"] == "poll"
    poll = message["poll"]
    assert [o["text"] for o in poll["options"]] == ["Monday", "Friday"]
    monday, friday = (o["id"] for o in poll["options"])

    assert vote(client_for(voter), poll["id"], monday).status_code == 204
    assert vote(client_for(voter), poll["id"], friday).status_code == 204  # change of mind
    seen = poll_of(client_for(voter), channel)
    assert [o["votes"] for o in seen["options"]] == [0, 1]
    assert seen["my_votes"] == [friday] and seen["total_voters"] == 1
    assert poll_of(client_for(user), channel)["my_votes"] == []

    assert client_for(voter).delete(reverse("poll-votes", args=[poll["id"]])).status_code == 204
    assert poll_of(client_for(voter), channel)["total_voters"] == 0


def test_single_vs_multiple_choice(client_for, user, voter, channel):
    single = post_poll(client_for(user), channel).json()["poll"]
    ids = [o["id"] for o in single["options"]]
    assert vote(client_for(voter), single["id"], *ids).status_code == 400
    multi = post_poll(client_for(user), channel, allow_multiple=True).json()["poll"]
    ids = [o["id"] for o in multi["options"]]
    assert vote(client_for(voter), multi["id"], *ids).status_code == 204
    assert poll_of(client_for(voter), channel)["my_votes"] == ids


@pytest.mark.parametrize(
    "options",
    [["only one"], [f"o{i}" for i in range(11)], ["Same", "same"]],
)
def test_option_validation(client_for, user, channel, options):
    assert post_poll(client_for(user), channel, options=options).status_code == 400


def test_creating_polls_needs_permission(client_for, voter, server, channel):
    everyone = Role.objects.get(server=server, is_default=True)
    everyone.permissions &= ~int(Perm.CREATE_POLLS)
    everyone.save()
    assert post_poll(client_for(voter), channel).status_code == 403


def test_close_by_author_or_moderator_only(client_for, user, voter, channel):
    poll = post_poll(client_for(voter), channel).json()["poll"]
    stranger_close = client_for(voter).post(reverse("poll-close", args=[poll["id"]]))
    assert stranger_close.status_code == 204  # the author
    option = poll["options"][0]["id"]
    closed = vote(client_for(user), poll["id"], option)
    assert closed.status_code == 400 and closed.json()["code"] == "poll_closed"
    other = post_poll(client_for(user), channel).json()["poll"]
    assert client_for(voter).post(reverse("poll-close", args=[other["id"]])).status_code == 403


def test_polls_close_automatically(
    client_for, user, voter, channel, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=False):
        poll = post_poll(client_for(user), channel, duration_minutes=60).json()["poll"]
    assert poll["closes_at"] is not None
    Poll.objects.filter(pk=poll["id"]).update(closes_at=timezone.now() - timedelta(seconds=1))
    assert close_due() == 1
    assert Poll.objects.get(pk=poll["id"]).closed_at is not None
    assert vote(client_for(voter), poll["id"], poll["options"][0]["id"]).status_code == 400
    assert close_due() == 0
