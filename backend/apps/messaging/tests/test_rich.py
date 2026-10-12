"""Replies, mentions, reactions, pins, attachments and search in channels (Phase 5)."""

import datetime
from typing import Any
from unittest import mock

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import BlockedUser
from apps.chat_channels.models import Channel, PermissionOverwrite, ReadState
from apps.core.permissions import Perm
from apps.media.models import PendingUpload
from apps.messaging.models import Attachment, Message, Reaction
from apps.notifications.models import MuteSetting, Notification
from apps.servers.models import Role

pytestmark = pytest.mark.django_db


@pytest.fixture
def channel(server):
    return Channel.objects.get(server=server, name="general")


@pytest.fixture
def ana(make_user, server, join):
    user = make_user(username="ana")
    join(server, user)
    return user


@pytest.fixture
def bo(make_user, server, join):
    user = make_user(username="bo")
    join(server, user)
    return user


def post(client, channel, content="hello", **extra: Any):
    return client.post(
        reverse("channel-messages", args=[channel.pk]),
        {"content": content, **extra},
        format="json",
    )


def sent(client, channel, content="hello", **extra: Any) -> dict[str, Any]:
    response = post(client, channel, content, **extra)
    assert response.status_code == 201, response.content
    body: dict[str, Any] = response.json()
    return body


def mention_count(user, channel) -> int:
    state = ReadState.objects.filter(user=user, channel=channel).first()
    return state.mention_count if state else 0


# ---------------------------------------------------------------------------- replies


def test_reply_shows_quoted_preview_and_notifies_author(client_for, ana, bo, channel):
    original = sent(client_for(ana), channel, "what's the homework?")
    reply = sent(client_for(bo), channel, "chapter 3", reply_to=original["id"])
    assert reply["type"] == "reply"
    assert reply["reply_to"]["id"] == original["id"]
    assert reply["reply_to"]["author"]["username"] == "ana"
    assert reply["reply_to"]["content"] == "what's the homework?"
    notification = Notification.objects.get(user=ana)
    assert notification.type == "reply"
    assert notification.data["channel_name"] == "general"
    assert mention_count(ana, channel) == 1


def test_reply_to_a_message_elsewhere_is_rejected(client_for, user, ana, server, channel):
    other = Channel.objects.create(server=server, name="other", position=5)
    elsewhere = sent(client_for(ana), other, "hi")
    response = post(client_for(ana), channel, "x", reply_to=elsewhere["id"])
    assert response.status_code == 400


def test_reply_preview_of_deleted_message(client_for, ana, bo, channel):
    original = sent(client_for(ana), channel, "oops")
    reply = sent(client_for(bo), channel, "ha", reply_to=original["id"])
    client_for(ana).delete(reverse("message", args=[original["id"]]))
    history = client_for(bo).get(reverse("channel-messages", args=[channel.pk])).json()
    preview = next(m for m in history["results"] if m["id"] == reply["id"])["reply_to"]
    assert preview["deleted"] is True and preview["content"] == ""


# ---------------------------------------------------------------------------- mentions


def test_user_mention_notifies_and_counts(client_for, ana, bo, channel):
    message = sent(client_for(ana), channel, f"hey <@{bo.pk}> look")
    assert [m["username"] for m in message["mentions"]] == ["bo"]
    notification = Notification.objects.get(user=bo)
    assert notification.type == "mention"
    assert notification.actor == ana
    assert notification.data["content"] == f"hey <@{bo.pk}> look"
    assert mention_count(bo, channel) == 1
    assert not Notification.objects.filter(user=ana).exists()  # self excluded


def test_mentions_of_non_members_are_ignored(client_for, ana, make_user, channel):
    stranger = make_user()
    message = sent(client_for(ana), channel, f"<@{stranger.pk}> and <@not-a-uuid>")
    assert message["mentions"] == []
    assert not Notification.objects.exists()


def test_mention_of_member_who_cant_see_channel_doesnt_notify(
    client_for, user, ana, bo, server, channel
):
    from apps.servers.models import Member

    PermissionOverwrite.objects.create(
        channel=channel, member=Member.objects.get(user=bo), allow=0, deny=int(Perm.VIEW_CHANNEL)
    )
    sent(client_for(ana), channel, f"<@{bo.pk}>")
    assert not Notification.objects.filter(user=bo).exists()


