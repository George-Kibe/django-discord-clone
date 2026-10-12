import logging

from celery import shared_task
from django.utils import timezone

from . import services
from .models import Poll

logger = logging.getLogger(__name__)


@shared_task(name="polls.close_poll", acks_late=True)
def close_poll(poll_id: str) -> None:
    poll = Poll.objects.select_related("message").filter(pk=poll_id).first()
    if (
        poll is not None
        and poll.closed_at is None
        and poll.closes_at
        and poll.closes_at <= timezone.now()
    ):
        services.close_now(poll)


@shared_task(name="polls.close_due")
def close_due() -> int:
    """Safety net for scheduled closes lost to a worker restart (FR-POLL-04)."""
    due = Poll.objects.select_related("message").filter(
        closed_at__isnull=True, closes_at__lte=timezone.now()
    )
    count = 0
    for poll in due:
        services.close_now(poll)
        count += 1
    if count:
        logger.info("Closed %d overdue polls", count)
    return count
