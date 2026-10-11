"""Transactional emails, rendered and sent by the Celery task tasks.send_templated_email."""

from typing import Any

from django.conf import settings
from django.db import transaction

from .models import User
from .tokens import make_email_token, make_password_reset_token


def _queue(template: str, to: str, context: dict[str, Any]) -> None:
    from .tasks import send_templated_email

    # Only send once the surrounding transaction has committed (e.g. the user row exists).
    transaction.on_commit(lambda: send_templated_email.delay(template, to, context))


def _base_context(user: User) -> dict[str, Any]:
    return {"name": user.get_short_name(), "site_url": settings.SITE_URL}


def send_verification_email(user: User) -> None:
    token = make_email_token(user, user.email, "verify")
    _queue(
        "verify_email",
        user.email,
        _base_context(user) | {"link": f"{settings.SITE_URL}/verify-email?token={token}"},
    )


def send_email_change_confirmation(user: User, new_email: str) -> None:
    token = make_email_token(user, new_email, "change")
    _queue(
        "email_change",
        new_email,
        _base_context(user)
        | {"link": f"{settings.SITE_URL}/verify-email?token={token}", "new_email": new_email},
    )


def send_email_changed_notice(user: User, old_email: str) -> None:
    _queue("email_changed", old_email, _base_context(user) | {"new_email": user.email})


def send_password_reset_email(user: User) -> None:
    uid, token = make_password_reset_token(user)
    _queue(
        "password_reset",
        user.email,
        _base_context(user)
        | {"link": f"{settings.SITE_URL}/reset-password?uid={uid}&token={token}"},
    )


def send_password_changed_notice(user: User) -> None:
    _queue("password_changed", user.email, _base_context(user))
