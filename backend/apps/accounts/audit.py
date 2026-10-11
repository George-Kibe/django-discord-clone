from typing import Any

from django.http import HttpRequest

from .models import AuthAuditEvent, User


def client_ip(request: Any) -> str | None:
    """Client address. Uvicorn's --proxy-headers already resolves X-Forwarded-For set by Caddy."""
    meta = getattr(request, "META", None) or {}
    return meta.get("REMOTE_ADDR") or None


def record(
    event: AuthAuditEvent.Event,
    request: HttpRequest | Any | None = None,
    *,
    user: User | None = None,
    email: str = "",
) -> AuthAuditEvent:
    meta = getattr(request, "META", None) or {}
    return AuthAuditEvent.objects.create(
        event=event,
        user=user,
        email_attempted=(email or (user.email if user else ""))[:254],
        ip=client_ip(request),
        user_agent=meta.get("HTTP_USER_AGENT", "")[:512],
    )
