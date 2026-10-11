"""Audit Django auth signals. Fired by the API login/logout views and by the Django admin."""

from typing import Any

from django.contrib.auth.signals import user_logged_in, user_logged_out, user_login_failed
from django.dispatch import receiver

from . import audit
from .models import AuthAuditEvent


@receiver(user_logged_in)
def on_login(sender: Any, request: Any, user: Any, **kwargs: Any) -> None:
    audit.record(AuthAuditEvent.Event.LOGIN, request, user=user)


@receiver(user_logged_out)
def on_logout(sender: Any, request: Any, user: Any, **kwargs: Any) -> None:
    audit.record(AuthAuditEvent.Event.LOGOUT, request, user=user if user else None)


@receiver(user_login_failed)
def on_login_failed(sender: Any, credentials: dict[str, Any], request: Any, **kwargs: Any) -> None:
    email = str(credentials.get("email") or credentials.get("username") or "")
    audit.record(AuthAuditEvent.Event.LOGIN_FAILED, request, email=email.lower())
