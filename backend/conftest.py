from collections.abc import Iterator
from unittest import mock

import cloudinary
import pytest
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.accounts.tests.factories import UserFactory

PASSWORD = "correct-horse-battery"


@pytest.fixture(autouse=True)
def _isolate_external_services() -> Iterator[None]:
    """Never talk to the real Cloudinary account (CLOUDINARY_URL may be set in the dev .env)."""
    original = cloudinary.config().__dict__.copy()
    cloudinary.config(cloud_name="test-cloud", api_key="123456", api_secret="test-secret")
    with (
        mock.patch("cloudinary.uploader.destroy") as destroy,
        mock.patch("cloudinary.api.resource", side_effect=AssertionError("unmocked API call")),
    ):
        destroy.return_value = {"result": "ok"}
        yield
    cloudinary.config().__dict__.clear()
    cloudinary.config().__dict__.update(original)


@pytest.fixture(autouse=True)
def _clear_cache() -> None:
    cache.clear()  # throttle counters live in the cache


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def user(db: None) -> User:
    return UserFactory.create(password=PASSWORD, email_verified_at="2026-01-01T00:00:00Z")


@pytest.fixture
def unverified_user(db: None) -> User:
    return UserFactory.create(password=PASSWORD)


def login(client: APIClient, user: User, password: str = PASSWORD) -> None:
    response = client.post(
        reverse("auth-login"), {"email": user.email, "password": password}, format="json"
    )
    assert response.status_code == 200, response.content


@pytest.fixture
def auth_client(user: User) -> APIClient:
    client = APIClient()
    login(client, user)
    return client
