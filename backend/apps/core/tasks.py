import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(name="core.ping")
def ping() -> str:
    """Smoke-test task used to verify the worker is consuming the queue."""
    logger.info("ping task executed")
    return "pong"
