"""Messages in channels and DMs (FR-MSG-01..13, FR-DM-03, FR-SRCH-01/02).

All entry points take a ``Target`` (targets.py), so permissions, events and read state work the
same for channels and DMs. Events are published after commit (ADR-007).
"""

import unicodedata
from datetime import datetime, time, timedelta
from typing import Any, cast

from django.contrib.postgres.search import SearchQuery
from django.db import IntegrityError, transaction
from django.db.models import Count, F, Min, Prefetch, Q
from django.utils import timezone
from rest_framework import exceptions

from apps.accounts.blocks import blockers_of
from apps.accounts.models import User
from apps.chat_channels.models import Channel, ReadState
from apps.chat_channels.services import mark_read as mark_channel_read
from apps.core.permissions import Perm
from apps.media import services as media
from apps.media.tasks import delete_asset
from apps.notifications import services as notifications
from apps.realtime import events
from apps.realtime.subscriptions import compute_server
from apps.servers.access import members_with_channel_perm

from . import mentions as mention_parser
from .models import (
    MAX_ATTACHMENTS,
    Attachment,
    DMConversation,
    DMParticipant,
    Mention,
    Message,
    Reaction,
)
from .serializers import MessageSerializer
from .targets import Target, channel_target

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 100
MAX_PINS = 50
MAX_REACTION_EMOJIS = 20


def with_relations(qs: Any) -> Any:
    """Everything MessageSerializer needs, in a fixed number of queries."""
    return qs.select_related("author", "reply_to__author").prefetch_related(
        "attachments",
        "reply_to__attachments",
        Prefetch("mentions", queryset=Mention.objects.select_related("user", "role")),
    )


def reaction_summaries(
    message_ids: list[Any], user: User | None
) -> dict[Any, list[dict[str, Any]]]:
    """{message_id: [{emoji, count, me}]}, emojis in the order they were first used."""
    rows = (
        Reaction.objects.filter(message_id__in=message_ids)
        .values("message_id", "emoji")
        .annotate(
            count=Count("id"),
            first=Min("created_at"),
            mine=Count("id", filter=Q(user=user))
            if user is not None
            else Count("id", filter=Q(pk=None)),
        )
        .order_by("message_id", "first")
    )
    result: dict[Any, list[dict[str, Any]]] = {}
    for row in rows:
        result.setdefault(row["message_id"], []).append(
            {"emoji": row["emoji"], "count": row["count"], "me": bool(row["mine"])}
        )
    return result


def serialize(messages: list[Message], user: User | None) -> list[dict[str, Any]]:
    from apps.polls.services import summaries as poll_summaries

    ids = [m.pk for m in messages]
    context = {
        "reactions": reaction_summaries(ids, user),
        "polls": poll_summaries(ids, user),
    }
    return list(MessageSerializer(messages, many=True, context=context).data)


def payload(target: Target, message: Message) -> dict[str, Any]:
    """Broadcast payload: viewer-independent (reaction ``me`` is always false)."""
    fresh = with_relations(Message.objects.filter(pk=message.pk)).get()
    return {**serialize([fresh], None)[0], **target.scope()}


# ---------------------------------------------------------------------------- history


def history(
    target: Target, *, before: Any = None, after: Any = None, limit: int = DEFAULT_PAGE_SIZE
) -> tuple[list[Message], bool]:
    """Cursor pagination over time-ordered UUIDv7 ids.

    - no cursor / ``before``: newest first (scrolling back through history)
    - ``after``: oldest first (backfilling after a reconnect)
    """
    target.require(Perm.READ_MESSAGE_HISTORY)
    limit = max(1, min(limit, MAX_PAGE_SIZE))
    qs = with_relations(target.messages().filter(deleted_at__isnull=True))
    if after is not None:
        qs = qs.filter(id__gt=after).order_by("id")
    else:
        if before is not None:
            qs = qs.filter(id__lt=before)
        qs = qs.order_by("-id")
    rows = list(qs[: limit + 1])
    return rows[:limit], len(rows) > limit


# ---------------------------------------------------------------------------- send


def _safe_filename(name: str) -> str:
    """Display name only: no paths or control characters."""
    name = name.replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(ch for ch in name if ch.isprintable()).strip()
    return name[:255] or "file"


