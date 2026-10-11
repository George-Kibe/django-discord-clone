import json

import pytest

from apps.core.sentry import before_breadcrumb, before_send, scrub_url


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://x/api/v1/meta?token=abc", "https://x/api/v1/meta"),
        ("/reset?uid=1&token=t#frag", "/reset"),
        ("/api/v1/users/me", "/api/v1/users/me"),
    ],
)
def test_scrub_url(url, expected):
    assert scrub_url(url) == expected


def test_before_send_removes_query_strings_everywhere():
    event = {
        "request": {
            "url": "https://x/a?token=SECRET",
            "query_string": "token=SECRET",
            "method": "GET",
        },
        "breadcrumbs": {
            "values": [{"category": "httplib", "data": {"url": "https://x/b?k=SECRET"}}]
        },
    }
    result = before_send(event, {})
    assert "SECRET" not in json.dumps(result)
    assert result["request"] == {"url": "https://x/a", "method": "GET"}


def test_before_breadcrumb():
    crumb = before_breadcrumb({"data": {"url": "/x?token=SECRET", "status_code": 200}}, {})
    assert crumb["data"] == {"url": "/x", "status_code": 200}
