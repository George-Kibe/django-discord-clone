"""Email configuration and development routing (Mailpit for test domains, real SMTP otherwise)."""

from typing import Any, ClassVar

import pytest
from django.core.mail import EmailMessage
from django.core.mail.backends.base import BaseEmailBackend

from apps.core.mail import SMTP_BACKEND, build_mailers, is_test_address


class Recorder(BaseEmailBackend):
    sent: ClassVar[dict[str, list[list[str]]]] = {}

    def send_messages(self, email_messages: Any) -> int:
        for message in email_messages:
            alias = str(getattr(self, "alias", ""))  # Django 6.1 attribute, not in the stubs yet
            Recorder.sent.setdefault(alias, []).append(message.recipients())
        return len(email_messages)


@pytest.mark.parametrize(
    ("address", "expected"),
    [
        ("e2e.abc@example.com", True),
        ("Someone <x@EXAMPLE.org>", True),
        ("a@sub.domain.test", True),
        ("a@localhost", True),
        ("george@gmail.com", False),
        ("me@example.co", False),
    ],
)
def test_is_test_address(address, expected):
    assert is_test_address(address) is expected


def test_build_mailers_prefers_email_url():
    mailers = build_mailers(
        email_url="smtp+tls://u%40x.com:p%20w@smtp.x.com:587",
        gmail_user="g@gmail.com",
        gmail_password="x",
    )
    options = mailers["default"]["OPTIONS"]
    assert mailers["default"]["BACKEND"] == SMTP_BACKEND
    assert (
        options["host"],
        options["port"],
        options["username"],
        options["password"],
        options["use_tls"],
    ) == (
        "smtp.x.com",
        587,
        "u@x.com",
        "p w",
        True,
    )


def test_build_mailers_gmail_strips_app_password_spaces():
    options = build_mailers(gmail_user="g@gmail.com", gmail_password="abcd efgh ijkl mnop")[
        "default"
    ]["OPTIONS"]
    assert options == {
        "host": "smtp.gmail.com",
        "port": 587,
        "use_tls": True,
        "username": "g@gmail.com",
        "password": "abcdefghijklmnop",
        "timeout": 10,
    }


def test_build_mailers_routing_and_fallbacks():
    routed = build_mailers(
        gmail_user="g@gmail.com", gmail_password="pw", capture_url="smtp://mailpit:1025"
    )
    assert routed["default"] == {"BACKEND": "apps.core.mail.DevRoutingBackend"}
    assert routed["capture"]["OPTIONS"]["host"] == "mailpit"
    assert (
        build_mailers(capture_url="smtp://mailpit:1025")["default"]["OPTIONS"]["host"] == "mailpit"
    )
    assert build_mailers()["default"]["BACKEND"] == "django.core.mail.backends.console.EmailBackend"


def test_dev_routing_backend_splits_by_recipient(settings):
    settings.MAILERS = {
        "default": {"BACKEND": "apps.core.mail.DevRoutingBackend"},
        "real": {"BACKEND": "apps.core.tests.test_mail.Recorder"},
        "capture": {"BACKEND": "apps.core.tests.test_mail.Recorder"},
    }
    Recorder.sent.clear()
    EmailMessage(subject="s", body="b", to=["e2e@example.com"]).send()
    EmailMessage(subject="s", body="b", to=["george@gmail.com"]).send()
    assert Recorder.sent == {"capture": [["e2e@example.com"]], "real": [["george@gmail.com"]]}
