"""Inbox notifications and mute settings (FR-PRES-02, FR-PRES-04)."""

from collections.abc import Iterable
from typing import Any

from django.db import transaction
from django.db.models import Q
from django.http import Http404
from django.utils import timezone

from apps.realtime import events

from .models import MuteSetting, Notification
from .serializers import NotificationSerializer


def _active_mutes() -> Any:
    now = timezone.now()
    return MuteSetting.objects.filter(Q(muted_until__isnull=True) | Q(muted_until__gt=now))


def muted_for_channel(user_ids: Iterable[Any], *, server_id: Any, channel_id: Any) -> set[Any]:
    """Users who muted this channel or its server."""
    return set(
        _active_mutes()
        .filter(Q(server_id=server_id) | Q(channel_id=channel_id), user_id__in=list(user_ids))
        .values_list("user_id", flat=True)
    )


def muted_for_dm(user_ids: Iterable[Any], dm_id: Any) -> set[Any]:
    return set(
        _active_mutes()
        .filter(dm_id=dm_id, user_id__in=list(user_ids))
        .values_list("user_id", flat=True)
    )


def _publish(notification: Notification, event: str = "notification.created") -> None:
    events.to_user(notification.user_id, event, NotificationSerializer(notification).data)


def create(
    user_ids: Iterable[Any], *, type: str, message: Any, actor: Any, data: dict[str, Any]
) -> list[Notification]:
    rows = [
        Notification(user_id=uid, type=type, message=message, actor=actor, data=data)
        for uid in user_ids
    ]
    created = Notification.objects.bulk_create(rows)
    for notification in created:
        notification.actor = actor
        _publish(notification)
    return created


def notify_dm(user_ids: Iterable[Any], *, message: Any, actor: Any, data: dict[str, Any]) -> None:
    """One unread entry per conversation: later messages update it (count, preview, time)."""
    dm_id = data["dm_id"]
    for uid in user_ids:
        with transaction.atomic():
            existing = (
                Notification.objects.select_for_update()
                .filter(user_id=uid, type=Notification.Type.DM, read_at__isnull=True)
                .filter(data__dm_id=dm_id)
                .first()
            )
            if existing is None:
                create(
                    [uid],
                    type=Notification.Type.DM,
                    message=message,
                    actor=actor,
                    data={**data, "count": 1},
                )
                continue
            existing.data = {**data, "count": int(existing.data.get("count", 1)) + 1}
            existing.message = message
            existing.actor = actor
            existing.created_at = timezone.now()
            existing.save(update_fields=["data", "message", "actor", "created_at"])
            _publish(existing, "notification.updated")


def inbox(
    user: Any, *, unread: bool = False, cursor: Any = None, limit: int = 25
) -> dict[str, Any]:
    qs = Notification.objects.filter(user=user).select_related("actor").order_by("-created_at")
    if unread:
        qs = qs.filter(read_at__isnull=True)
    if cursor is not None:
        anchor = Notification.objects.filter(user=user, pk=cursor).first()
        if anchor is not None:
            qs = qs.filter(
                Q(created_at__lt=anchor.created_at)
                | Q(created_at=anchor.created_at, id__lt=anchor.pk)
            )
    rows = list(qs.order_by("-created_at", "-id")[: limit + 1])
    page = rows[:limit]
    return {
        "results": page,
        "unread_count": Notification.objects.filter(user=user, read_at__isnull=True).count(),
        "next_cursor": page[-1].pk if len(rows) > limit else None,
    }


def mark_read(user: Any, *, ids: list[Any] | None = None, all: bool = False) -> int:
    qs = Notification.objects.filter(user=user, read_at__isnull=True)
    if not all:
        qs = qs.filter(pk__in=ids or [])
    read_ids = [str(i) for i in qs.values_list("pk", flat=True)]
    count = qs.update(read_at=timezone.now())
    if read_ids:
        events.to_user(user.pk, "notification.read", {"ids": read_ids})
    return count


def mark_dm_read(user: Any, dm_id: Any) -> None:
    ids = list(
        Notification.objects.filter(
            user=user, type=Notification.Type.DM, read_at__isnull=True, data__dm_id=str(dm_id)
        ).values_list("pk", flat=True)
    )
    if ids:
        mark_read(user, ids=ids)


def set_mute(user: Any, *, target_type: str, target_id: Any, muted: bool, muted_until: Any) -> None:
    from apps.chat_channels.models import Channel
    from apps.messaging.models import DMParticipant
    from apps.servers.models import Member

    if target_type == "server":
        allowed = Member.objects.filter(user=user, server_id=target_id).exists()
    elif target_type == "channel":
        allowed = Channel.objects.filter(pk=target_id, server__members__user=user).exists()
    else:
        allowed = DMParticipant.objects.filter(user=user, conversation_id=target_id).exists()
    if not allowed:
        raise Http404
    field = f"{target_type}_id"
    if not muted:
        MuteSetting.objects.filter(user=user, **{field: target_id}).delete()
    else:
        MuteSetting.objects.update_or_create(
            user=user, **{field: target_id}, defaults={"muted_until": muted_until}
        )
    events.to_user(user.pk, "mute_settings.updated", {})
