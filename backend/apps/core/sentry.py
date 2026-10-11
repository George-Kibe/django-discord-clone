"""Sentry privacy hooks (NFR-PRIV-01), mirroring frontend/src/lib/sentry-options.ts."""

from typing import Any

_URL_KEYS = ("url", "from", "to")


def scrub_url(url: str) -> str:
    """Drop the query string and fragment, where links may carry tokens."""
    for separator in ("?", "#"):
        url = url.split(separator, 1)[0]
    return url


def _scrub_data(data: dict[str, Any] | None) -> None:
    if not data:
        return
    for key in _URL_KEYS:
        if isinstance(data.get(key), str):
            data[key] = scrub_url(data[key])


def before_send(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any]:
    request = event.get("request")
    if isinstance(request, dict):
        if isinstance(request.get("url"), str):
            request["url"] = scrub_url(request["url"])
        request.pop("query_string", None)
    for crumb in (event.get("breadcrumbs") or {}).get("values", []):
        _scrub_data(crumb.get("data"))
    return event


def before_breadcrumb(crumb: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any]:
    _scrub_data(crumb.get("data"))
    return crumb
