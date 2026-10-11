from datetime import timedelta
from unittest import mock

import pytest
from django.core import mail
from django.utils import timezone

from apps.accounts import tasks
from apps.accounts.models import AuthAuditEvent, User

from .factories import UserFactory

pytestmark = pytest.mark.django_db


def test_delete_stale_unverified_users():
    old = timezone.now() - timedelta(days=8)
    stale = UserFactory.create(date_joined=old)
    UserFactory.create(date_joined=old, email_verified_at=timezone.now())  # verified
    UserFactory.create(date_joined=old, is_staff=True)  # staff are never auto-deleted
    UserFactory.create()  # recent

    assert tasks.delete_stale_unverified_users() == 1
    assert not User.objects.filter(pk=stale.pk).exists()
    assert User.objects.count() == 3


def test_prune_auth_audit_log():
    """NFR-PRIV-01: audit entries (which hold IP addresses) are kept for 90 days."""
    old = AuthAuditEvent.objects.create(event="login")
    AuthAuditEvent.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=91))
    AuthAuditEvent.objects.create(event="login")
    assert tasks.prune_auth_audit_log() == 1
    assert AuthAuditEvent.objects.count() == 1


def test_flush_expired_tokens_calls_simplejwt_command():
    with mock.patch("apps.accounts.tasks.call_command") as call:
        tasks.flush_expired_tokens()
    call.assert_called_once_with("flushexpiredtokens")


def test_send_templated_email_renders_text_and_html():
    link = "http://localhost/reset-password?uid=abc&token=def"
    tasks.send_templated_email(
        "password_reset",
        "a@example.com",
        {"name": "Ann", "link": link, "site_url": "http://localhost"},
    )
    message = mail.outbox[0]
    assert message.subject == "Reset your password"
    assert message.to == ["a@example.com"]
    assert link in message.body  # not HTML-escaped in the text part
    html, mimetype = message.alternatives[0]  # type: ignore[attr-defined]
    assert mimetype == "text/html"
    assert "uid=abc&amp;token=def" in html  # escaped (correctly) in HTML


@pytest.mark.parametrize(
    "template",
    ["verify_email", "email_change", "email_changed", "password_reset", "password_changed"],
)
def test_all_templates_render(template):
    context = {"name": "Ann", "link": "http://x/y", "site_url": "http://x", "new_email": "n@x.com"}
    tasks.send_templated_email(template, "a@example.com", context)
    assert mail.outbox[0].subject
    assert "Ann" in mail.outbox[0].body
