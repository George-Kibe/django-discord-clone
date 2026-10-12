from typing import Any
from uuid import UUID

from drf_spectacular.utils import extend_schema
from rest_framework import exceptions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.utils import current_user
from apps.core.permissions import Perm
from apps.servers.access import ServerAccess, get_access

from . import services
from .models import Category, Channel, PermissionOverwrite
from .serializers import (
    AckSerializer,
    CategorySerializer,
    ChannelReorderSerializer,
    ChannelSerializer,
    ChannelUpdateSerializer,
    ChannelWriteSerializer,
    OverwriteSerializer,
    OverwriteWriteSerializer,
    ReadStateSerializer,
)

TAGS = ["channels"]


class ChannelScopedView(APIView):
    def channel_access(self, request: Request, channel_id: UUID) -> tuple[Channel, ServerAccess]:
        channel = services.get_channel(channel_id)
        access = get_access(current_user(request), channel.server_id)
        access.require_channel(channel, Perm.VIEW_CHANNEL)
        return channel, access


# ---------------------------------------------------------------------------- categories


class CategoryListView(APIView):
    @extend_schema(responses=CategorySerializer(many=True), tags=TAGS)
    def get(self, request: Request, server_id: UUID) -> Response:
        access = get_access(current_user(request), server_id)
        return Response(
            CategorySerializer(Category.objects.filter(server=access.server), many=True).data
        )

    @extend_schema(request=CategorySerializer, responses={201: CategorySerializer}, tags=TAGS)
    def post(self, request: Request, server_id: UUID) -> Response:
        access = get_access(current_user(request), server_id)
        serializer = CategorySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        category = services.create_category(access, serializer.validated_data["name"])
        return Response(CategorySerializer(category).data, status=status.HTTP_201_CREATED)


class CategoryDetailView(APIView):
    def lookup(self, request: Request, category_id: UUID) -> tuple[Category, ServerAccess]:
        category = Category.objects.filter(pk=category_id).first()
        if category is None:
            from rest_framework.exceptions import NotFound

            raise NotFound()
        return category, get_access(current_user(request), category.server_id)

    @extend_schema(request=CategorySerializer, responses=CategorySerializer, tags=TAGS)
    def patch(self, request: Request, category_id: UUID) -> Response:
        category, access = self.lookup(request, category_id)
        serializer = CategorySerializer(category, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        return Response(
            CategorySerializer(
                services.update_category(access, category, dict(serializer.validated_data))
            ).data
        )

    @extend_schema(responses={204: None}, tags=TAGS)
    def delete(self, request: Request, category_id: UUID) -> Response:
        category, access = self.lookup(request, category_id)
        services.delete_category(access, category)
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------- channels


class ChannelListView(APIView):
    @extend_schema(
        responses=ChannelSerializer(many=True), tags=TAGS, summary="Channels visible to me"
    )
    def get(self, request: Request, server_id: UUID) -> Response:
        access = get_access(current_user(request), server_id)
        visible = services.visible_channels(access)
        context = {"access": access, "channel_perms": {c.pk: p for c, p in visible}}
        return Response(ChannelSerializer([c for c, _ in visible], many=True, context=context).data)

    @extend_schema(request=ChannelWriteSerializer, responses={201: ChannelSerializer}, tags=TAGS)
    def post(self, request: Request, server_id: UUID) -> Response:
        access = get_access(current_user(request), server_id)
        serializer = ChannelWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        channel = services.create_channel(access, dict(serializer.validated_data))
        channel = services.get_channel(channel.pk)
        return Response(
            ChannelSerializer(channel, context={"access": access}).data,
            status=status.HTTP_201_CREATED,
        )


class ChannelReorderView(APIView):
    @extend_schema(
        request=ChannelReorderSerializer, responses=ChannelSerializer(many=True), tags=TAGS
    )
    def patch(self, request: Request, server_id: UUID) -> Response:
        access = get_access(current_user(request), server_id)
        serializer = ChannelReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.reorder_channels(access, serializer.validated_data["channels"])
        visible = services.visible_channels(access)
        context = {"access": access, "channel_perms": {c.pk: p for c, p in visible}}
        return Response(ChannelSerializer([c for c, _ in visible], many=True, context=context).data)


class ChannelDetailView(ChannelScopedView):
    @extend_schema(responses=ChannelSerializer, tags=TAGS)
    def get(self, request: Request, channel_id: UUID) -> Response:
        channel, access = self.channel_access(request, channel_id)
        return Response(ChannelSerializer(channel, context={"access": access}).data)

    @extend_schema(request=ChannelUpdateSerializer, responses=ChannelSerializer, tags=TAGS)
    def patch(self, request: Request, channel_id: UUID) -> Response:
        channel, access = self.channel_access(request, channel_id)
        serializer = ChannelUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        services.update_channel(access, channel, dict(serializer.validated_data))
        return Response(
            ChannelSerializer(services.get_channel(channel.pk), context={"access": access}).data
        )

    @extend_schema(responses={204: None}, tags=TAGS)
    def delete(self, request: Request, channel_id: UUID) -> Response:
        channel, access = self.channel_access(request, channel_id)
        services.delete_channel(access, channel)
        return Response(status=status.HTTP_204_NO_CONTENT)


class OverwriteListView(ChannelScopedView):
    @extend_schema(responses=OverwriteSerializer(many=True), tags=TAGS)
    def get(self, request: Request, channel_id: UUID) -> Response:
        channel, _ = self.channel_access(request, channel_id)
        overwrites = PermissionOverwrite.objects.filter(channel=channel).select_related("member")
        return Response(OverwriteSerializer(overwrites, many=True).data)

    @extend_schema(
        request=OverwriteWriteSerializer,
        responses=OverwriteSerializer,
        tags=TAGS,
        summary="Create or replace an overwrite",
    )
    def put(self, request: Request, channel_id: UUID) -> Response:
        channel, access = self.channel_access(request, channel_id)
        serializer = OverwriteWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        overwrite = services.set_overwrite(access, channel, **serializer.validated_data)
        return Response(OverwriteSerializer(overwrite).data)


class OverwriteDetailView(ChannelScopedView):
    @extend_schema(responses={204: None}, tags=TAGS)
    def delete(self, request: Request, channel_id: UUID, overwrite_id: UUID) -> Response:
        channel, access = self.channel_access(request, channel_id)
        services.delete_overwrite(access, channel, overwrite_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------- read states


class ChannelAckView(ChannelScopedView):
    @extend_schema(
        request=AckSerializer,
        responses=ReadStateSerializer,
        tags=TAGS,
        summary="Mark the channel read up to a message",
    )
    def post(self, request: Request, channel_id: UUID) -> Response:
        channel, _ = self.channel_access(request, channel_id)
        serializer = AckSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message_id = serializer.validated_data["message_id"]
        if channel.last_message_id is None:
            raise exceptions.ValidationError({"message_id": ["The channel has no messages."]})
        # UUIDv7 ids sort by time: never mark past the newest message.
        state = services.mark_read(
            current_user(request), channel, min(message_id, channel.last_message_id)
        )
        return Response(
            ReadStateSerializer(
                {
                    "channel_id": channel.pk,
                    "server_id": channel.server_id,
                    "last_message_id": channel.last_message_id,
                    "last_read_message_id": state.last_read_message_id,
                    "mention_count": state.mention_count,
                }
            ).data
        )


class ReadStateListView(APIView):
    @extend_schema(responses=ReadStateSerializer(many=True), tags=TAGS)
    def get(self, request: Request) -> Response:
        rows: Any = services.read_states(current_user(request))
        return Response(ReadStateSerializer(rows, many=True).data)