def test_everyone_needs_permission(client_for, user, ana, bo, channel):
    plain = sent(client_for(ana), channel, "@everyone hi")
    assert plain["mention_everyone"] is False
    assert not Notification.objects.exists()
    loud = sent(client_for(user), channel, "@everyone meeting now")  # owner has every permission
    assert loud["mention_everyone"] is True
    assert set(Notification.objects.values_list("user__username", flat=True)) == {"ana", "bo"}
    assert mention_count(ana, channel) == 1 and mention_count(bo, channel) == 1


def test_role_mentions_respect_mentionable(client_for, user, ana, bo, server, channel):
    role = Role.objects.create(server=server, name="Study", position=1)
    bo.memberships.get(server=server).roles.add(role)
    message = sent(client_for(ana), channel, f"<@&{role.pk}> anyone?")
    assert message["mention_roles"] == [{"id": str(role.pk), "name": "Study", "color": 0}]
    assert not Notification.objects.exists()  # not mentionable, and ana lacks MENTION_EVERYONE
    role.mentionable = True
    role.save()
    sent(client_for(ana), channel, f"<@&{role.pk}> anyone?")
    assert list(Notification.objects.values_list("user__username", flat=True)) == ["bo"]


def test_mute_suppresses_broad_mentions_but_not_direct_ones(client_for, user, ana, server, channel):
    MuteSetting.objects.create(user=ana, server=server)
    sent(client_for(user), channel, "@everyone ping")
    assert not Notification.objects.filter(user=ana).exists()
    sent(client_for(user), channel, f"<@{ana.pk}> you specifically")
    assert Notification.objects.filter(user=ana, type="mention").count() == 1


def test_expired_mute_no_longer_applies(client_for, user, ana, channel):
    MuteSetting.objects.create(
        user=ana, channel=channel, muted_until=timezone.now() - datetime.timedelta(minutes=1)
    )
    sent(client_for(user), channel, "@everyone ping")
    assert Notification.objects.filter(user=ana).exists()


def test_blocked_author_doesnt_notify(client_for, ana, bo, channel):
    BlockedUser.objects.create(blocker=bo, blocked=ana)
    sent(client_for(ana), channel, f"<@{bo.pk}>")
    assert not Notification.objects.filter(user=bo).exists()
    assert mention_count(bo, channel) == 0


def test_ack_resets_mention_count(client_for, ana, bo, channel):
    message = sent(client_for(ana), channel, f"<@{bo.pk}>")
    client_for(bo).post(
        reverse("channel-ack", args=[channel.pk]), {"message_id": message["id"]}, format="json"
    )
    assert mention_count(bo, channel) == 0


def test_edit_updates_mentions_without_notifying_again(client_for, ana, bo, channel):
    message = sent(client_for(ana), channel, "hi")
    response = client_for(ana).patch(
        reverse("message", args=[message["id"]]), {"content": f"hi <@{bo.pk}>"}, format="json"
    )
    assert [m["id"] for m in response.json()["mentions"]] == [str(bo.pk)]
    assert not Notification.objects.exists()


# ---------------------------------------------------------------------------- reactions


def reaction_url(message_id, emoji):
    return reverse("message-reaction", args=[message_id, emoji])


def test_reactions_add_remove_and_summarise(client_for, ana, bo, channel):
    message = sent(client_for(ana), channel)
    assert client_for(ana).put(reaction_url(message["id"], "👍")).status_code == 204
    assert client_for(bo).put(reaction_url(message["id"], "👍")).status_code == 204
    assert client_for(bo).put(reaction_url(message["id"], "🎉")).status_code == 204
    assert client_for(bo).put(reaction_url(message["id"], "🎉")).status_code == 204  # idempotent
    history = client_for(ana).get(reverse("channel-messages", args=[channel.pk])).json()
    assert history["results"][0]["reactions"] == [
        {"emoji": "👍", "count": 2, "me": True},
        {"emoji": "🎉", "count": 1, "me": False},
    ]
    users = client_for(ana).get(reaction_url(message["id"], "👍")).json()
    assert [u["username"] for u in users["users"]] == ["ana", "bo"]
    assert client_for(bo).delete(reaction_url(message["id"], "👍")).status_code == 204
    assert Reaction.objects.filter(emoji="👍").count() == 1


