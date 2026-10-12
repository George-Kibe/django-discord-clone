import logging

from celery import shared_task

from apps.servers.models import Member

from . import presence
from .events import send_now, server_group

logger = logging.getLogger(__name__)


@shared_task(name="realtime.sweep_presence")
def sweep_presence() -> int:
    """Report users offline whose connections expired without a clean disconnect."""
    gone = presence.sweep()
    for user_id in gone:
        for server_id in Member.objects.filter(user_id=user_id).values_list("server_id", flat=True):
            send_now(
                server_group(server_id),
                {
                    "type": "realtime.event",
                    "event": "presence.updated",
                    "data": {
                        "user_id": user_id,
                        "status": presence.OFFLINE,
                        "server_id": str(server_id),
                    },
                },
            )
    if gone:
        logger.info("Presence sweep: %d users went offline", len(gone))
    return len(gone)
