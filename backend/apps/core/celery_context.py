"""Carry the request ID from the publishing request into Celery tasks (NFR-OBS-01)."""

import uuid
from typing import Any

from celery.signals import before_task_publish, task_postrun, task_prerun

from .request_id import coerce_request_id, get_request_id, request_id_var

HEADER = "request_id"


@before_task_publish.connect
def _attach_request_id(headers: dict[str, Any] | None = None, **_: Any) -> None:
    current = get_request_id()
    if headers is not None and current != "-":
        headers.setdefault(HEADER, current)


@task_prerun.connect
def _bind_request_id(task: Any = None, **_: Any) -> None:
    request = getattr(task, "request", None)
    incoming = getattr(request, HEADER, None) or (getattr(request, "headers", None) or {}).get(
        HEADER
    )
    # Tasks started by beat (or eagerly in tests) get their own ID.
    request_id_var.set(coerce_request_id(incoming) if incoming else f"task-{uuid.uuid4().hex}")


@task_postrun.connect
def _unbind_request_id(**_: Any) -> None:
    request_id_var.set("-")