@pytest.mark.parametrize("emoji", ["👍🏽", "👨‍👩‍👧", "🇰🇪", "1️⃣", "❤️"])
def test_emoji_validation_accepts_unicode_emoji(client_for, ana, channel, emoji):
    message = sent(client_for(ana), channel)
    assert client_for(ana).put(reaction_url(message["id"], emoji)).status_code == 204


@pytest.mark.parametrize("emoji", ["a", ":smile:", "<b>", "1", "👍" * 9])
def test_emoji_validation_rejects_text(client_for, ana, channel, emoji):
    message = sent(client_for(ana), channel)
    assert client_for(ana).put(reaction_url(message["id"], emoji)).status_code == 400


def test_new_reactions_need_add_reactions(client_for, ana, bo, server, channel):
    message = sent(client_for(ana), channel)
    client_for(ana).put(reaction_url(message["id"], "👍"))
    everyone = Role.objects.get(server=server, is_default=True)
    everyone.permissions &= ~int(Perm.ADD_REACTIONS)
    everyone.save()
    assert client_for(bo).put(reaction_url(message["id"], "🎉")).status_code == 403
    assert client_for(bo).put(reaction_url(message["id"], "👍")).status_code == 204  # join existing


def test_reaction_limit(client_for, ana, channel):
    message = sent(client_for(ana), channel)
    emojis = "😀😃😄😁😆😅😂🤣😊😇🙂🙃😉😌😍🥰😘😗😙😚"
    for emoji in emojis:
        assert client_for(ana).put(reaction_url(message["id"], emoji)).status_code == 204
    assert client_for(ana).put(reaction_url(message["id"], "🤔")).status_code == 400


# ---------------------------------------------------------------------------- pins


def test_pins_need_manage_messages(client_for, user, ana, channel):
    message = sent(client_for(ana), channel)
    pin_url = reverse("message-pin", args=[message["id"]])
    assert client_for(ana).put(pin_url).status_code == 403
    response = client_for(user).put(pin_url)
    assert response.status_code == 200 and response.json()["pinned_at"]
    pins = client_for(ana).get(reverse("channel-pins", args=[channel.pk])).json()
    assert [p["id"] for p in pins] == [message["id"]]
    assert client_for(user).delete(pin_url).status_code == 204
    assert client_for(ana).get(reverse("channel-pins", args=[channel.pk])).json() == []


def test_pin_limit(client_for, user, channel):
    Message.objects.bulk_create(
        [
            Message(channel=channel, author=user, content=f"m{i}", pinned_at=timezone.now())
            for i in range(50)
        ]
    )
    extra = sent(client_for(user), channel, "one more")
    assert client_for(user).put(reverse("message-pin", args=[extra["id"]])).status_code == 400


# ---------------------------------------------------------------------------- attachments


def _resource(public_id: str, resource_type: str = "image") -> dict[str, Any]:
    if resource_type == "image":
        return {"public_id": public_id, "format": "png", "bytes": 2048, "width": 640, "height": 480}
    return {"public_id": public_id, "bytes": 4096}


def upload(user, resource_type="image") -> dict[str, str]:
    suffix = "" if resource_type == "image" else ".pdf"
    public_id = f"test/attachments/{user.pk}/{len(PendingUpload.objects.all())}{suffix}"
    PendingUpload.objects.create(
        user=user, public_id=public_id, purpose="attachment", resource_type=resource_type
    )
    name = "photo.png" if resource_type == "image" else "../../notes\x07.pdf"
    return {"public_id": public_id, "filename": name}


def test_attachments_are_claimed_and_serialized(client_for, ana, channel):
    image, pdf = upload(ana), upload(ana, "raw")

    def fake_resource(public_id, resource_type):
        return _resource(public_id, resource_type)

    with mock.patch("cloudinary.api.resource", side_effect=fake_resource):
        message = sent(client_for(ana), channel, "", attachments=[image, pdf])
    first, second = message["attachments"]
    assert first["is_image"] and first["width"] == 640
    assert first["preview_url"].startswith("https://res.cloudinary.com/test-cloud/image/upload/")
    assert first["filename"] == "photo.png"
    assert second["filename"] == "notes.pdf"  # path parts and control characters stripped
    assert not second["is_image"] and second["preview_url"] is None
    assert second["url"].endswith(".pdf")
    assert not PendingUpload.objects.exists()