def _attach(target: Target, author: User, message: Message, refs: list[dict[str, Any]]) -> None:
    if not refs:
        return
    target.require(Perm.ATTACH_FILES)
    unique = {ref["public_id"]: ref for ref in refs}
    if len(unique) > MAX_ATTACHMENTS:
        raise exceptions.ValidationError(
            {"attachments": [f"At most {MAX_ATTACHMENTS} attachments."]}
        )
    for public_id, ref in unique.items():
        resource = media.claim_upload(user=author, public_id=public_id, purpose="attachment")
        Attachment.objects.create(
            message=message,
            public_id=public_id,
            resource_type=resource["resource_type"],
            filename=_safe_filename(ref.get("filename") or public_id),
            content_type=(
                f"{resource['resource_type']}/{resource.get('format')}"
                if resource.get("format")
                else "application/octet-stream"
            ),
            size_bytes=int(resource.get("bytes", 0)),
            width=resource.get("width"),
            height=resource.get("height"),
        )


def _reply_target(target: Target, reply_to: Any) -> Message | None:
    if reply_to is None:
        return None
    parent: Message | None = (
        target.messages()
        .filter(pk=reply_to, deleted_at__isnull=True)
        .select_related("author")
        .first()
    )
    if parent is None:
        raise exceptions.ValidationError({"reply_to": ["That message doesn't exist here."]})
    return parent


def _location(target: Target) -> dict[str, Any]:
    if target.channel is not None:
        server = target.access.server if target.access else target.channel.server
        return {
            **target.scope(),
            "server_name": server.name,
            "channel_name": target.channel.name,
        }
    dm = cast(DMConversation, target.dm)
    return {**target.scope(), "dm_name": dm.name, "is_group": dm.is_group}


def _bump_mentions(channel: Channel, user_ids: set[Any]) -> None:
    for user_id in user_ids:
        state, _ = ReadState.objects.get_or_create(user_id=user_id, channel=channel)
        ReadState.objects.filter(pk=state.pk).update(mention_count=F("mention_count") + 1)
        state.refresh_from_db()
        events.to_user(
            user_id,
            "read_state.updated",
            {
                "channel_id": str(channel.pk),
                "dm_id": None,
                "server_id": str(channel.server_id),
                "last_read_message_id": (
                    str(state.last_read_message_id) if state.last_read_message_id else None
                ),
                "mention_count": state.mention_count,
            },
        )


def _fan_out_channel(target: Target, message: Message, parsed: Any, parent: Message | None) -> None:
    """Mentions and replies: badges (mention_count) and inbox notifications."""
    channel = cast(Channel, target.channel)
    author_id = message.author_id
    direct = set(parsed.user_ids)
    if parent is not None and parent.author_id:
        direct.add(parent.author_id)
    candidates = set(direct)
    role_ids = [r.pk for r in parsed.effective_roles]
    broad: set[Any] = set()
    if parsed.everyone or role_ids:
        audience = members_with_channel_perm(channel, Perm.VIEW_CHANNEL)
        for user_id, access in audience.items():
            if parsed.everyone or access.role_ids & set(role_ids):
                broad.add(user_id)
        candidates |= broad
    candidates.discard(author_id)
    if not candidates:
        return
    can_view = set(members_with_channel_perm(channel, Perm.VIEW_CHANNEL, candidates))
    blocked = blockers_of(author_id, can_view) if author_id else set()
    muted = notifications.muted_for_channel(
        can_view, server_id=channel.server_id, channel_id=channel.pk
    )
    # Direct mentions and replies always notify; @everyone/@role respect mutes.
    reach = {u for u in can_view - blocked if u in direct or u not in muted}
    if not reach:
        return
    _bump_mentions(channel, reach)
    data = {**_location(target), "content": message.content[:200]}
    replied = {parent.author_id} & reach if parent is not None and parent.author_id else set()
    mentioned = reach - (replied - set(parsed.user_ids))
    if mentioned:
        notifications.create(
            mentioned, type="mention", message=message, actor=message.author, data=data
        )
    reply_only = reach - mentioned
    if reply_only:
        notifications.create(
            reply_only, type="reply", message=message, actor=message.author, data=data
        )


def _fan_out_dm(target: Target, message: Message) -> None:
    dm = cast(DMConversation, target.dm)
    others = list(DMParticipant.objects.filter(conversation=dm).exclude(user=message.author))
    other_ids = {p.user_id for p in others}
    blocked = blockers_of(message.author_id, other_ids) if message.author_id else set()
    reopened = [p.user_id for p in others if p.closed and p.user_id not in blocked]
    if reopened:
        DMParticipant.objects.filter(conversation=dm, user_id__in=reopened).update(closed=False)
        for user_id in reopened:
            events.to_user(user_id, "dm.updated", {"dm_id": str(dm.pk)})
    counted = other_ids - blocked
    DMParticipant.objects.filter(conversation=dm, user_id__in=counted).update(
        unread_count=F("unread_count") + 1
    )
    for participant in DMParticipant.objects.filter(conversation=dm, user_id__in=counted):
        events.to_user(
            participant.user_id,
            "read_state.updated",
            {
                "channel_id": None,
                "dm_id": str(dm.pk),
                "server_id": None,
                "last_read_message_id": (
                    str(participant.last_read_message_id)
                    if participant.last_read_message_id
                    else None
                ),
                "mention_count": participant.unread_count,
            },
        )
    notify = counted - notifications.muted_for_dm(counted, dm.pk)
    if notify:
        notifications.notify_dm(
            notify,
            message=message,
            actor=message.author,
            data={**_location(target), "content": message.content[:200]},
        )


