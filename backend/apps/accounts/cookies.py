"""Auth cookies (ADR-006).

- ``access``  httpOnly, path=/            : short-lived access JWT (also used by the WebSocket)
- ``refresh`` httpOnly, path=/api/v1/auth : long-lived refresh JWT, only sent to auth endpoints
- ``session`` readable by JS/proxy        : non-secret "probably signed in" hint for routing
"""

from typing import Literal, cast

from django.conf import settings
from django.http import HttpResponse
from rest_framework_simplejwt.tokens import RefreshToken

ACCESS_COOKIE = "access"
REFRESH_COOKIE = "refresh"
SESSION_HINT_COOKIE = "session"
REFRESH_COOKIE_PATH = "/api/v1/auth"


def _lifetimes() -> tuple[int, int]:
    jwt = settings.SIMPLE_JWT
    return (
        int(jwt["ACCESS_TOKEN_LIFETIME"].total_seconds()),
        int(jwt["REFRESH_TOKEN_LIFETIME"].total_seconds()),
    )


def set_auth_cookies(response: HttpResponse, refresh: RefreshToken) -> None:
    access_age, refresh_age = _lifetimes()
    common = {"secure": settings.AUTH_COOKIE_SECURE, "samesite": settings.AUTH_COOKIE_SAMESITE}
    response.set_cookie(
        ACCESS_COOKIE, str(refresh.access_token), max_age=access_age, httponly=True, **common
    )
    response.set_cookie(
        REFRESH_COOKIE,
        str(refresh),
        max_age=refresh_age,
        httponly=True,
        path=REFRESH_COOKIE_PATH,
        **common,
    )
    response.set_cookie(SESSION_HINT_COOKIE, "1", max_age=refresh_age, httponly=False, **common)


def clear_auth_cookies(response: HttpResponse) -> None:
    samesite = cast(Literal["Lax", "Strict", "None"], settings.AUTH_COOKIE_SAMESITE)
    response.delete_cookie(ACCESS_COOKIE, samesite=samesite)
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_COOKIE_PATH, samesite=samesite)
    response.delete_cookie(SESSION_HINT_COOKIE, samesite=samesite)
