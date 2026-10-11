"""Email configuration helpers and the development routing backend.

Production: one SMTP mailer from ``EMAIL_URL`` (or Gmail credentials).
Development: real recipients go through that mailer, while reserved test domains
(example.com, *.test, ...) are captured by Mailpit, so E2E sign-ups never hit a real inbox.
"""

from typing import Any

import environ
from django.core.mail import mailers
from django.core.mail.backends.base import BaseEmailBackend
from django.core.mail.message import EmailMessage

SMTP_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
# RFC 2606 / RFC 6761 reserved names: never deliverable, safe to capture.
_TEST_DOMAINS = {"example.com", "example.net", "example.org", "localhost"}
_TEST_SUFFIXES = (".test", ".example", ".invalid", ".localhost")


def is_test_address(address: str) -> bool:
    domain = address.rsplit("@", 1)[-1].strip().strip(">").lower()
    return domain in _TEST_DOMAINS or domain.endswith(_TEST_SUFFIXES)


def mailer_from_url(url: str) -> dict[str, Any]:
    """``smtp+tls://user:pass@host:587`` / ``consolemail://`` -> a MAILERS entry."""
    config = environ.Env.email_url_config(url)
    backend = config["EMAIL_BACKEND"]
    options: dict[str, Any] = {}
    if backend == SMTP_BACKEND:
        candidates = {
            "host": config.get("EMAIL_HOST"),
            "port": config.get("EMAIL_PORT"),
            "username": config.get("EMAIL_HOST_USER"),
            "password": config.get("EMAIL_HOST_PASSWORD"),
            "use_tls": config.get("EMAIL_USE_TLS"),
            "use_ssl": config.get("EMAIL_USE_SSL"),
            "timeout": 10,
        }
        options = {k: v for k, v in candidates.items() if v not in (None, "")}
    return {"BACKEND": backend, "OPTIONS": options}


def gmail_mailer(user: str, password: str) -> dict[str, Any]:
    """Gmail SMTP with an app password (https://myaccount.google.com/apppasswords)."""
    return {
        "BACKEND": SMTP_BACKEND,
        "OPTIONS": {
            "host": "smtp.gmail.com",
            "port": 587,
            "use_tls": True,
            "username": user,
            "password": password.replace(" ", ""),  # Google shows app passwords in groups of 4
            "timeout": 10,
        },
    }


def build_mailers(
    *, email_url: str = "", gmail_user: str = "", gmail_password: str = "", capture_url: str = ""
) -> dict[str, dict[str, Any]]:
    real: dict[str, Any] | None = None
    if email_url:
        real = mailer_from_url(email_url)
    elif gmail_user and gmail_password:
        real = gmail_mailer(gmail_user, gmail_password)
    capture = mailer_from_url(capture_url) if capture_url else None

    if real and capture:
        return {
            "default": {"BACKEND": "apps.core.mail.DevRoutingBackend"},
            "real": real,
            "capture": capture,
        }
    if real or capture:
        return {"default": real or capture}  # type: ignore[dict-item]
    return {"default": mailer_from_url("consolemail://")}


class DevRoutingBackend(BaseEmailBackend):
    """Development only: test-domain recipients -> ``capture``; everyone else -> ``real``."""

    def __init__(self, *, real: str = "real", capture: str = "capture", **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.real_alias = real
        self.capture_alias = capture

    def send_messages(self, email_messages: list[EmailMessage]) -> int:  # type: ignore[override]
        sent = 0
        for message in email_messages:
            captured = all(is_test_address(r) for r in message.recipients())
            backend = mailers[self.capture_alias if captured else self.real_alias]
            sent += backend.send_messages([message]) or 0
        return sent
