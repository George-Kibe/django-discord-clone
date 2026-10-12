from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.utils import current_user

from . import services
from .models import MuteSetting
from .serializers import (
    MarkReadSerializer,
    MuteSettingSerializer,
    MuteWriteSerializer,
    NotificationPageSerializer,
    NotificationQuerySerializer,
    NotificationSerializer,
)

TAGS = ["notifications"]


class NotificationListView(APIView):
    @extend_schema(
        parameters=[
            OpenApiParameter("unread", bool),
            OpenApiParameter("cursor", str, description="`next_cursor` from the last page"),
            OpenApiParameter("limit", int, description="1-50, default 25"),
        ],
        responses=NotificationPageSerializer,
        tags=TAGS,
    )
    def get(self, request: Request) -> Response:
        query = NotificationQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        page = services.inbox(current_user(request), **query.validated_data)
        return Response(
            {**page, "results": NotificationSerializer(page["results"], many=True).data}
        )


class NotificationReadView(APIView):
    @extend_schema(request=MarkReadSerializer, responses={204: None}, tags=TAGS)
    def post(self, request: Request) -> Response:
        serializer = MarkReadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.mark_read(current_user(request), **serializer.validated_data)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MuteSettingsView(APIView):
    @extend_schema(responses=MuteSettingSerializer(many=True), tags=TAGS)
    def get(self, request: Request) -> Response:
        rows = MuteSetting.objects.filter(user=current_user(request))
        return Response(MuteSettingSerializer(rows, many=True).data)

    @extend_schema(
        request=MuteWriteSerializer, responses=MuteSettingSerializer(many=True), tags=TAGS
    )
    def put(self, request: Request) -> Response:
        serializer = MuteWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = current_user(request)
        services.set_mute(
            user,
            target_type=data["target_type"],
            target_id=data["target_id"],
            muted=data["muted"],
            muted_until=data.get("muted_until"),
        )
        return Response(
            MuteSettingSerializer(MuteSetting.objects.filter(user=user), many=True).data
        )
