"""Per-request correlation ID shared by middleware, logging, and (later) Celery/WebSocket."""

import re
import uuid
from contextvars import ContextVar

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

# Accept upstream IDs (Caddy's {http.request.uuid}) only if they look sane.
_VALID_ID = re.compile(r"^[A-Za-z0-9\-_.]{8,64}$")


def coerce_request_id(value: str | None) -> str:
    if value and _VALID_ID.match(value):
        return value
    return uuid.uuid4().hex


def get_request_id() -> str:
    return request_id_var.get()
