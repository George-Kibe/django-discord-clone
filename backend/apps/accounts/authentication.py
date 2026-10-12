from typing import Any

from django.middleware.csrf import CsrfViewMiddleware
from django.utils.translation import gettext_lazy as _
from rest_framework import exceptions
from rest_framework.authentication import BaseAuthentication
from rest_framework.permissions import SAFE_METHODS
from rest_framework.request import Request
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

from .cookies import ACCESS_COOKIE
from .exceptions import TokenNotValid
from .models import User


class _CSRFCheck(CsrfViewMiddleware):
    def _reject(self, request: Any, reason: str) -> str:
        return reason


def enforce_csrf(request: Request) -> None:
    """Run Django's CSRF check (token + Origin) for cookie-authenticated unsafe requests."""
    check = _CSRFCheck(lambda req: None)  # type: ignore[arg-type]
    check.process_request(request)
    reason = check.process_view(request, None, (), {})  # type: ignore[arg-type]
    if reason:
        raise exceptions.PermissionDenied(_("CSRF Failed: %s") % reason, code="csrf_failed")


def user_and_expiry_from_access_token(raw: str) -> tuple[User | None, int | None]:
    """Validate an access JWT: (active user, expiry as a Unix timestamp) or (None, None)."""
    try:
        token = AccessToken(raw)  # type: ignore[arg-type]
    except TokenError:
        return None, None
    user = User.objects.filter(pk=token.get("user_id"), is_active=True).first()
    return (user, int(token["exp"])) if user else (None, None)


def user_from_access_token(raw: str) -> User | None:
    """Validate an access JWT and return its active user, or None."""
    return user_and_expiry_from_access_token(raw)[0]


class JWTCookieAuthentication(BaseAuthentication):
    """Authenticates from the httpOnly ``access`` cookie (ADR-006).

    No cookie -> anonymous (other authenticators may run). An invalid/expired cookie -> 401
    ``token_not_valid`` so the client refreshes. Unsafe methods must pass the CSRF check.
    """

    def authenticate(self, request: Request) -> tuple[User, None] | None:
        raw = request.COOKIES.get(ACCESS_COOKIE)
        if not raw:
            return None
        user = user_from_access_token(raw)
        if user is None:
            raise TokenNotValid()
        if request.method not in SAFE_METHODS:
            enforce_csrf(request)
        return user, None

    def authenticate_header(self, request: Request) -> str:
        return 'Bearer realm="api"'
