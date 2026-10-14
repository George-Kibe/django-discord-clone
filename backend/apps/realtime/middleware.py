"""Authenticates WebSocket connections from the httpOnly ``access`` cookie (ADR-006)."""

from typing import Any

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser
from django.http.cookie import parse_cookie

from apps.accounts.authentication import user_and_expiry_from_access_token
from apps.accounts.cookies import ACCESS_COOKIE
from apps.core.request_id import coerce_request_id, request_id_var


def _cookies(scope: dict[str, Any]) -> dict[str, str]:
    for name, value in scope.get("headers", []):
        if name == b"cookie":
            return parse_cookie(value.decode("latin-1"))
    return {}


@database_sync_to_async
def _resolve(raw_token: str) -> tuple[Any, int | None]:
    user, expires_at = user_and_expiry_from_access_token(raw_token)
    return (user or AnonymousUser()), expires_at


def _request_id(scope: dict[str, Any]) -> str:
    for name, value in scope.get("headers", []):
        if name == b"x-request-id":
            return coerce_request_id(value.decode("latin-1"))
    return coerce_request_id(None)


class JWTCookieAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> Any:
        scope = dict(scope)
        # One correlation ID per connection (Caddy's, or a fresh one): every log line written
        # while handling this socket carries it (NFR-OBS-01).
        scope["request_id"] = _request_id(scope)
        request_id_var.set(scope["request_id"])
        raw_token = _cookies(scope).get(ACCESS_COOKIE)
        # No cookie: skip the database entirely (e.g. the public /ws/ping/ check).
        if raw_token:
            scope["user"], scope["access_expires_at"] = await _resolve(raw_token)
        else:
            scope["user"], scope["access_expires_at"] = AnonymousUser(), None
        return await super().__call__(scope, receive, send)
