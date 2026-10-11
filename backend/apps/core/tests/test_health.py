from unittest import mock

import pytest
from django.urls import reverse

pytestmark = pytest.mark.django_db


def test_liveness(api_client):
    response = api_client.get(reverse("health-live"))
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_ok(api_client):
    response = api_client.get(reverse("health-ready"))
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "checks": {"database": "ok", "cache": "ok"}}


def test_readiness_reports_failing_dependency(api_client):
    with mock.patch("apps.core.health.cache.get", return_value=None):
        response = api_client.get(reverse("health-ready"))
    assert response.status_code == 503
    assert response.json()["checks"] == {"database": "ok", "cache": "error"}
