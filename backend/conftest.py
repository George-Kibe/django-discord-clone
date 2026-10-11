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


# ---------------------------------------------------------------------------- servers (Phase 3)


@pytest.fixture
def make_user(db: None):
    def _make(**kwargs: object) -> User:
        kwargs.setdefault("email_verified_at", "2026-01-01T00:00:00Z")
        return UserFactory.create(password=PASSWORD, **kwargs)

    return _make


@pytest.fixture
def client_for():
    def _client(user: User) -> APIClient:
        client = APIClient()
        client.force_authenticate(user)
        return client

    return _client


@pytest.fixture
def server(user: User):
    from apps.servers.services import create_server

    return create_server(owner=user, name="Test Server")


@pytest.fixture
def join():
    def _join(server, user: User):
        from apps.servers.services import add_member

        return add_member(server, user)

    return _join


@pytest.fixture
def topics(db: None) -> None:
    """Re-seed topics: transactional tests elsewhere truncate migration-seeded rows."""
    import importlib

    from django.apps import apps as django_apps

    importlib.import_module("apps.servers.migrations.0002_seed_topics").seed(django_apps, None)
