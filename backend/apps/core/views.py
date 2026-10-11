from django.conf import settings
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView


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
