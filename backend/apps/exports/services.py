"""PDF transcript exports (FR-EXP-01..03)."""

from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Any

from django.conf import settings
from django.core import signing
from django.db import transaction
from django.utils import timezone
from rest_framework import exceptions

from apps.core.permissions import Perm
from apps.messaging.targets import Target

from .models import ExportJob

MAX_ACTIVE_PER_USER = 3
SIGNING_SALT = "exports.download"


def start(target: Target, *, date_from: Any = None, date_to: Any = None) -> ExportJob:
    """Channels need EXPORT_TRANSCRIPTS (and history); DM participants can always export."""
    if target.channel is not None:
        target.require(Perm.EXPORT_TRANSCRIPTS)
    target.require(Perm.READ_MESSAGE_HISTORY)
    if date_from and date_to and date_from > date_to:
        raise exceptions.ValidationError({"date_to": ["Must be on or after the start date."]})
    active = ExportJob.objects.filter(
        requested_by=target.user,
        status__in=[ExportJob.Status.PENDING, ExportJob.Status.RUNNING],
    ).count()
    if active >= MAX_ACTIVE_PER_USER:
        raise exceptions.Throttled(detail="You already have exports running. Try again soon.")
    job = ExportJob.objects.create(
        requested_by=target.user,
        channel=target.channel,
        dm=target.dm,
        date_from=date_from,
        date_to=date_to,
    )
    from .tasks import generate_export

    transaction.on_commit(lambda: generate_export.delay(str(job.pk)))
    return job


def path_for(job: ExportJob) -> Path:
    return Path(settings.EXPORT_ROOT) / job.file_name


def download_token(job: ExportJob) -> str:
    return signing.dumps(
        {"export": str(job.pk), "user": str(job.requested_by_id)}, salt=SIGNING_SALT
    )


def check_token(token: str, user: Any) -> str:
    """The export id, if the token is valid, fresh and belongs to ``user``."""
    try:
        data = signing.loads(token, salt=SIGNING_SALT, max_age=settings.EXPORT_LINK_MAX_AGE)
    except signing.SignatureExpired:
        raise exceptions.PermissionDenied(
            "This download link has expired.", code="link_expired"
        ) from None
    except signing.BadSignature:
        raise exceptions.PermissionDenied("Invalid download link.", code="bad_link") from None
    if data.get("user") != str(user.pk):
        raise exceptions.PermissionDenied("Invalid download link.", code="bad_link")
    return str(data["export"])


def day_bounds(date_from: Any, date_to: Any) -> tuple[datetime | None, datetime | None]:
    start = timezone.make_aware(datetime.combine(date_from, time.min)) if date_from else None
    end = (
        timezone.make_aware(datetime.combine(date_to, time.min)) + timedelta(days=1)
        if date_to
        else None
    )
    return start, end
