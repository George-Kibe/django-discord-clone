"""Messages over REST (FR-MSG-01, 03..05, 11, NFR-PERF-04/05)."""

import uuid

import pytest
from django.urls import reverse

from apps.chat_channels.models import Channel, PermissionOverwrite
from apps.core.permissions import Perm
from apps.messaging.models import Message
from apps.servers.models import Member, Role

pytestmark = pytest.mark.django_db


@pytest.fixture
def channel(server):
    return Channel.objects.get(server=server, name="general")


@pytest.fixture
def member(make_user, server, join):
    user = make_user()
    join(server, user)
    return user


def url(channel):
    return reverse("channel-messages", args=[channel.pk])


def send(client, channel, content="hello", **extra):
    return client.post(url(channel), {"content": content, **extra})


def test_send_and_read(client_for, user, member, channel):
    response = send(client_for(member), channel, "  Hi **there**\n")
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["content"] == "  Hi **there**"
    assert body["author"]["id"] == str(member.pk)
    assert body["type"] == "default" and body["edited_at"] is None
    channel.refresh_from_db()
    assert str(channel.last_message_id) == body["id"]

    page = client_for(user).get(url(channel)).json()
    assert [m["id"] for m in page["results"]] == [body["id"]]
    assert page["has_more"] is False


@pytest.mark.parametrize("content", ["", "   \n ", "x" * 4001])
def test_content_validation(client_for, member, channel, content):
    assert send(client_for(member), channel, content).status_code == 400


def test_unverified_users_cannot_post(client_for, unverified_user, server, join, channel):
    join(server, unverified_user)
    response = send(client_for(unverified_user), channel)
    assert response.status_code == 403
    assert response.json()["code"] == "email_not_verified"


def test_send_requires_permission(client_for, member, server, channel):
    everyone = Role.objects.get(server=server, is_default=True)
    PermissionOverwrite.objects.create(channel=channel, role=everyone, deny=int(Perm.SEND_MESSAGES))
    response = send(client_for(member), channel)
    assert response.status_code == 403
    assert response.json()["code"] == "missing_permission"
    assert client_for(member).get(url(channel)).status_code == 200  # can still read


def test_read_history_permission(client_for, member, server, channel):
    everyone = Role.objects.get(server=server, is_default=True)
    PermissionOverwrite.objects.create(
        channel=channel, role=everyone, deny=int(Perm.READ_MESSAGE_HISTORY)
    )
    assert client_for(member).get(url(channel)).status_code == 403


def test_outsiders_and_unknown_channels(client_for, make_user, channel):
    outsider = client_for(make_user())
    assert send(outsider, channel).status_code == 404
    assert outsider.get(url(channel)).status_code == 404
    unknown = reverse("channel-messages", args=[uuid.uuid4()])
    assert client_for(make_user()).get(unknown).status_code == 404


def test_nonce_makes_retries_idempotent(client_for, member, server, channel):
    client = client_for(member)
    first = send(client, channel, "once", nonce="abc-123")
    retry = send(client, channel, "once", nonce="abc-123")
    assert first.status_code == 201 and retry.status_code == 200
    assert retry.json()["id"] == first.json()["id"]
    assert Message.objects.count() == 1
    # Reusing a nonce in another channel is rejected, not answered with the foreign message.
    other = Channel.objects.create(server=server, name="other")
    assert send(client, other, "x", nonce="abc-123").status_code == 400
    # Blank nonces don't collide.
    assert send(client, channel, "a", nonce="").status_code == 201
    assert send(client, channel, "b", nonce="").status_code == 201


