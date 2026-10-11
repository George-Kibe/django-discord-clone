"""Channel messages over REST (FR-MSG-01, 03..05, 11). Real-time fan-out arrives in Phase 4."""

from typing import Any

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import exceptions

from apps.accounts.models import User
from apps.chat_channels.models import Channel
from apps.core.permissions import Perm
from apps.servers.access import ServerAccess

from .models import Message

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 100


def history(
    channel: Channel, *, before: Any = None, after: Any = None, limit: int = DEFAULT_PAGE_SIZE
) -> tuple[list[Message], bool]:
    """Cursor pagination over time-ordered UUIDv7 ids.

    - no cursor / ``before``: newest first (scrolling back through history)
    - ``after``: oldest first (backfilling after a reconnect)
    Returns (messages, has_more).
    """
    limit = max(1, min(limit, MAX_PAGE_SIZE))
    qs = Message.objects.filter(channel=channel, deleted_at__isnull=True).select_related("author")
    if after is not None:
        qs = qs.filter(id__gt=after).order_by("id")
    else:
        if before is not None:
            qs = qs.filter(id__lt=before)
        qs = qs.order_by("-id")
    rows = list(qs[: limit + 1])
    return rows[:limit], len(rows) > limit


@transaction.atomic
def send_message(
    access: ServerAccess, channel: Channel, *, author: User, content: str, nonce: str | None = None
) -> tuple[Message, bool]:
    """Returns (message, created). A repeated nonce returns the original message (FR-MSG-11)."""
    access.require_channel(channel, Perm.SEND_MESSAGES)
    nonce = nonce or None
    if nonce:
        existing = (
            Message.objects.filter(author=author, nonce=nonce).select_related("author").first()
        )
        if existing is not None:
            if existing.channel_id != channel.pk:
                raise exceptions.ValidationError(
                    {"nonce": ["This nonce was already used."]}, code="nonce_reused"
                )
            return existing, False
    try:
        with transaction.atomic():
            message = Message.objects.create(
                channel=channel, author=author, content=content, nonce=nonce
            )
    except IntegrityError:  # concurrent retry with the same nonce
        return Message.objects.select_related("author").get(author=author, nonce=nonce), False
    Channel.objects.filter(pk=channel.pk).update(last_message_id=message.pk)
    return message, True


def get_message(message_id: Any) -> Message:
    message = (
        Message.objects.select_related("author", "channel__server")
        .prefetch_related("channel__overwrites")
        .filter(pk=message_id, deleted_at__isnull=True)
        .first()
    )
    if message is None:
        raise exceptions.NotFound()
    return message


def edit_message(access: ServerAccess, message: Message, content: str) -> Message:
    access.require_channel(message.channel, Perm.VIEW_CHANNEL)
    if message.author_id != access.user.pk:
        raise exceptions.PermissionDenied("You can only edit your own messages.", code="not_author")
    message.content = content
    message.edited_at = timezone.now()
    message.save(update_fields=["content", "edited_at", "updated_at"])
    return message


def delete_message(access: ServerAccess, message: Message) -> None:
    """Authors delete their own; MANAGE_MESSAGES deletes anyone's (FR-MSG-03/04)."""
    perms = access.require_channel(message.channel, Perm.VIEW_CHANNEL)
    if message.author_id != access.user.pk and not perms & Perm.MANAGE_MESSAGES:
        raise exceptions.PermissionDenied(
            "You can only delete your own messages.", code="not_author"
        )
    message.deleted_at = timezone.now()
    message.content = ""
    message.save(update_fields=["deleted_at", "content", "updated_at"])
