"""Audit log (FR-AUTH-08, FR-MOD-05)."""

import pytest
from django.contrib.admin.sites import site
from django.test import Client, RequestFactory
from django.urls import reverse

from apps.accounts.models import AuthAuditEvent
from conftest import PASSWORD

from .factories import UserFactory

pytestmark = pytest.mark.django_db


def test_admin_logins_are_audited():
    staff = UserFactory.create(is_staff=True, is_superuser=True, password=PASSWORD)
    client = Client()
    client.post(reverse("admin:login"), {"username": staff.email, "password": "bad"})
    client.post(reverse("admin:login"), {"username": staff.email, "password": PASSWORD})
    client.post(reverse("admin:logout"))
    assert list(AuthAuditEvent.objects.order_by("id").values_list("event", flat=True)) == [
        "login_failed",
        "login",
        "logout",
    ]


def test_audit_admin_is_read_only():
    staff = UserFactory.create(is_staff=True, is_superuser=True, password=PASSWORD)
    AuthAuditEvent.objects.create(event="login", user=staff, ip="10.0.0.1")
    client = Client()
    client.force_login(staff)
    assert client.get(reverse("admin:accounts_authauditevent_changelist")).status_code == 200
    assert client.get(reverse("admin:accounts_authauditevent_add")).status_code == 403

    admin = site._registry[AuthAuditEvent]
    request = RequestFactory().get("/")
    assert not admin.has_change_permission(request)
    assert not admin.has_delete_permission(request)


def test_user_agent_and_ip_are_captured(api_client, user):
    api_client.post(
        reverse("auth-login"),
        {"email": user.email, "password": PASSWORD},
        HTTP_USER_AGENT="pytest-agent",
        REMOTE_ADDR="203.0.113.7",
    )
    event = AuthAuditEvent.objects.get(event="login")
    assert (event.ip, event.user_agent, event.user) == ("203.0.113.7", "pytest-agent", user)
