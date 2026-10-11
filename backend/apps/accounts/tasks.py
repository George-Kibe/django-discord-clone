import logging
from datetime import timedelta
from typing import Any

from celery import shared_task
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.core.management import call_command
from django.template.loader import render_to_string
from django.utils import timezone

from .models import AuthAuditEvent, User

logger = logging.getLogger(__name__)


@shared_task(
    name="accounts.send_templated_email",
    autoretry_for=(OSError,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 5},
)
def send_templated_email(template: str, to: str, context: dict[str, Any]) -> None:
    subject = render_to_string(f"emails/{template}_subject.txt", context).strip()
    text = render_to_string(f"emails/{template}.txt", context)
    html = render_to_string(f"emails/{template}.html", context)
    message = EmailMultiAlternatives(
        subject=subject, body=text, from_email=settings.DEFAULT_FROM_EMAIL, to=[to]
    )
    message.attach_alternative(html, "text/html")
    message.send()
    logger.info("Sent %s email", template)


@shared_task(name="accounts.delete_stale_unverified_users")
def delete_stale_unverified_users() -> int:
    """FR-AUTH-02: unverified accounts are deleted after UNVERIFIED_ACCOUNT_TTL_DAYS."""
    cutoff = timezone.now() - timedelta(days=settings.UNVERIFIED_ACCOUNT_TTL_DAYS)
    deleted, _ = User.objects.filter(
        email_verified_at__isnull=True,
        date_joined__lt=cutoff,
        is_staff=False,
        is_superuser=False,
    ).delete()
    logger.info("Deleted %d stale unverified accounts", deleted)
    return deleted


@shared_task(name="accounts.prune_auth_audit_log")
def prune_auth_audit_log() -> int:
    cutoff = timezone.now() - timedelta(days=settings.AUTH_AUDIT_RETENTION_DAYS)
    deleted, _ = AuthAuditEvent.objects.filter(created_at__lt=cutoff).delete()
    return deleted


@shared_task(name="accounts.flush_expired_tokens")
def flush_expired_tokens() -> None:
    call_command("flushexpiredtokens")
