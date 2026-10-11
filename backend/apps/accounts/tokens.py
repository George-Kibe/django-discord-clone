"""JWT issuing/rotation and signed email tokens."""

import contextlib
import logging
from datetime import timedelta
from typing import Any, Literal

from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core import signing
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework_simplejwt.exceptions import TokenBackendError, TokenError
from rest_framework_simplejwt.settings import api_settings as jwt_settings
from rest_framework_simplejwt.state import token_backend
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from . import audit
from .exceptions import TokenNotValid
from .models import AuthAuditEvent, User

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------- JWT


def issue_tokens(user: User) -> RefreshToken:
    return RefreshToken.for_user(user)


def revoke_all_refresh_tokens(user: User) -> int:
    """Blacklist every outstanding refresh token of the user (logout everywhere)."""
    count = 0
    outstanding = OutstandingToken.objects.filter(user=user, expires_at__gt=timezone.now())
    for token in outstanding.exclude(blacklistedtoken__isnull=False):
        BlacklistedToken.objects.get_or_create(token=token)
        count += 1
    return count


def blacklist_refresh_token(raw: str) -> None:
    with contextlib.suppress(TokenError):  # already invalid: nothing to revoke
        RefreshToken(raw).blacklist()  # type: ignore[arg-type]


def _handle_possible_reuse(raw: str, request: Any) -> None:
    """A correctly signed but blacklisted refresh token is being replayed.

    Outside the short grace window (concurrent refresh from another tab) this indicates a stolen
    token, so every session of that user is revoked.
    """
    try:
        payload = token_backend.decode(raw, verify=True)  # type: ignore[arg-type]
    except TokenBackendError:
        return
    blacklisted = BlacklistedToken.objects.filter(token__jti=payload.get("jti")).first()
    if blacklisted is None:
        return
    grace = timedelta(seconds=settings.AUTH_REFRESH_REUSE_GRACE_SECONDS)
    if blacklisted.blacklisted_at > timezone.now() - grace:
        return
    user = User.objects.filter(pk=payload.get(jwt_settings.USER_ID_CLAIM) or "").first()
    if user is None:
        return
    revoked = revoke_all_refresh_tokens(user)
    audit.record(AuthAuditEvent.Event.TOKEN_REFRESH_REUSE, request, user=user)
    logger.warning("Refresh token reuse for user %s; revoked %d tokens", user.pk, revoked)


def rotate_refresh_token(raw: str | None, request: Any = None) -> tuple[User, RefreshToken]:
    if not raw:
        raise TokenNotValid()
    try:
        token = RefreshToken(raw)  # type: ignore[arg-type]  # checks signature, expiry, blacklist
    except TokenError:
        _handle_possible_reuse(raw, request)
        raise TokenNotValid() from None
    user = User.objects.filter(pk=token.get(jwt_settings.USER_ID_CLAIM), is_active=True).first()
    if user is None:
        raise TokenNotValid()
    token.blacklist()
    return user, issue_tokens(user)


# ---------------------------------------------------------------------------- email tokens

EmailPurpose = Literal["verify", "change"]
_EMAIL_SALT = "accounts.email-token"


def make_email_token(user: User, email: str, purpose: EmailPurpose) -> str:
    return signing.dumps({"u": str(user.pk), "e": email, "p": purpose}, salt=_EMAIL_SALT)


def read_email_token(token: str) -> dict[str, str] | None:
    try:
        data = signing.loads(token, salt=_EMAIL_SALT, max_age=settings.EMAIL_VERIFICATION_MAX_AGE)
    except signing.BadSignature:  # includes SignatureExpired
        return None
    return data if isinstance(data, dict) else None


def make_password_reset_token(user: User) -> tuple[str, str]:
    return urlsafe_base64_encode(force_bytes(user.pk)), default_token_generator.make_token(user)


def read_password_reset_token(uid: str, token: str) -> User | None:
    try:
        pk = force_str(urlsafe_base64_decode(uid))
        user = User.objects.filter(pk=pk, is_active=True).first()
    except ValueError, TypeError, OverflowError, DjangoValidationError:
        return None
    if user is None or not default_token_generator.check_token(user, token):
        return None
    return user
