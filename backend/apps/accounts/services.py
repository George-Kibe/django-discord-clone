"""Account business logic. Views stay thin; everything that changes state lives here."""

from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.signals import user_logged_in, user_logged_out
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.http import HttpRequest
from django.utils import timezone
from rest_framework import exceptions
from rest_framework_simplejwt.tokens import RefreshToken

from . import audit, emails, tokens
from .models import AuthAuditEvent, User

INVALID_CREDENTIALS = "Invalid email or password."


def check_password_strength(password: str, user: User, field: str = "password") -> None:
    """Django's password validators, reported as a DRF field error."""
    try:
        validate_password(password, user)
    except DjangoValidationError as error:
        raise exceptions.ValidationError(
            {field: list(error.messages)}, code="weak_password"
        ) from None


@transaction.atomic
def register_user(
    *, email: str, username: str, password: str, display_name: str = "", request: HttpRequest
) -> User:
    user = User(email=email.lower(), username=username.lower(), display_name=display_name)
    check_password_strength(password, user)
    user.set_password(password)
    user.save()
    audit.record(AuthAuditEvent.Event.REGISTERED, request, user=user)
    emails.send_verification_email(user)
    return user


def login(*, email: str, password: str, request: HttpRequest) -> tuple[User, RefreshToken]:
    # authenticate() emits user_login_failed (audited) on bad credentials or inactive users.
    user = authenticate(request, email=email.lower(), password=password)
    if not isinstance(user, User):
        raise exceptions.ValidationError(
            {"non_field_errors": [INVALID_CREDENTIALS]}, code="invalid_credentials"
        )
    user_logged_in.send(sender=User, request=request, user=user)  # audit + last_login
    return user, tokens.issue_tokens(user)


def logout(*, user: User | None, refresh_raw: str | None, request: HttpRequest) -> None:
    if refresh_raw:
        tokens.blacklist_refresh_token(refresh_raw)
    user_logged_out.send(sender=User, request=request, user=user)


def resend_verification(email: str) -> None:
    user = User.objects.filter(email=email.lower(), is_active=True).first()
    if user and not user.is_email_verified:
        emails.send_verification_email(user)


@transaction.atomic
def confirm_email_token(token: str, request: HttpRequest) -> User:
    """Handles both initial verification and email-change confirmation links."""
    data = tokens.read_email_token(token)
    invalid = exceptions.ValidationError(
        {"token": ["This link is invalid or has expired."]}, code="invalid_token"
    )
    if data is None:
        raise invalid
    user = User.objects.select_for_update().filter(pk=data.get("u", ""), is_active=True).first()
    if user is None:
        raise invalid
    email, purpose = data.get("e", ""), data.get("p")

    if purpose == "verify":
        if user.email != email:
            raise invalid  # email changed since the link was sent
        if not user.is_email_verified:
            user.email_verified_at = timezone.now()
            user.save(update_fields=["email_verified_at"])
            audit.record(AuthAuditEvent.Event.EMAIL_VERIFIED, request, user=user)
        return user

    if purpose == "change":
        if user.email == email:
            return user  # already applied
        if User.objects.filter(email=email).exclude(pk=user.pk).exists():
            raise exceptions.ValidationError(
                {"token": ["That email address is already in use."]}, code="email_taken"
            )
        old_email = user.email
        user.email = email
        user.email_verified_at = timezone.now()
        user.save(update_fields=["email", "email_verified_at"])
        audit.record(AuthAuditEvent.Event.EMAIL_CHANGED, request, user=user, email=email)
        emails.send_email_changed_notice(user, old_email)
        return user

    raise invalid


def request_password_reset(email: str) -> None:
    user = User.objects.filter(email=email.lower(), is_active=True).first()
    if user and user.has_usable_password():
        emails.send_password_reset_email(user)


@transaction.atomic
def confirm_password_reset(*, uid: str, token: str, password: str, request: HttpRequest) -> User:
    user = tokens.read_password_reset_token(uid, token)
    if user is None:
        raise exceptions.ValidationError(
            {"token": ["This link is invalid or has expired."]}, code="invalid_token"
        )
    check_password_strength(password, user)
    user.set_password(password)
    user.save(update_fields=["password"])
    tokens.revoke_all_refresh_tokens(user)  # sign out everywhere
    audit.record(AuthAuditEvent.Event.PASSWORD_RESET, request, user=user)
    emails.send_password_changed_notice(user)
    return user


@transaction.atomic
def change_password(
    *, user: User, current_password: str, new_password: str, request: HttpRequest
) -> RefreshToken:
    if not user.check_password(current_password):
        raise exceptions.ValidationError(
            {"current_password": ["Your current password is incorrect."]}, code="invalid_password"
        )
    check_password_strength(new_password, user, field="new_password")
    user.set_password(new_password)
    user.save(update_fields=["password"])
    tokens.revoke_all_refresh_tokens(user)
    audit.record(AuthAuditEvent.Event.PASSWORD_CHANGED, request, user=user)
    emails.send_password_changed_notice(user)
    return tokens.issue_tokens(user)  # keep this session signed in


def request_email_change(*, user: User, new_email: str, password: str) -> None:
    if not user.check_password(password):
        raise exceptions.ValidationError(
            {"password": ["Your password is incorrect."]}, code="invalid_password"
        )
    new_email = new_email.lower()
    if new_email == user.email:
        raise exceptions.ValidationError(
            {"new_email": ["That is already your email address."]}, code="same_email"
        )
    if User.objects.filter(email=new_email).exists():
        raise exceptions.ValidationError(
            {"new_email": ["That email address is already in use."]}, code="email_taken"
        )
    emails.send_email_change_confirmation(user, new_email)