def test_attachments_of_someone_else_are_rejected(client_for, ana, bo, channel):
    foreign = upload(bo)
    with mock.patch("cloudinary.api.resource", side_effect=AssertionError("not reached")):
        response = post(client_for(ana), channel, "x", attachments=[foreign])
    assert response.status_code == 400
    assert not Message.objects.exists()  # the whole send rolls back


def test_attachments_need_attach_files(client_for, ana, server, channel):
    everyone = Role.objects.get(server=server, is_default=True)
    everyone.permissions &= ~int(Perm.ATTACH_FILES)
    everyone.save()
    response = post(client_for(ana), channel, "x", attachments=[upload(ana)])
    assert response.status_code == 403


def test_too_many_attachments(client_for, ana, channel):
    response = post(client_for(ana), channel, "x", attachments=[upload(ana) for _ in range(6)])
    assert response.status_code == 400


def test_deleting_a_message_removes_its_files(
    client_for, ana, channel, django_capture_on_commit_callbacks
):
    with mock.patch("cloudinary.api.resource", side_effect=lambda p, resource_type: _resource(p)):
        message = sent(client_for(ana), channel, "pic", attachments=[upload(ana)])
    with (
        mock.patch("apps.media.tasks.services.delete_asset") as delete,
        django_capture_on_commit_callbacks(execute=True),
    ):
        client_for(ana).delete(reverse("message", args=[message["id"]]))
    delete.assert_called_once()
    assert not Attachment.objects.exists()


def test_empty_message_needs_content_or_attachments(client_for, ana, channel):
    assert post(client_for(ana), channel, "   ").status_code == 400


# ---------------------------------------------------------------------------- search


def search(client, server, **params: Any):
    return client.get(reverse("server-message-search", args=[server.pk]), params)


def test_search_finds_words_and_filters(client_for, user, ana, bo, server, channel):
    sent(client_for(ana), channel, "Photosynthesis notes for biology")
    sent(client_for(bo), channel, "biology exam on friday")
    sent(client_for(bo), channel, "unrelated chatter")
    body = search(client_for(user), server, q="biology").json()
    assert body["total"] == 2
    assert [m["content"] for m in body["results"]] == [
        "biology exam on friday",
        "Photosynthesis notes for biology",
    ]
    by_ana = search(client_for(user), server, q="biology", author=str(ana.pk)).json()
    assert by_ana["total"] == 1
    phrase = search(client_for(user), server, q='"exam on friday"').json()
    assert phrase["total"] == 1
    excluded = search(client_for(user), server, q="biology -exam").json()
    assert excluded["total"] == 1


def test_search_respects_channel_visibility(client_for, user, ana, server, channel):
    secret = Channel.objects.create(server=server, name="staff", position=3)
    everyone = Role.objects.get(server=server, is_default=True)
    PermissionOverwrite.objects.create(
        channel=secret, role=everyone, allow=0, deny=int(Perm.VIEW_CHANNEL)
    )
    sent(client_for(user), secret, "secret plans")
    sent(client_for(user), channel, "public plans")
    body = search(client_for(ana), server, q="plans").json()
    assert [m["content"] for m in body["results"]] == ["public plans"]
    assert search(client_for(user), server, q="plans").json()["total"] == 2


def test_search_dates_attachments_and_paging(client_for, user, server, channel):
    for i in range(3):
        sent(client_for(user), channel, f"note {i}")
    with mock.patch("cloudinary.api.resource", side_effect=lambda p, resource_type: _resource(p)):
        sent(client_for(user), channel, "note with pic", attachments=[upload(user)])
    assert search(client_for(user), server, has="image").json()["total"] == 1
    assert search(client_for(user), server, has="file").json()["total"] == 0
    tomorrow = (timezone.now() + datetime.timedelta(days=1)).date().isoformat()
    assert search(client_for(user), server, q="note", before=tomorrow).json()["total"] == 4
    assert search(client_for(user), server, q="note", after=tomorrow).json()["total"] == 0
    page = search(client_for(user), server, q="note", limit=3).json()
    rest = search(client_for(user), server, q="note", cursor=page["next_cursor"]).json()
    assert len(page["results"]) == 3 and len(rest["results"]) == 1


def test_search_requires_something_and_membership(client_for, make_user, server):
    assert search(client_for(make_user()), server, q="x").status_code == 404
    from apps.servers.models import Member

    member = Member.objects.get(server=server, user=server.owner)
    assert search(client_for(member.user), server).status_code == 400
