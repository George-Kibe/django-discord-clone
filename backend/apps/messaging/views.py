from uuid import UUID

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsEmailVerified
from apps.accounts.utils import current_user
from apps.chat_channels.services import get_channel
from apps.core.permissions import Perm
from apps.core.throttling import ScopedWindowThrottle
from apps.servers.access import get_access

from . import services
from .serializers import (
    MessageEditSerializer,
    MessagePageSerializer,
    MessageQuerySerializer,
    MessageSerializer,
    MessageWriteSerializer,
)

TAGS = ["messages"]


class ChannelMessagesView(APIView):
    throttle_scope = "message_send"

    def get_permissions(self):  # type: ignore[no-untyped-def]
        if self.request.method == "POST":
            return [IsAuthenticated(), IsEmailVerified()]  # FR-AUTH-02: verified email to post
        return [IsAuthenticated()]

    def get_throttles(self):  # type: ignore[no-untyped-def]
        return [ScopedWindowThrottle()] if self.request.method == "POST" else []

    @extend_schema(
        parameters=[
            OpenApiParameter("before", str, description="Message id: older messages, newest first"),
            OpenApiParameter("after", str, description="Message id: newer messages, oldest first"),
            OpenApiParameter("limit", int, description="1-100, default 50"),
        ],
        responses=MessagePageSerializer,
        tags=TAGS,
    )
    def get(self, request: Request, channel_id: UUID) -> Response:
        query = MessageQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        channel = get_channel(channel_id)
        access = get_access(current_user(request), channel.server_id)
        access.require_channel(channel, Perm.READ_MESSAGE_HISTORY)
        messages, has_more = services.history(channel, **query.validated_data)
        return Response(
            {"results": MessageSerializer(messages, many=True).data, "has_more": has_more}
        )

    @extend_schema(
        request=MessageWriteSerializer,
        responses={201: MessageSerializer, 200: MessageSerializer},
        tags=TAGS,
        description="A repeated `nonce` returns the original message with 200 (idempotent retry).",
    )
    def post(self, request: Request, channel_id: UUID) -> Response:
        serializer = MessageWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        channel = get_channel(channel_id)
        user = current_user(request)
        access = get_access(user, channel.server_id)
        message, created = services.send_message(
            access, channel, author=user, **serializer.validated_data
        )
        return Response(
            MessageSerializer(message).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class MessageDetailView(APIView):
    @extend_schema(request=MessageEditSerializer, responses=MessageSerializer, tags=TAGS)
    def patch(self, request: Request, message_id: UUID) -> Response:
        serializer = MessageEditSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message = services.get_message(message_id)
        access = get_access(current_user(request), message.channel.server_id)
        message = services.edit_message(access, message, serializer.validated_data["content"])
        return Response(MessageSerializer(message).data)

    @extend_schema(responses={204: None}, tags=TAGS)
    def delete(self, request: Request, message_id: UUID) -> Response:
        message = services.get_message(message_id)
        access = get_access(current_user(request), message.channel.server_id)
        services.delete_message(access, message)
        return Response(status=status.HTTP_204_NO_CONTENT)
