import pytest
from django.urls import reverse
from rest_framework import serializers
from rest_framework.exceptions import NotAuthenticated
from rest_framework.test import APIRequestFactory

from apps.core.exceptions import exception_handler
from apps.core.request_id import coerce_request_id

pytestmark = pytest.mark.django_db


def test_meta_is_public(api_client):
    response = api_client.get(reverse("meta"))
    assert response.status_code == 200
    assert set(response.json()) == {"name", "version", "environment"}


def test_request_id_is_generated_and_echoed(api_client):
    generated = api_client.get(reverse("health-live"))
    assert len(generated["X-Request-ID"]) == 32

    echoed = api_client.get(reverse("health-live"), HTTP_X_REQUEST_ID="abc12345-from-caddy")
    assert echoed["X-Request-ID"] == "abc12345-from-caddy"


@pytest.mark.parametrize("value", [None, "", "short", "has spaces in it", "x" * 65])
def test_invalid_request_ids_are_replaced(value):
    assert len(coerce_request_id(value)) == 32


def _handle(exc):
    request = APIRequestFactory().get("/")
    return exception_handler(exc, {"request": request, "view": None})


def test_validation_error_envelope():
    response = _handle(serializers.ValidationError({"email": ["Enter a valid email address."]}))
    assert response.status_code == 400
    assert response.data["type"] == "validation_error"
    assert response.data["code"] == "invalid"
    assert response.data["fields"] == {"email": ["Enter a valid email address."]}
    assert "request_id" in response.data


def test_authentication_error_envelope():
    response = _handle(NotAuthenticated())
    assert response.status_code in (401, 403)
    assert response.data["type"] == "authentication_error"
    assert response.data["code"] == "not_authenticated"
    assert "fields" not in response.data


def test_unhandled_exceptions_fall_through():
    assert _handle(RuntimeError("boom")) is None


def test_openapi_schema_is_served(api_client):
    response = api_client.get(reverse("schema"), {"format": "json"})
    assert response.status_code == 200
    assert "/api/v1/meta" in response.json()["paths"]
