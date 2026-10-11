"""Uniform error envelope for every API error (docs/API.md §1 "Errors")."""

import logging
from typing import Any

from django.core.exceptions import PermissionDenied
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from .request_id import get_request_id

logger = logging.getLogger(__name__)

_TYPE_BY_EXCEPTION: list[tuple[type[exceptions.APIException], str]] = [
    (exceptions.ValidationError, "validation_error"),
    (exceptions.NotAuthenticated, "authentication_error"),
    (exceptions.AuthenticationFailed, "authentication_error"),
    (exceptions.PermissionDenied, "permission_denied"),
    (exceptions.NotFound, "not_found"),
    (exceptions.Throttled, "throttled"),
    (exceptions.MethodNotAllowed, "method_not_allowed"),
    (exceptions.ParseError, "parse_error"),
    (exceptions.UnsupportedMediaType, "unsupported_media_type"),
]


def _error_type(exc: exceptions.APIException) -> str:
    for exc_class, name in _TYPE_BY_EXCEPTION:
        if isinstance(exc, exc_class):
            return name
    return "conflict" if exc.status_code == status.HTTP_409_CONFLICT else "error"


def _first_code(codes: Any) -> str:
    if isinstance(codes, str):
        return codes
    if isinstance(codes, list) and codes:
        return _first_code(codes[0])
    if isinstance(codes, dict) and codes:
        return _first_code(next(iter(codes.values())))
    return "invalid"


def exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    if isinstance(exc, Http404):
        exc = exceptions.NotFound()
    elif isinstance(exc, PermissionDenied):
        exc = exceptions.PermissionDenied()

    response = drf_exception_handler(exc, context)
    if response is None:
        # Unhandled exception: let Django return a 500 (and Sentry capture it).
        return None

    if not isinstance(exc, exceptions.APIException):  # pragma: no cover - DRF only handles these
        return response
    is_validation = isinstance(exc, exceptions.ValidationError)
    body: dict[str, Any] = {
        "type": _error_type(exc),
        "code": _first_code(exc.get_codes()),
        "detail": "Invalid input." if is_validation else str(exc.detail),
        "request_id": get_request_id(),
    }
    if is_validation:
        detail = exc.detail
        body["fields"] = detail if isinstance(detail, dict) else {"non_field_errors": detail}

    response.data = body
    return response
