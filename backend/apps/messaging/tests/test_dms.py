"""Direct messages, group DMs and blocking (FR-DM-01..04)."""

from typing import Any

import pytest
from django.urls import reverse

from apps.messaging.models import DMConversation, DMParticipant
from apps.notifications.models import MuteSetting, Notification

pytestmark = pytest.mark.django_db


@pytest.fixture
def people(make_user, server, join, user):
    """``user`` (owner) plus ana and bo, all in one server; ``loner`` shares nothing."""
    ana, bo = make_user(username="ana"), make_user(username="bo")
    join(server, ana)
    join(server, bo)
    return {"me": user, "ana": ana, "bo": bo, "loner": make_user(username="loner")}


def open_dm(client, *users, **extra: Any):
    return client.post(
        reverse("dms"), {"user_ids": [str(u.pk) for u in users], **extra}, format="json"
    )


def dm_send(client, dm_id, content="hi", **extra: Any):
    return client.post(
        reverse("dm-messages", args=[dm_id]), {"content": content, **extra}, format="json"
    )


def test_open_one_to_one_is_idempotent(client_for, people):
    me, ana = people["me"], people["ana"]
    first = open_dm(client_for(me), ana)
    assert first.status_code == 201
    body = first.json()
    assert body["is_group"] is False
    assert [r["username"] for r in body["recipients"]] == ["ana"]
    assert body["recipients"][0]["presence"] == "offline"
    again = open_dm(client_for(ana), me)  # from the other side too
    assert again.status_code == 200 and again.json()["id"] == body["id"]
    assert DMConversation.objects.count() == 1


def test_dm_requires_a_shared_server(client_for, people):
    assert open_dm(client_for(people["me"]), people["loner"]).status_code == 400


def test_messages_unread_and_ack(client_for, people):
    me, ana = people["me"], people["ana"]
    dm_id = open_dm(client_for(me), ana).json()["id"]
    first = dm_send(client_for(me), dm_id, "hello").json()
    dm_send(client_for(me), dm_id, "you there?")
    listed = client_for(ana).get(reverse("dms")).json()
    assert listed[0]["unread_count"] == 2
    states = {s["dm_id"]: s for s in client_for(ana).get(reverse("read-states")).json()}
    assert states[dm_id]["mention_count"] == 2
    history = client_for(ana).get(reverse("dm-messages", args=[dm_id])).json()
    assert [m["content"] for m in history["results"]] == ["you there?", "hello"]
    assert history["results"][0]["dm_id"] == dm_id and history["results"][0]["channel_id"] is None
    # One coalesced inbox entry for the conversation.
    notification = Notification.objects.get(user=ana)
    assert notification.type == "dm" and notification.data["count"] == 2
    newest = history["results"][0]["id"]
    ack = client_for(ana).post(
        reverse("dm-ack", args=[dm_id]), {"message_id": newest}, format="json"
    )
    assert ack.status_code == 200
    assert client_for(ana).get(reverse("dms")).json()[0]["unread_count"] == 0
    assert Notification.objects.get(user=ana).read_at is not None
    assert first["id"]  # sender's own messages never count as unread
    assert client_for(me).get(reverse("dms")).json()[0]["unread_count"] == 0


def test_outsiders_cant_read_or_post(client_for, people):
    dm_id = open_dm(client_for(people["me"]), people["ana"]).json()["id"]
    bo = client_for(people["bo"])
    assert bo.get(reverse("dm-messages", args=[dm_id])).status_code == 404
    assert dm_send(bo, dm_id).status_code == 404


def test_closed_dm_reopens_on_new_message(client_for, people):
    me, ana = people["me"], people["ana"]
    dm_id = open_dm(client_for(me), ana).json()["id"]
    client_for(ana).patch(reverse("dm", args=[dm_id]), {"closed": True}, format="json")
    assert client_for(ana).get(reverse("dms")).json() == []
    dm_send(client_for(me), dm_id)
    assert [d["id"] for d in client_for(ana).get(reverse("dms")).json()] == [dm_id]


def test_blocking_stops_dms_both_ways(client_for, people):
    me, ana = people["me"], people["ana"]
    dm_id = open_dm(client_for(me), ana).json()["id"]
    message = dm_send(client_for(me), dm_id).json()
    response = client_for(ana).post(
        reverse("users-me-blocks"), {"user_id": str(me.pk)}, format="json"
    )
    assert response.status_code == 204
    blocked = dm_send(client_for(me), dm_id)
    assert blocked.status_code == 403 and blocked.json()["code"] == "blocked"
    assert dm_send(client_for(ana), dm_id).status_code == 403
    assert open_dm(client_for(me), ana).status_code == 403
    reaction = reverse("message-reaction", args=[message["id"], "👍"])
    assert client_for(ana).put(reaction).status_code == 403
    blocks = client_for(ana).get(reverse("users-me-blocks")).json()
    assert [b["id"] for b in blocks] == [str(me.pk)]
    client_for(ana).delete(reverse("users-me-block", args=[me.pk]))
    assert dm_send(client_for(me), dm_id).status_code == 201