def mark_dm_read(user: User, dm: DMConversation, message_id: Any) -> DMParticipant:
    participant = DMParticipant.objects.get(conversation=dm, user=user)
    if participant.last_read_message_id is None or message_id > participant.last_read_message_id:
        participant.last_read_message_id = message_id
    participant.unread_count = 0
    participant.save(update_fields=["last_read_message_id", "unread_count"])
    events.to_user(
        user.pk,
        "read_state.updated",
        {
            "channel_id": None,
            "dm_id": str(dm.pk),
            "server_id": None,
            "last_read_message_id": str(participant.last_read_message_id),
            "mention_count": 0,
        },
    )
    notifications.mark_dm_read(user, dm.pk)
    return participant


@transaction.atomic
def send_message(
    target: Target,
    *,
    author: User,
    content: str,
    nonce: str | None = None,
    reply_to: Any = None,
    attachments: list[dict[str, Any]] | None = None,
    poll: dict[str, Any] | None = None,
) -> tuple[Message, bool]:
    """Returns (message, created). A repeated nonce returns the original message (FR-MSG-11)."""
    target.require(Perm.SEND_MESSAGES)
    if poll:
        target.require(Perm.CREATE_POLLS)
    nonce = nonce or None
    if nonce:
        existing = Message.objects.filter(author=author, nonce=nonce).first()
        if existing is not None:
            if (existing.channel_id or existing.dm_id) != target.id:
                raise exceptions.ValidationError(
                    {"nonce": ["This nonce was already used."]}, code="nonce_reused"
                )
            return refetch(existing), False
    parent = _reply_target(target, reply_to)
    parsed = mention_parser.parse(target, content)
    try:
        with transaction.atomic():
            message = Message.objects.create(
                **{target.kind: target.dm if target.dm is not None else target.channel},
                author=author,
                content=content,
                nonce=nonce,
                reply_to=parent,
                type=(
                    Message.Type.POLL
                    if poll
                    else Message.Type.REPLY
                    if parent is not None
                    else Message.Type.DEFAULT
                ),
                mention_everyone=parsed.everyone,
            )
    except IntegrityError:  # concurrent retry with the same nonce
        return refetch(Message.objects.get(author=author, nonce=nonce)), False
    _attach(target, author, message, attachments or [])
    if poll:
        from apps.polls import services as polls

        polls.create(message, **poll)
    Mention.objects.bulk_create(
        [Mention(message=message, user_id=uid) for uid in parsed.user_ids]
        + [Mention(message=message, role=role) for role in parsed.roles]
    )
    # Viewers get the message before any badge or notification about it.
    events.publish(target.group, "message.created", payload(target, message))
    if target.channel is not None:
        Channel.objects.filter(pk=target.id).update(last_message_id=message.pk)
        mark_channel_read(author, target.channel, message.pk)  # your own message is read
        _fan_out_channel(target, message, parsed, parent)
    else:
        DMConversation.objects.filter(pk=target.id).update(last_message_id=message.pk)
        mark_dm_read(author, cast(DMConversation, target.dm), message.pk)
        _fan_out_dm(target, message)
    return refetch(message), True


def _delete_assets(assets: list[tuple[str, str]]) -> None:
    for public_id, resource_type in assets:
        delete_asset.delay(public_id, resource_type)


def refetch(message: Message) -> Message:
    fresh: Message = with_relations(Message.objects.filter(pk=message.pk)).get()
    return fresh


def get_message(message_id: Any) -> Message:
    message = (
        Message.objects.select_related("author", "channel__server", "dm")
        .prefetch_related("channel__overwrites")
        .filter(pk=message_id, deleted_at__isnull=True)
        .first()
    )
    if message is None:
        raise exceptions.NotFound()
    return message


