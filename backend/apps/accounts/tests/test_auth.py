"""Registration, verification, login, refresh, logout, CSRF.

Covers FR-AUTH-01, FR-AUTH-02, FR-AUTH-03, FR-AUTH-04, NFR-SEC-03 and NFR-SEC-04 (CSRF; the
WebSocket Origin check is in apps/realtime/tests).
"""

from datetime import timedelta
from unittest import mock

import pytest
from django.core import mail
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from apps.accounts.cookies import ACCESS_COOKIE, REFRESH_COOKIE, SESSION_HINT_COOKIE
from apps.accounts.models import AuthAuditEvent, User
from apps.accounts.tokens import make_email_token
from conftest import PASSWORD, login

from .factories import UserFactory
from .helpers import last_email_link

pytestmark = pytest.mark.django_db

REGISTER = {
    "email": "New.Person@Example.com",
    "username": "NewPerson",
    "display_name": "New Person",
    "password": "a-long-unique-passphrase",
}


def events(user=None, event=None):
    qs = AuthAuditEvent.objects.all()
    if user is not None:
        qs = qs.filter(user=user)
    if event is not None:
        qs = qs.filter(event=event)
    return qs


# ---------------------------------------------------------------------------- register


def test_register_creates_unverified_user_and_sends_verification(
    api_client, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        response = api_client.post(reverse("auth-register"), REGISTER, format="json")

    assert response.status_code == 201, response.content
    body = response.json()
    assert body["email"] == "new.person@example.com"
    assert body["username"] == "newperson"
    assert body["email_verified"] is False
    assert "password" not in body
    user = User.objects.get(email="new.person@example.com")
    assert user.check_password(REGISTER["password"])
    assert events(user, "registered").count() == 1
    assert "/verify-email?token=" in last_email_link("new.person@example.com")
    assert ACCESS_COOKIE not in response.cookies  # registering doesn't sign you in


@pytest.mark.parametrize(
    ("override", "field"),
    [
        ({"email": "not-an-email"}, "email"),
        ({"username": "x"}, "username"),
        ({"username": "has space"}, "username"),
        ({"password": "short"}, "password"),
        ({"password": "password123"}, "password"),
        ({"password": "12345678901234"}, "password"),  # entirely numeric
    ],
)
def test_register_validation(api_client, override, field):
    response = api_client.post(reverse("auth-register"), REGISTER | override, format="json")
    assert response.status_code == 400
    assert response.json()["type"] == "validation_error"
    assert field in response.json()["fields"]


def test_register_rejects_duplicates_case_insensitively(api_client):
    UserFactory.create(email="new.person@example.com", username="taken")
    response = api_client.post(reverse("auth-register"), REGISTER, format="json")
    assert response.status_code == 400
    assert "email" in response.json()["fields"]

    response = api_client.post(
        reverse("auth-register"),
        REGISTER | {"email": "x@example.com", "username": "TAKEN"},
        format="json",
    )
    assert response.status_code == 400
    assert response.json()["fields"]["username"] == ["That username is taken."]


# ---------------------------------------------------------------------------- verify email


def test_verify_email(api_client, unverified_user):
    token = make_email_token(unverified_user, unverified_user.email, "verify")
    response = api_client.post(reverse("auth-verify-email"), {"token": token}, format="json")
    assert response.status_code == 200
    unverified_user.refresh_from_db()
    assert unverified_user.is_email_verified
    assert events(unverified_user, "email_verified").count() == 1

    # Idempotent: opening the link again is fine and doesn't re-audit.
    assert api_client.post(reverse("auth-verify-email"), {"token": token}).status_code == 200
    assert events(unverified_user, "email_verified").count() == 1


@pytest.mark.parametrize("token", ["garbage", ""])
def test_verify_email_rejects_bad_tokens(api_client, token):
    response = api_client.post(reverse("auth-verify-email"), {"token": token}, format="json")
    assert response.status_code == 400


def test_verify_email_token_expires(api_client, unverified_user, settings):
    token = make_email_token(unverified_user, unverified_user.email, "verify")
    future = timezone.now().timestamp() + settings.EMAIL_VERIFICATION_MAX_AGE + 60
    with mock.patch("django.core.signing.time.time", return_value=future):
        response = api_client.post(reverse("auth-verify-email"), {"token": token}, format="json")
    assert response.status_code == 400
    assert response.json()["fields"]["token"] == ["This link is invalid or has expired."]


def test_verify_link_for_a_previous_email_is_rejected(api_client, unverified_user):
    token = make_email_token(unverified_user, "old@example.com", "verify")
    response = api_client.post(reverse("auth-verify-email"), {"token": token}, format="json")
    assert response.status_code == 400


def test_resend_verification(api_client, unverified_user, user, django_capture_on_commit_callbacks):
    url = reverse("auth-resend-verification")
    with django_capture_on_commit_callbacks(execute=True):
        assert api_client.post(url, {"email": unverified_user.email}).status_code == 202
        assert api_client.post(url, {"email": user.email}).status_code == 202  # already verified
        assert api_client.post(url, {"email": "nobody@example.com"}).status_code == 202
    assert [m.to for m in mail.outbox] == [[unverified_user.email]]


# ---------------------------------------------------------------------------- login / cookies


def test_login_sets_hardened_cookies(api_client, user):
    response = api_client.post(
        reverse("auth-login"), {"email": user.email.upper(), "password": PASSWORD}, format="json"
    )
    assert response.status_code == 200
    assert response.json()["id"] == str(user.id)

    access, refresh, hint = (
        response.cookies[n] for n in (ACCESS_COOKIE, REFRESH_COOKIE, SESSION_HINT_COOKIE)
    )
    assert access["httponly"] and refresh["httponly"]
    assert not hint["httponly"] and hint.value == "1"
    assert access["samesite"] == refresh["samesite"] == "Lax"
    assert access["path"] == "/"
    assert refresh["path"] == "/api/v1/auth"
    assert int(access["max-age"]) == 15 * 60
    assert int(refresh["max-age"]) == 14 * 24 * 60 * 60
    # Tokens never appear in the response body (NFR-SEC-03).
    assert access.value not in response.content.decode()

    user.refresh_from_db()
    assert user.last_login is not None
    assert events(user, "login").count() == 1


def test_secure_flag_follows_settings(api_client, user, settings):
    settings.AUTH_COOKIE_SECURE = True
    response = api_client.post(
        reverse("auth-login"), {"email": user.email, "password": PASSWORD}, format="json"
    )
    assert response.cookies[ACCESS_COOKIE]["secure"]
    assert response.cookies[REFRESH_COOKIE]["secure"]


@pytest.mark.parametrize("password", ["wrong-password", ""])
def test_login_failure_is_generic_and_audited(api_client, user, password):
    response = api_client.post(
        reverse("auth-login"), {"email": user.email, "password": password}, format="json"
    )
    assert response.status_code == 400
    if password:
        assert response.json()["code"] == "invalid_credentials"
        assert response.json()["fields"]["non_field_errors"] == ["Invalid email or password."]
        failed = events(event="login_failed").get()
        assert failed.email_attempted == user.email
        assert failed.ip == "127.0.0.1"
    assert ACCESS_COOKIE not in response.cookies


def test_login_unknown_and_inactive_users_look_identical(api_client, user):
    user.is_active = False
    user.save()
    for email in (user.email, "ghost@example.com"):
        response = api_client.post(
            reverse("auth-login"), {"email": email, "password": PASSWORD}, format="json"
        )
        assert response.status_code == 400
        assert response.json()["code"] == "invalid_credentials"


def test_cookie_authentication(api_client, auth_client, user):
    assert auth_client.get(reverse("users-me")).json()["email"] == user.email

    anonymous = api_client.get(reverse("users-me"))
    assert anonymous.status_code == 401
    assert anonymous.json()["code"] == "not_authenticated"
    assert anonymous["WWW-Authenticate"]

    api_client.cookies[ACCESS_COOKIE] = "not-a-jwt"
    invalid = api_client.get(reverse("users-me"))
    assert invalid.status_code == 401
    assert invalid.json()["code"] == "token_not_valid"


def test_access_token_of_deactivated_user_is_rejected(auth_client, user):
    user.is_active = False
    user.save()
    assert auth_client.get(reverse("users-me")).json()["code"] == "token_not_valid"


# ---------------------------------------------------------------------------- CSRF


def test_csrf_endpoint_sets_cookie(api_client):
    response = api_client.get(reverse("auth-csrf"))
    assert response.status_code == 200
    assert "csrftoken" in response.cookies


def test_writes_require_csrf_token(user):
    client = APIClient(enforce_csrf_checks=True)
    credentials = {"email": user.email, "password": PASSWORD}

    rejected = client.post(reverse("auth-login"), credentials, format="json")
    assert rejected.status_code == 403
    assert rejected.json()["code"] == "csrf_failed"

    client.get(reverse("auth-csrf"))
    token = client.cookies["csrftoken"].value
    assert (
        client.post(
            reverse("auth-login"), credentials, format="json", HTTP_X_CSRFTOKEN=token
        ).status_code
        == 200
    )

    # Cookie-authenticated writes need the token too.
    patch = client.patch(reverse("users-me"), {"bio": "hi"}, format="json")
    assert patch.status_code == 403
    assert (
        client.patch(
            reverse("users-me"), {"bio": "hi"}, format="json", HTTP_X_CSRFTOKEN=token
        ).status_code
        == 200
    )
    # Reads don't.
    assert client.get(reverse("users-me")).status_code == 200


# ---------------------------------------------------------------------------- refresh


def test_refresh_rotates_tokens(auth_client, user):
    old_refresh = auth_client.cookies[REFRESH_COOKIE].value
    response = auth_client.post(reverse("auth-refresh"))
    assert response.status_code == 200
    assert response.json()["id"] == str(user.id)
    new_refresh = response.cookies[REFRESH_COOKIE].value
    assert new_refresh != old_refresh
    assert response.cookies[ACCESS_COOKIE].value
    assert BlacklistedToken.objects.filter(token__token=old_refresh).exists()
    assert auth_client.get(reverse("users-me")).status_code == 200


def test_refresh_without_cookie(api_client):
    response = api_client.post(reverse("auth-refresh"))
    assert response.status_code == 401
    assert response.json()["code"] == "token_not_valid"


def test_failed_refresh_clears_cookies(api_client):
    api_client.cookies[REFRESH_COOKIE] = "garbage"
    api_client.cookies[SESSION_HINT_COOKIE] = "1"
    response = api_client.post(reverse("auth-refresh"))
    assert response.status_code == 401
    assert response.cookies[SESSION_HINT_COOKIE].value == ""
    assert int(response.cookies[REFRESH_COOKIE]["max-age"]) == 0


def test_refresh_token_reuse_revokes_all_sessions(auth_client, user, settings):
    settings.AUTH_REFRESH_REUSE_GRACE_SECONDS = 0
    other_device = APIClient()
    login(other_device, user)
    stolen = auth_client.cookies[REFRESH_COOKIE].value
    auth_client.post(reverse("auth-refresh"))  # legitimate rotation

    attacker = APIClient()
    attacker.cookies[REFRESH_COOKIE] = stolen
    assert attacker.post(reverse("auth-refresh")).status_code == 401

    assert events(user, "token_refresh_reuse").count() == 1
    outstanding = OutstandingToken.objects.filter(user=user, expires_at__gt=timezone.now())
    assert outstanding.exists()
    assert not outstanding.filter(blacklistedtoken__isnull=True).exists()
    assert other_device.post(reverse("auth-refresh")).status_code == 401


def test_just_rotated_token_is_accepted_within_grace_window(auth_client, user):
    """A second tab (or a reload that lost the response) presents the token that was just
    rotated: it gets a fresh pair instead of being signed out."""
    first = auth_client.cookies[REFRESH_COOKIE].value
    auth_client.post(reverse("auth-refresh"))
    second_tab = APIClient()
    second_tab.cookies[REFRESH_COOKIE] = first
    response = second_tab.post(reverse("auth-refresh"))
    assert response.status_code == 200
    assert response.cookies[REFRESH_COOKIE].value not in ("", first)
    assert events(user, "token_refresh_reuse").count() == 0
    assert auth_client.post(reverse("auth-refresh")).status_code == 200


def test_revocation_beats_the_rotation_grace(auth_client, user):
    first = auth_client.cookies[REFRESH_COOKIE].value
    auth_client.post(reverse("auth-refresh"))
    response = auth_client.post(
        reverse("auth-password-change"),
        {"current_password": PASSWORD, "new_password": "brand-new-passphrase-1"},
        format="json",
    )
    assert response.status_code == 200
    stale = APIClient()
    stale.cookies[REFRESH_COOKIE] = first
    assert stale.post(reverse("auth-refresh")).status_code == 401


def test_logged_out_token_gets_no_grace(auth_client, user):
    token = auth_client.cookies[REFRESH_COOKIE].value
    auth_client.post(reverse("auth-logout"))
    replay = APIClient()
    replay.cookies[REFRESH_COOKIE] = token
    assert replay.post(reverse("auth-refresh")).status_code == 401


def test_refresh_for_deactivated_user_fails(auth_client, user):
    user.is_active = False
    user.save()
    assert auth_client.post(reverse("auth-refresh")).status_code == 401


# ---------------------------------------------------------------------------- logout


def test_logout_revokes_refresh_and_clears_cookies(auth_client, user):
    refresh = auth_client.cookies[REFRESH_COOKIE].value
    response = auth_client.post(reverse("auth-logout"))
    assert response.status_code == 204
    for name in (ACCESS_COOKIE, REFRESH_COOKIE, SESSION_HINT_COOKIE):
        assert response.cookies[name].value == ""
        assert int(response.cookies[name]["max-age"]) == 0
    assert BlacklistedToken.objects.filter(token__token=refresh).exists()
    assert events(user, "logout").count() == 1

    attacker = APIClient()
    attacker.cookies[REFRESH_COOKIE] = refresh
    assert attacker.post(reverse("auth-refresh")).status_code == 401


def test_logout_works_with_expired_access_token(api_client, user):
    login(api_client, user)
    api_client.cookies[ACCESS_COOKIE] = "expired"
    assert api_client.post(reverse("auth-logout")).status_code == 204


def test_logout_without_session(api_client):
    assert api_client.post(reverse("auth-logout")).status_code == 204


def test_expired_refresh_tokens_are_rejected(auth_client):
    future = timezone.now() + timedelta(days=15)
    with mock.patch("rest_framework_simplejwt.tokens.aware_utcnow", return_value=future):
        assert auth_client.post(reverse("auth-refresh")).status_code == 401
