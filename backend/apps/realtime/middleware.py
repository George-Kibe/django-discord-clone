"""Authenticates WebSocket connections from the httpOnly ``access`` cookie (ADR-006)."""

from typing import Any

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser
from django.http.cookie import parse_cookie

from apps.accounts.authentication import user_from_access_token
from apps.accounts.cookies import ACCESS_COOKIE


def _cookies(scope: dict[str, Any]) -> dict[str, str]:
    for name, value in scope.get("headers", []):
        if name == b"cookie":
            return parse_cookie(value.decode("latin-1"))
    return {}


@database_sync_to_async
def _resolve_user(raw_token: str) -> Any:
    return user_from_access_token(raw_token) or AnonymousUser()


class JWTCookieAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> Any:
        scope = dict(scope)
        raw_token = _cookies(scope).get(ACCESS_COOKIE)
        # No cookie: skip the database entirely (e.g. the public /ws/ping/ check).
        scope["user"] = await _resolve_user(raw_token) if raw_token else AnonymousUser()
        return await super().__call__(scope, receive, send)
