"""Password reset/change and email change (FR-AUTH-05, FR-AUTH-06)."""

import pytest
from django.core import mail
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

from apps.accounts.cookies import ACCESS_COOKIE, REFRESH_COOKIE
from apps.accounts.models import AuthAuditEvent
from apps.accounts.tokens import make_email_token, make_password_reset_token
from conftest import PASSWORD, login

from .factories import UserFactory
from .helpers import last_email_link, query_param

pytestmark = pytest.mark.django_db
NEW_PASSWORD = "another-long-passphrase"


def active_refresh_tokens(user):
    return OutstandingToken.objects.filter(user=user, blacklistedtoken__isnull=True)


# ---------------------------------------------------------------------------- reset


def test_password_reset_full_flow(api_client, user, django_capture_on_commit_callbacks):
    other_session = APIClient()
    login(other_session, user)

    with django_capture_on_commit_callbacks(execute=True):
        response = api_client.post(reverse("auth-password-reset"), {"email": user.email.upper()})
    assert response.status_code == 202
    link = last_email_link(user.email)
    assert "/reset-password?uid=" in link

    with django_capture_on_commit_callbacks(execute=True):
        response = api_client.post(
            reverse("auth-password-reset-confirm"),
            {
                "uid": query_param(link, "uid"),
                "token": query_param(link, "token"),
                "password": NEW_PASSWORD,
            },
            format="json",
        )
    assert response.status_code == 200, response.content
    user.refresh_from_db()
    assert user.check_password(NEW_PASSWORD)
    assert not active_refresh_tokens(user).exists()  # signed out everywhere
    assert other_session.post(reverse("auth-refresh")).status_code == 401
    assert AuthAuditEvent.objects.filter(user=user, event="password_reset").exists()
    assert mail.outbox[-1].subject == "Your password was changed"

    # Single use: the token is bound to the old password hash.
    again = api_client.post(
        reverse("auth-password-reset-confirm"),
        {
            "uid": query_param(link, "uid"),
            "token": query_param(link, "token"),
            "password": "yet-another-passphrase",
        },
        format="json",
    )
    assert again.status_code == 400


def test_password_reset_for_unknown_email_is_indistinguishable(
    api_client, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        response = api_client.post(reverse("auth-password-reset"), {"email": "nobody@example.com"})
    assert response.status_code == 202
    assert mail.outbox == []


@pytest.mark.parametrize(("uid", "token"), [("bad", "bad"), ("", "x"), ("MTIz", "abc-def")])
def test_password_reset_confirm_rejects_invalid_links(api_client, uid, token):
    response = api_client.post(
        reverse("auth-password-reset-confirm"),
        {"uid": uid, "token": token, "password": NEW_PASSWORD},
        format="json",
    )
    assert response.status_code == 400


def test_password_reset_confirm_enforces_strength(api_client, user):
    uid, token = make_password_reset_token(user)
    response = api_client.post(
        reverse("auth-password-reset-confirm"),
        {"uid": uid, "token": token, "password": "123"},
        format="json",
    )
    assert response.status_code == 400
    assert "password" in response.json()["fields"]


# ---------------------------------------------------------------------------- change


def test_change_password(auth_client, user, django_capture_on_commit_callbacks):
    other_session = APIClient()
    login(other_session, user)
    old_refresh = auth_client.cookies[REFRESH_COOKIE].value

    with django_capture_on_commit_callbacks(execute=True):
        response = auth_client.post(
            reverse("auth-password-change"),
            {"current_password": PASSWORD, "new_password": NEW_PASSWORD},
            format="json",
        )
    assert response.status_code == 200
    assert response.cookies[REFRESH_COOKIE].value != old_refresh  # this session stays signed in
    assert auth_client.get(reverse("users-me")).status_code == 200
    assert other_session.post(reverse("auth-refresh")).status_code == 401
    user.refresh_from_db()
    assert user.check_password(NEW_PASSWORD)
    assert AuthAuditEvent.objects.filter(user=user, event="password_changed").exists()
    assert mail.outbox[-1].to == [user.email]


def test_change_password_errors(auth_client, api_client):
    wrong = auth_client.post(
        reverse("auth-password-change"),
        {"current_password": "nope", "new_password": NEW_PASSWORD},
        format="json",
    )
    assert wrong.status_code == 400
    assert "current_password" in wrong.json()["fields"]

    weak = auth_client.post(
        reverse("auth-password-change"),
        {"current_password": PASSWORD, "new_password": "short"},
        format="json",
    )
    assert "new_password" in weak.json()["fields"]

    assert api_client.post(reverse("auth-password-change"), {}).status_code == 401


# ---------------------------------------------------------------------------- email change


def test_email_change_full_flow(auth_client, api_client, user, django_capture_on_commit_callbacks):
    old_email = user.email
    with django_capture_on_commit_callbacks(execute=True):
        response = auth_client.post(
            reverse("users-me-email"),
            {"new_email": "Fresh@Example.com", "password": PASSWORD},
            format="json",
        )
    assert response.status_code == 202
    link = last_email_link("fresh@example.com")
    user.refresh_from_db()
    assert user.email == old_email  # nothing changes until confirmed

    with django_capture_on_commit_callbacks(execute=True):
        confirm = api_client.post(
            reverse("auth-verify-email"), {"token": query_param(link, "token")}, format="json"
        )
    assert confirm.status_code == 200
    user.refresh_from_db()
    assert user.email == "fresh@example.com"
    assert user.is_email_verified
    assert AuthAuditEvent.objects.filter(user=user, event="email_changed").exists()
    assert mail.outbox[-1].to == [old_email]  # notice to the previous address
    assert mail.outbox[-1].subject == "Your email address was changed"


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"new_email": "fresh@example.com", "password": "wrong"}, "password"),
        ({"new_email": "TAKEN@example.com", "password": PASSWORD}, "new_email"),
        ({"new_email": "not-an-email", "password": PASSWORD}, "new_email"),
    ],
)
def test_email_change_validation(auth_client, payload, field):
    UserFactory.create(email="taken@example.com")
    response = auth_client.post(reverse("users-me-email"), payload, format="json")
    assert response.status_code == 400
    assert field in response.json()["fields"]


def test_email_change_to_current_address(auth_client, user):
    response = auth_client.post(
        reverse("users-me-email"), {"new_email": user.email, "password": PASSWORD}, format="json"
    )
    assert response.json()["code"] == "same_email"


def test_email_change_link_fails_if_address_was_taken_meanwhile(api_client, user):
    token = make_email_token(user, "race@example.com", "change")
    UserFactory.create(email="race@example.com")
    response = api_client.post(reverse("auth-verify-email"), {"token": token}, format="json")
    assert response.status_code == 400
    assert response.json()["code"] == "email_taken"


def test_unknown_email_token_purpose_is_rejected(api_client, user):
    token = make_email_token(user, user.email, "unknown")  # type: ignore[arg-type]
    assert api_client.post(reverse("auth-verify-email"), {"token": token}).status_code == 400


def test_session_stays_valid_after_email_change(auth_client, user):
    token = make_email_token(user, "moved@example.com", "change")
    APIClient().post(reverse("auth-verify-email"), {"token": token}, format="json")
    assert auth_client.get(reverse("users-me")).json()["email"] == "moved@example.com"
    assert auth_client.cookies[ACCESS_COOKIE].value
