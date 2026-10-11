"""Auth rate limits (FR-AUTH-07, NFR-SEC-06) with the production limits from base settings."""

import pytest
from django.urls import reverse

from conftest import PASSWORD

pytestmark = pytest.mark.django_db


def test_login_is_limited_per_ip(api_client, user):
    url = reverse("auth-login")
    for _ in range(5):
        assert api_client.post(url, {"email": user.email, "password": "wrong"}).status_code == 400
    response = api_client.post(url, {"email": user.email, "password": PASSWORD})
    assert response.status_code == 429
    assert response.json()["type"] == "throttled"
    assert int(response["Retry-After"]) > 0


def test_login_is_limited_per_account_across_ips(api_client, user):
    url = reverse("auth-login")
    for i in range(10):
        response = api_client.post(
            url, {"email": user.email, "password": "wrong"}, REMOTE_ADDR=f"10.0.0.{i}"
        )
        assert response.status_code == 400
    response = api_client.post(
        url, {"email": user.email.upper(), "password": PASSWORD}, REMOTE_ADDR="10.0.1.1"
    )
    assert response.status_code == 429
    # A different account from a fresh IP is unaffected.
    other = api_client.post(
        url, {"email": "x@example.com", "password": "y"}, REMOTE_ADDR="10.0.2.1"
    )
    assert other.status_code == 400


@pytest.mark.parametrize(
    ("url_name", "limit", "payload"),
    [
        ("auth-register", 5, {"email": "bad"}),
        ("auth-password-reset", 5, {"email": "nobody@example.com"}),
        ("auth-resend-verification", 10, {"email": "nobody@example.com"}),
        ("auth-verify-email", 10, {"token": "bad"}),
    ],
)
def test_anonymous_auth_endpoints_are_limited(api_client, url_name, limit, payload):
    url = reverse(url_name)
    for _ in range(limit):
        assert api_client.post(url, payload, format="json").status_code != 429
    assert api_client.post(url, payload, format="json").status_code == 429
