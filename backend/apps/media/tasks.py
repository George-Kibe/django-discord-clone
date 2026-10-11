import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from . import services
from .models import PendingUpload

logger = logging.getLogger(__name__)


@shared_task(
    name="media.delete_asset",
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 5},
)
def delete_asset(public_id: str) -> None:
    services.delete_asset(public_id)


@shared_task(name="media.cleanup_orphaned_uploads")
def cleanup_orphaned_uploads() -> int:
    cutoff = timezone.now() - timedelta(hours=settings.PENDING_UPLOAD_TTL_HOURS)
    stale = list(PendingUpload.objects.filter(created_at__lt=cutoff))
    for upload in stale:
        services.delete_asset(upload.public_id)
        upload.delete()
    logger.info("Removed %d orphaned uploads", len(stale))
    return len(stale)