def test_cant_block_yourself(client_for, people):
    me = people["me"]
    response = client_for(me).post(
        reverse("users-me-blocks"), {"user_id": str(me.pk)}, format="json"
    )
    assert response.status_code == 400


def test_group_dm_lifecycle(client_for, people, make_user, server, join):
    me, ana, bo = people["me"], people["ana"], people["bo"]
    response = open_dm(client_for(me), ana, bo, name="Study crew")
    assert response.status_code == 201
    group = response.json()
    assert group["is_group"] and group["name"] == "Study crew" and group["owner_id"] == str(me.pk)
    dm_id = group["id"]
    # Anyone can rename; only the owner removes others; anyone can leave.
    client_for(ana).patch(reverse("dm", args=[dm_id]), {"name": "Exam crew"}, format="json")
    assert DMConversation.objects.get(pk=dm_id).name == "Exam crew"
    removal = reverse("dm-participant", args=[dm_id, bo.pk])
    assert client_for(ana).delete(removal).status_code == 403
    assert client_for(me).delete(removal).status_code == 204
    cy = make_user(username="cy")
    join(server, cy)
    added = client_for(ana).post(
        reverse("dm-participants", args=[dm_id]), {"user_ids": [str(cy.pk)]}, format="json"
    )
    assert sorted(r["username"] for r in added.json()["recipients"]) == sorted(["cy", me.username])
    # The owner leaves: ownership passes on.
    assert client_for(me).delete(reverse("dm-participant", args=[dm_id, me.pk])).status_code == 204
    assert DMConversation.objects.get(pk=dm_id).owner_id == ana.pk
    client_for(ana).delete(reverse("dm-participant", args=[dm_id, ana.pk]))
    client_for(cy).delete(reverse("dm-participant", args=[dm_id, cy.pk]))
    assert not DMConversation.objects.filter(pk=dm_id).exists()


def test_group_dm_size_limit(client_for, people, make_user, server, join):
    others = []
    for i in range(10):
        u = make_user(username=f"p{i}")
        join(server, u)
        others.append(u)
    assert open_dm(client_for(people["me"]), *others).status_code == 400
    assert open_dm(client_for(people["me"]), *others[:9]).status_code == 201


def test_muted_dm_doesnt_notify(client_for, people):
    me, ana = people["me"], people["ana"]
    dm_id = open_dm(client_for(me), ana).json()["id"]
    response = client_for(ana).put(
        reverse("mute-settings"),
        {"target_type": "dm", "target_id": dm_id, "muted": True},
        format="json",
    )
    assert response.json() == [
        {"server_id": None, "channel_id": None, "dm_id": dm_id, "muted_until": None}
    ]
    dm_send(client_for(me), dm_id)
    assert not Notification.objects.exists()
    assert DMParticipant.objects.get(user=ana).unread_count == 1  # still counted
    client_for(ana).put(
        reverse("mute-settings"),
        {"target_type": "dm", "target_id": dm_id, "muted": False},
        format="json",
    )
    assert not MuteSetting.objects.exists()


def test_dm_reactions_pins_search(client_for, people):
    me, ana = people["me"], people["ana"]
    dm_id = open_dm(client_for(me), ana).json()["id"]
    message = dm_send(client_for(me), dm_id, "the answer is 42").json()
    assert (
        client_for(ana).put(reverse("message-reaction", args=[message["id"], "💯"])).status_code
        == 204
    )
    assert client_for(ana).put(reverse("message-pin", args=[message["id"]])).status_code == 200
    assert len(client_for(me).get(reverse("dm-pins", args=[dm_id])).json()) == 1
    found = client_for(me).get(reverse("dm-message-search", args=[dm_id]), {"q": "answer"}).json()
    assert found["total"] == 1


def test_contacts_are_people_sharing_a_server(client_for, people):
    names = [
        u["username"] for u in client_for(people["me"]).get(reverse("users-me-contacts")).json()
    ]
    assert names == ["ana", "bo"]
    filtered = client_for(people["me"]).get(reverse("users-me-contacts"), {"q": "an"}).json()
    assert [u["username"] for u in filtered] == ["ana"]
