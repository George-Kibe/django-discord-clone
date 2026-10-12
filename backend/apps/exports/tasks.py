import contextlib
import logging
from datetime import timedelta
from pathlib import Path
from typing import Any

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from apps.messaging.models import Message
from apps.notifications import services as notifications
from apps.realtime import events

from . import pdf
from .models import ExportJob
from .services import day_bounds

logger = logging.getLogger(__name__)


def _describe(job: ExportJob) -> tuple[str, str, dict[str, Any]]:
    if job.channel is not None:
        server = job.channel.server
        name = f"#{job.channel.name}"
        return (
            f"{server.name} — {name}",
            name,
            {
                "server_id": str(server.pk),
                "server_name": server.name,
                "channel_id": str(job.channel.pk),
                "channel_name": job.channel.name,
            },
        )
    dm = job.dm
    assert dm is not None  # noqa: S101 - the model's check constraint guarantees it
    names = [
        p.user.display_name or p.user.username
        for p in dm.participants.select_related("user").order_by("joined_at")
    ]
    label = dm.name or ", ".join(names)
    return f"Direct messages — {label}", label, {"dm_id": str(dm.pk), "dm_name": label}


def _rows(job: ExportJob) -> Any:
    start, end = day_bounds(job.date_from, job.date_to)
    qs = Message.objects.filter(deleted_at__isnull=True)
    qs = qs.filter(channel=job.channel) if job.channel_id else qs.filter(dm=job.dm)
    if start:
        qs = qs.filter(created_at__gte=start)
    if end:
        qs = qs.filter(created_at__lt=end)
    qs = (
        qs.select_related("author", "reply_to__author")
        .prefetch_related("attachments", "mentions__user", "mentions__role")
        .order_by("id")[: settings.EXPORT_MAX_MESSAGES]
    )
    for message in qs.iterator(chunk_size=500):
        users = {
            str(m.user_id): m.user.display_name or m.user.username
            for m in message.mentions.all()
            if m.user is not None
        }
        roles = {str(m.role_id): m.role.name for m in message.mentions.all() if m.role is not None}
        author = message.author
        reply = message.reply_to
        yield {
            "author": (author.display_name or author.username) if author else "Deleted User",
            "created_at": message.created_at,
            "edited": message.edited_at is not None,
            "content": pdf.readable(message.content, users, roles),
            "attachments": [a.filename for a in message.attachments.all()],
            "reply_to": (
                (reply.author.display_name or reply.author.username)
                if reply is not None and reply.author is not None
                else None
            ),
        }


@shared_task(name="exports.generate", acks_late=True, time_limit=600, soft_time_limit=540)
def generate_export(job_id: str) -> None:
    job = (
        ExportJob.objects.select_related("channel__server", "dm", "requested_by")
        .filter(pk=job_id, status=ExportJob.Status.PENDING)
        .first()
    )
    if job is None:
        return
    job.status = ExportJob.Status.RUNNING
    job.save(update_fields=["status"])
    title, label, location = _describe(job)
    span = (
        " to ".join(d.isoformat() for d in (job.date_from, job.date_to) if d is not None)
        or "all messages"
    )
    Path(settings.EXPORT_ROOT).mkdir(parents=True, exist_ok=True)
    job.file_name = f"{job.pk}.pdf"
    try:
        count = pdf.render(
            str(Path(settings.EXPORT_ROOT) / job.file_name),
            title=title,
            subtitle=f"{span} · exported by {job.requested_by.username} on "
            f"{timezone.now():%Y-%m-%d %H:%M} UTC",
            rows=_rows(job),
        )
    except Exception as exc:
        logger.exception("Export %s failed", job.pk)
        job.status = ExportJob.Status.FAILED
        job.error = str(exc)[:1000]
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "error", "completed_at"])
        events.send_now(
            events.user_group(job.requested_by_id),
            {
                "type": "realtime.event",
                "event": "export.failed",
                "data": {"export_id": str(job.pk)},
            },
        )
        return
    now = timezone.now()
    job.status = ExportJob.Status.DONE
    job.message_count = count
    job.completed_at = now
    job.expires_at = now + timedelta(hours=settings.EXPORT_TTL_HOURS)
    job.save(update_fields=["status", "file_name", "message_count", "completed_at", "expires_at"])
    notifications.create(
        [job.requested_by_id],
        type="export_ready",
        message=None,
        actor=None,
        data={**location, "export_id": str(job.pk), "label": label, "message_count": count},
    )
    events.send_now(
        events.user_group(job.requested_by_id),
        {"type": "realtime.event", "event": "export.ready", "data": {"export_id": str(job.pk)}},
    )


@shared_task(name="exports.delete_expired")
def delete_expired() -> int:
    """FR-EXP-03: files are deleted after 24 hours."""
    expired = ExportJob.objects.filter(status=ExportJob.Status.DONE, expires_at__lte=timezone.now())
    count = 0
    for job in expired:
        with contextlib.suppress(FileNotFoundError):
            (Path(settings.EXPORT_ROOT) / job.file_name).unlink()
        job.status = ExportJob.Status.EXPIRED
        job.save(update_fields=["status"])
        count += 1
    if count:
        logger.info("Deleted %d expired exports", count)
    return count