@transaction.atomic
def edit_message(target: Target, message: Message, content: str) -> Message:
    if message.author_id != target.user.pk:
        raise exceptions.PermissionDenied("You can only edit your own messages.", code="not_author")
    parsed = mention_parser.parse(target, content)
    message.content = content
    message.edited_at = timezone.now()
    message.mention_everyone = parsed.everyone
    message.save(update_fields=["content", "edited_at", "mention_everyone", "updated_at"])
    # Mentions follow the text; edits don't send new notifications.
    message.mentions.all().delete()
    Mention.objects.bulk_create(
        [Mention(message=message, user_id=uid) for uid in parsed.user_ids]
        + [Mention(message=message, role=role) for role in parsed.roles]
    )
    events.publish(target.group, "message.updated", payload(target, message))
    return refetch(message)


@transaction.atomic
def delete_message(target: Target, message: Message) -> None:
    """Authors delete their own; MANAGE_MESSAGES deletes anyone's (FR-MSG-03/04)."""
    if message.author_id != target.user.pk and not target.has(Perm.MANAGE_MESSAGES):
        raise exceptions.PermissionDenied(
            "You can only delete your own messages.", code="not_author"
        )
    if message.author_id != target.user.pk and target.channel is not None:
        from apps.servers import audit

        audit.record(
            target.channel.server_id,
            target.user,
            audit.Action.MESSAGE_DELETE,
            target_type="message",
            target_id=message.pk,
            label=f"#{target.channel.name}",
            changes={
                "author": message.author.username if message.author else None,
                "content": message.content[:500],
            },
        )
    was_pinned = message.pinned_at is not None
    message.deleted_at = timezone.now()
    message.content = ""
    message.pinned_at = None
    message.save(update_fields=["deleted_at", "content", "pinned_at", "updated_at"])
    assets = list(message.attachments.values_list("public_id", "resource_type"))
    transaction.on_commit(lambda: _delete_assets(assets))
    message.attachments.all().delete()
    message.reactions.all().delete()
    message.mentions.all().delete()
    from apps.notifications.models import Notification

    Notification.objects.filter(message=message).delete()
    events.publish(target.group, "message.deleted", {"id": str(message.pk), **target.scope()})
    if was_pinned:
        events.publish(target.group, "pins.updated", target.scope())


# ---------------------------------------------------------------------------- reactions


def validate_emoji(emoji: str) -> str:
    """Unicode emoji only (FR-MSG-09): pictographs plus their joiners and modifiers."""
    if not emoji or len(emoji) > 16 or len(emoji.encode()) > 32:
        raise exceptions.ValidationError({"emoji": ["Not an emoji."]}, code="invalid_emoji")
    allowed_marks = {"‍", "️", "︎", "⃣"}
    has_symbol = False
    for char in emoji:
        category = unicodedata.category(char)
        if char in allowed_marks or category in {"Mn", "Me"} or 0x1F3FB <= ord(char) <= 0x1F3FF:
            continue
        if category == "So" or 0x1F1E6 <= ord(char) <= 0x1F1FF:
            has_symbol = True
            continue
        if char in "#*0123456789" and len(emoji) > 1:  # keycaps like 1️⃣
            continue
        raise exceptions.ValidationError({"emoji": ["Not an emoji."]}, code="invalid_emoji")
    if not has_symbol and "⃣" not in emoji:
        raise exceptions.ValidationError({"emoji": ["Not an emoji."]}, code="invalid_emoji")
    return emoji


def _reaction_event(target: Target, message: Message, emoji: str, user: User, kind: str) -> None:
    count = Reaction.objects.filter(message=message, emoji=emoji).count()
    events.publish(
        target.group,
        kind,
        {
            "message_id": str(message.pk),
            "emoji": emoji,
            "user_id": str(user.pk),
            "count": count,
            **target.scope(),
        },
    )


def add_reaction(target: Target, message: Message, emoji: str) -> None:
    emoji = validate_emoji(emoji)
    target.require(Perm.READ_MESSAGE_HISTORY)
    existing = set(Reaction.objects.filter(message=message).values_list("emoji", flat=True))
    if emoji not in existing:
        target.require(Perm.ADD_REACTIONS)  # joining an existing reaction needs only view
        if len(existing) >= MAX_REACTION_EMOJIS:
            raise exceptions.ValidationError(
                {"emoji": [f"At most {MAX_REACTION_EMOJIS} different reactions per message."]},
                code="too_many_reactions",
            )
    elif target.blocked:
        target.require(Perm.ADD_REACTIONS)
    _, created = Reaction.objects.get_or_create(message=message, user=target.user, emoji=emoji)
    if created:
        _reaction_event(target, message, emoji, target.user, "reaction.added")


def remove_reaction(target: Target, message: Message, emoji: str) -> None:
    deleted, _ = Reaction.objects.filter(message=message, user=target.user, emoji=emoji).delete()
    if deleted:
        _reaction_event(target, message, emoji, target.user, "reaction.removed")


