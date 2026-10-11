import logging

from django.core.cache import cache
from django.db import connection
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger(__name__)

HealthSerializer = inline_serializer(
    name="Health",
    fields={
        "status": serializers.ChoiceField(choices=["ok", "error"]),
        "checks": serializers.DictField(child=serializers.CharField(), required=False),
    },
)


class LivenessView(APIView):
    """Process is up. Used by Docker health checks; never touches dependencies."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = []

    @extend_schema(responses=HealthSerializer, tags=["health"])
    def get(self, request: Request) -> Response:
        return Response({"status": "ok"})


def _check_database() -> None:
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")


def _check_cache() -> None:
    cache.set("health:ready", "1", timeout=5)
    if cache.get("health:ready") != "1":
        raise RuntimeError("cache round-trip failed")


class ReadinessView(APIView):
    """Dependencies (Postgres, Redis) are reachable."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = []

    @extend_schema(responses={200: HealthSerializer, 503: HealthSerializer}, tags=["health"])
    def get(self, request: Request) -> Response:
        checks: dict[str, str] = {}
        for name, check in (("database", _check_database), ("cache", _check_cache)):
            try:
                check()
                checks[name] = "ok"
            except Exception:
                logger.exception("Readiness check %s failed", name)
                checks[name] = "error"
        healthy = all(value == "ok" for value in checks.values())
        return Response(
            {"status": "ok" if healthy else "error", "checks": checks},
            status=200 if healthy else 503,
        )
