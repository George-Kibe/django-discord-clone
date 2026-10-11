from collections.abc import Callable

from django.http import HttpRequest, HttpResponse

from .request_id import coerce_request_id, request_id_var

REQUEST_ID_HEADER = "X-Request-ID"


class RequestIDMiddleware:
    """Binds the incoming X-Request-ID (or a fresh one) to the request and echoes it back."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        request_id = coerce_request_id(request.headers.get(REQUEST_ID_HEADER))
        token = request_id_var.set(request_id)
        try:
            response = self.get_response(request)
        finally:
            request_id_var.reset(token)
        response[REQUEST_ID_HEADER] = request_id
        return response