def test_cursor_pagination(client_for, member, channel):
    client = client_for(member)
    ids = [send(client, channel, f"m{i}").json()["id"] for i in range(7)]  # oldest -> newest

    page1 = client.get(url(channel), {"limit": 3}).json()
    assert [m["id"] for m in page1["results"]] == ids[:-4:-1]  # newest three, newest first
    assert page1["has_more"] is True
    page2 = client.get(url(channel), {"limit": 3, "before": page1["results"][-1]["id"]}).json()
    assert [m["id"] for m in page2["results"]] == ids[3:0:-1]
    page3 = client.get(url(channel), {"limit": 3, "before": page2["results"][-1]["id"]}).json()
    assert [m["id"] for m in page3["results"]] == [ids[0]] and page3["has_more"] is False

    backfill = client.get(url(channel), {"after": ids[4]}).json()  # oldest first
    assert [m["id"] for m in backfill["results"]] == ids[5:]
    assert client.get(url(channel), {"before": ids[0], "after": ids[1]}).status_code == 400
    assert client.get(url(channel), {"limit": 101}).status_code == 400


def test_edit_own_message_only(client_for, user, member, channel):
    message_id = send(client_for(member), channel, "draft").json()["id"]
    detail = reverse("message", args=[message_id])
    edited = client_for(member).patch(detail, {"content": "final"})
    assert edited.status_code == 200
    assert edited.json()["content"] == "final" and edited.json()["edited_at"] is not None
    assert (
        client_for(user).patch(detail, {"content": "owner edit"}).status_code == 403
    )  # even the owner
    assert client_for(member).patch(detail, {"content": "  "}).status_code == 400


def test_delete_own_or_with_manage_messages(
    client_for, user, member, make_user, server, join, channel
):
    other = make_user()
    join(server, other)
    mine = send(client_for(member), channel, "mine").json()["id"]
    theirs = send(client_for(other), channel, "theirs").json()["id"]

    assert client_for(member).delete(reverse("message", args=[theirs])).status_code == 403
    assert client_for(member).delete(reverse("message", args=[mine])).status_code == 204
    # Moderators (MANAGE_MESSAGES) can delete anyone's.
    Member.objects.get(server=server, user=member).roles.add(
        Role.objects.get(server=server, name="Moderator")
    )
    assert client_for(member).delete(reverse("message", args=[theirs])).status_code == 204

    assert client_for(user).get(url(channel)).json()["results"] == []  # deleted messages are hidden
    assert Message.objects.get(pk=mine).content == ""  # soft-deleted, content cleared
    assert client_for(member).delete(reverse("message", args=[mine])).status_code == 404


def test_deleted_author_shows_as_null(client_for, user, make_user, server, join, channel):
    gone = make_user()
    join(server, gone)
    send(client_for(gone), channel, "bye")
    gone.delete()
    assert client_for(user).get(url(channel)).json()["results"][0]["author"] is None


def test_history_query_count(
    client_for, user, make_user, server, join, channel, django_assert_max_num_queries
):
    for _ in range(5):
        author = make_user()
        join(server, author)
        for i in range(10):
            send(client_for(author), channel, f"msg {i}")
    # NFR-PERF-05: constant, incl. attachments, mentions, reply previews and reactions
    with django_assert_max_num_queries(10):
        body = client_for(user).get(url(channel), {"limit": 50}).json()
    assert len(body["results"]) == 50


def test_send_is_throttled(client_for, member, channel):
    client = client_for(member)
    for i in range(10):
        assert send(client, channel, f"spam {i}").status_code == 201
    assert send(client, channel, "one too many").status_code == 429


def test_message_page_data_needs_at_most_five_queries(
    client_for, user, make_user, server, join, channel, django_assert_max_num_queries
):
    """NFR-PERF-05: the 50 messages themselves (history, attachments, mentions, replies,
    reactions) in ≤ 5 queries; authentication and permission checks come on top."""
    from apps.messaging import services
    from apps.messaging.targets import channel_target

    for i in range(10):
        author = make_user()
        join(server, author)
        first = send(client_for(author), channel, f"msg {i} <@{user.pk}>").json()
        send(client_for(author), channel, "reply", reply_to=first["id"])
        client_for(user).put(reverse("message-reaction", args=[first["id"], "👍"]))
    target = channel_target(user, channel)
    with django_assert_max_num_queries(5):
        messages, _ = services.history(target, limit=50)
        services.serialize(messages, user)
    assert len(messages) == 20
