from django.conf import settings
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import DESCRIPTIONS, Perm


class MetaView(APIView):
    """Public build/environment info for the frontend."""

    permission_classes = [AllowAny]

    @extend_schema(
        responses=inline_serializer(
            name="Meta",
            fields={
                "name": serializers.CharField(),
                "version": serializers.CharField(),
                "environment": serializers.CharField(),
            },
        ),
        tags=["meta"],
    )
    def get(self, request: Request) -> Response:
        return Response(
            {
                "name": settings.SPECTACULAR_SETTINGS["TITLE"],
                "version": settings.SPECTACULAR_SETTINGS["VERSION"],
                "environment": settings.ENVIRONMENT,
            }
        )


class PermissionListView(APIView):
    """Permission bits with labels, for the role editor (docs/DATA_MODEL.md#permissions)."""

    permission_classes = [AllowAny]

    @extend_schema(
        responses=inline_serializer(
            name="PermissionInfo",
            many=True,
            fields={
                "name": serializers.CharField(),
                "value": serializers.IntegerField(),
                "description": serializers.CharField(),
            },
        ),
        tags=["meta"],
    )
    def get(self, request: Request) -> Response:
        return Response(
            [{"name": p.name, "value": int(p), "description": DESCRIPTIONS[p]} for p in Perm]
        )