def reaction_users(target: Target, message: Message, emoji: str) -> list[User]:
    target.require(Perm.READ_MESSAGE_HISTORY)
    return [
        r.user
        for r in Reaction.objects.filter(message=message, emoji=emoji)
        .select_related("user")
        .order_by("created_at")[:100]
    ]


# ---------------------------------------------------------------------------- pins


def _require_pin_rights(target: Target) -> None:
    if target.channel is not None:
        target.require(Perm.MANAGE_MESSAGES)


def pin(target: Target, message: Message) -> Message:
    _require_pin_rights(target)
    if message.pinned_at is None:
        if target.messages().filter(pinned_at__isnull=False).count() >= MAX_PINS:
            raise exceptions.ValidationError(
                {"non_field_errors": [f"A conversation can have at most {MAX_PINS} pins."]},
                code="too_many_pins",
            )
        message.pinned_at = timezone.now()
        message.save(update_fields=["pinned_at", "updated_at"])
        events.publish(target.group, "message.updated", payload(target, message))
        events.publish(target.group, "pins.updated", target.scope())
    return message


def unpin(target: Target, message: Message) -> None:
    _require_pin_rights(target)
    if message.pinned_at is not None:
        message.pinned_at = None
        message.save(update_fields=["pinned_at", "updated_at"])
        events.publish(target.group, "message.updated", payload(target, message))
        events.publish(target.group, "pins.updated", target.scope())


def pins(target: Target) -> list[Message]:
    target.require(Perm.READ_MESSAGE_HISTORY)
    return list(
        with_relations(
            target.messages().filter(pinned_at__isnull=False, deleted_at__isnull=True)
        ).order_by("-pinned_at")
    )


# ---------------------------------------------------------------------------- search


def _day_start(day: Any) -> datetime:
    return timezone.make_aware(datetime.combine(day, time.min))


def search(
    user: User,
    *,
    server_id: Any = None,
    target: Target | None = None,
    q: str = "",
    author: Any = None,
    channel: Any = None,
    has: str | None = None,
    before: Any = None,
    after: Any = None,
    cursor: Any = None,
    limit: int = 25,
) -> dict[str, Any]:
    """Full-text search (FR-SRCH-01/02), newest first. Server search covers only channels where
    the user has READ_MESSAGE_HISTORY."""
    if target is not None:
        target.require(Perm.READ_MESSAGE_HISTORY)
        qs = target.messages()
    else:
        visible = compute_server(user, server_id)
        if visible is None:
            raise exceptions.NotFound()
        readable = [cid for cid, perms in visible.items() if perms & Perm.READ_MESSAGE_HISTORY]
        if channel is not None:
            readable = [cid for cid in readable if cid == str(channel)]
        qs = Message.objects.filter(channel_id__in=readable)
    qs = qs.filter(deleted_at__isnull=True)
    if q.strip():
        qs = qs.filter(search_vector=SearchQuery(q, search_type="websearch", config="simple"))
    if author is not None:
        qs = qs.filter(author_id=author)
    if has == "attachment":
        qs = qs.filter(attachments__isnull=False)
    elif has == "image":
        qs = qs.filter(attachments__resource_type="image")
    elif has == "file":
        qs = qs.filter(attachments__resource_type="raw")
    if before is not None:
        qs = qs.filter(created_at__lt=_day_start(before))
    if after is not None:
        qs = qs.filter(created_at__gte=_day_start(after) + timedelta(days=1))
    qs = qs.distinct()
    total = qs.count()
    if cursor is not None:
        qs = qs.filter(id__lt=cursor)
    rows = list(with_relations(qs).order_by("-id")[: limit + 1])
    page = rows[:limit]
    return {
        "results": page,
        "total": total,
        "next_cursor": page[-1].pk if len(rows) > limit else None,
    }


def channel_search_target(user: User, channel_id: Any) -> Target:
    return channel_target(user, channel_id)


# ---------------------------------------------------------------------------- reports


def report(target: Target, message: Message, reason: str) -> None:
    """FR-MOD-03: flag a message for site staff (Django admin)."""
    from .models import MessageReport

    if message.author_id == target.user.pk:
        raise exceptions.ValidationError({"message": ["You can't report your own message."]})
    try:
        with transaction.atomic():
            MessageReport.objects.create(
                message=message,
                reporter=target.user,
                reason=reason.strip(),
                content_snapshot=message.content,
            )
    except IntegrityError:
        raise exceptions.ValidationError(
            {"message": ["You already reported this message."]}, code="already_reported"
        ) from None
