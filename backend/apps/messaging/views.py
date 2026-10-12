from typing import Any
from uuid import UUID

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import exceptions, serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsEmailVerified
from apps.accounts.serializers import UserSummarySerializer
from apps.accounts.utils import current_user
from apps.core.throttling import ScopedWindowThrottle

from . import dms, services
from .serializers import (
    AckSerializer,
    DMAddParticipantsSerializer,
    DMConversationSerializer,
    DMCreateSerializer,
    DMUpdateSerializer,
    MessageEditSerializer,
    MessagePageSerializer,
    MessageQuerySerializer,
    MessageSerializer,
    MessageWriteSerializer,
    ReactionUsersSerializer,
    SearchQuerySerializer,
    SearchResultPageSerializer,
)
from .targets import Target, channel_target, dm_target, message_target

TAGS = ["messages"]
DM_TAGS = ["dms"]

HISTORY_PARAMS = [
    OpenApiParameter("before", str, description="Message id: older messages, newest first"),
    OpenApiParameter("after", str, description="Message id: newer messages, oldest first"),
    OpenApiParameter("limit", int, description="1-100, default 50"),
]
SEARCH_PARAMS = [
    OpenApiParameter("q", str, description='Words or phrases (web-search syntax: "quotes", -not)'),
    OpenApiParameter("author", str, description="User id"),
    OpenApiParameter("channel", str, description="Channel id (server search)"),
    OpenApiParameter("has", str, enum=["attachment", "image", "file"]),
    OpenApiParameter("before", str, description="YYYY-MM-DD"),
    OpenApiParameter("after", str, description="YYYY-MM-DD"),
    OpenApiParameter("cursor", str),
    OpenApiParameter("limit", int, description="1-50, default 25"),
]


def message_response(message: Any, user: Any, status_code: int = 200) -> Response:
    return Response(services.serialize([message], user)[0], status=status_code)


class ConversationMessagesView(APIView):
    """History + send, shared by channels and DMs."""

    throttle_scope = "message_send"

    def get_permissions(self):  # type: ignore[no-untyped-def]
        if self.request.method == "POST":
            return [IsAuthenticated(), IsEmailVerified()]  # FR-AUTH-02: verified email to post
        return [IsAuthenticated()]

    def get_throttles(self):  # type: ignore[no-untyped-def]
        return [ScopedWindowThrottle()] if self.request.method == "POST" else []

    def target(self, request: Request, pk: UUID) -> Target:
        raise NotImplementedError

    def list_messages(self, request: Request, pk: UUID) -> Response:
        query = MessageQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        user = current_user(request)
        messages, has_more = services.history(self.target(request, pk), **query.validated_data)
        return Response({"results": services.serialize(messages, user), "has_more": has_more})

    def send(self, request: Request, pk: UUID) -> Response:
        serializer = MessageWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = current_user(request)
        message, created = services.send_message(
            self.target(request, pk), author=user, **serializer.validated_data
        )
        return message_response(
            message, user, status.HTTP_201_CREATED if created else status.HTTP_200_OK
        )


class ChannelMessagesView(ConversationMessagesView):
    def target(self, request: Request, pk: UUID) -> Target:
        return channel_target(current_user(request), pk)

    @extend_schema(parameters=HISTORY_PARAMS, responses=MessagePageSerializer, tags=TAGS)
    def get(self, request: Request, channel_id: UUID) -> Response:
        return self.list_messages(request, channel_id)

    @extend_schema(
        request=MessageWriteSerializer,
        responses={201: MessageSerializer, 200: MessageSerializer},
        tags=TAGS,
        description="A repeated `nonce` returns the original message with 200 (idempotent retry).",
    )
    def post(self, request: Request, channel_id: UUID) -> Response:
        return self.send(request, channel_id)


class DMMessagesView(ConversationMessagesView):
    def target(self, request: Request, pk: UUID) -> Target:
        return dm_target(current_user(request), pk)

    @extend_schema(parameters=HISTORY_PARAMS, responses=MessagePageSerializer, tags=DM_TAGS)
    def get(self, request: Request, dm_id: UUID) -> Response:
        return self.list_messages(request, dm_id)

    @extend_schema(
        request=MessageWriteSerializer,
        responses={201: MessageSerializer, 200: MessageSerializer},
        tags=DM_TAGS,
    )
    def post(self, request: Request, dm_id: UUID) -> Response:
        return self.send(request, dm_id)


class MessageDetailView(APIView):
    @extend_schema(request=MessageEditSerializer, responses=MessageSerializer, tags=TAGS)
    def patch(self, request: Request, message_id: UUID) -> Response:
        serializer = MessageEditSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = current_user(request)
        message = services.get_message(message_id)
        message = services.edit_message(
            message_target(user, message), message, serializer.validated_data["content"]
        )
        return message_response(message, user)

    @extend_schema(responses={204: None}, tags=TAGS)
    def delete(self, request: Request, message_id: UUID) -> Response:
        user = current_user(request)
        message = services.get_message(message_id)
        services.delete_message(message_target(user, message), message)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MessagePinView(APIView):
    @extend_schema(request=None, responses=MessageSerializer, tags=TAGS, summary="Pin a message")
    def put(self, request: Request, message_id: UUID) -> Response:
        user = current_user(request)
        message = services.get_message(message_id)
        services.pin(message_target(user, message), message)
        return message_response(services.refetch(message), user)

    @extend_schema(responses={204: None}, tags=TAGS, summary="Unpin a message")
    def delete(self, request: Request, message_id: UUID) -> Response:
        user = current_user(request)
        message = services.get_message(message_id)
        services.unpin(message_target(user, message), message)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ChannelPinsView(APIView):
    @extend_schema(responses=MessageSerializer(many=True), tags=TAGS)
    def get(self, request: Request, channel_id: UUID) -> Response:
        user = current_user(request)
        return Response(services.serialize(services.pins(channel_target(user, channel_id)), user))


class DMPinsView(APIView):
    @extend_schema(responses=MessageSerializer(many=True), tags=DM_TAGS)
    def get(self, request: Request, dm_id: UUID) -> Response:
        user = current_user(request)
        return Response(services.serialize(services.pins(dm_target(user, dm_id)), user))


class ReactionView(APIView):
    @extend_schema(request=None, responses={204: None}, tags=TAGS, summary="Add your reaction")
    def put(self, request: Request, message_id: UUID, emoji: str) -> Response:
        user = current_user(request)
        message = services.get_message(message_id)
        services.add_reaction(message_target(user, message), message, emoji)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(responses={204: None}, tags=TAGS, summary="Remove your reaction")
    def delete(self, request: Request, message_id: UUID, emoji: str) -> Response:
        user = current_user(request)
        message = services.get_message(message_id)
        services.remove_reaction(message_target(user, message), message, emoji)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(responses=ReactionUsersSerializer, tags=TAGS, summary="Who reacted")
    def get(self, request: Request, message_id: UUID, emoji: str) -> Response:
        user = current_user(request)
        message = services.get_message(message_id)
        users = services.reaction_users(message_target(user, message), message, emoji)
        return Response({"emoji": emoji, "users": UserSummarySerializer(users, many=True).data})


def search_response(user: Any, result: dict[str, Any]) -> Response:
    return Response(
        {
            "results": services.serialize(result["results"], user),
            "total": result["total"],
            "next_cursor": result["next_cursor"],
        }
    )


class ServerSearchView(APIView):
    @extend_schema(parameters=SEARCH_PARAMS, responses=SearchResultPageSerializer, tags=TAGS)
    def get(self, request: Request, server_id: UUID) -> Response:
        query = SearchQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        user = current_user(request)
        return search_response(
            user, services.search(user, server_id=server_id, **query.validated_data)
        )


class DMSearchView(APIView):
    @extend_schema(parameters=SEARCH_PARAMS, responses=SearchResultPageSerializer, tags=DM_TAGS)
    def get(self, request: Request, dm_id: UUID) -> Response:
        query = SearchQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        params = dict(query.validated_data)
        params.pop("channel", None)
        user = current_user(request)
        return search_response(user, services.search(user, target=dm_target(user, dm_id), **params))


# ---------------------------------------------------------------------------- DMs


def dm_response(user: Any, conversation: Any, status_code: int = 200) -> Response:
    context = dms.context_for(user, [conversation])
    return Response(
        DMConversationSerializer(conversation, context=context).data, status=status_code
    )


class DMListView(APIView):
    def get_permissions(self):  # type: ignore[no-untyped-def]
        if self.request.method == "POST":
            return [IsAuthenticated(), IsEmailVerified()]
        return [IsAuthenticated()]

    @extend_schema(responses=DMConversationSerializer(many=True), tags=DM_TAGS)
    def get(self, request: Request) -> Response:
        user = current_user(request)
        items, context = dms.conversations(user)
        return Response(DMConversationSerializer(items, many=True, context=context).data)

    @extend_schema(
        request=DMCreateSerializer,
        responses={201: DMConversationSerializer, 200: DMConversationSerializer},
        tags=DM_TAGS,
        description="One user: returns the existing 1:1 conversation (200) or creates it (201).",
    )
    def post(self, request: Request) -> Response:
        serializer = DMCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = current_user(request)
        conversation, created = dms.open_dm(user, **serializer.validated_data)
        return dm_response(user, conversation, 201 if created else 200)


class DMDetailView(APIView):
    @extend_schema(responses=DMConversationSerializer, tags=DM_TAGS)
    def get(self, request: Request, dm_id: UUID) -> Response:
        user = current_user(request)
        return dm_response(user, dm_target(user, dm_id).dm)

    @extend_schema(request=DMUpdateSerializer, responses=DMConversationSerializer, tags=DM_TAGS)
    def patch(self, request: Request, dm_id: UUID) -> Response:
        serializer = DMUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        user = current_user(request)
        target = dm_target(user, dm_id)
        dms.update(target, **serializer.validated_data)
        target.dm.refresh_from_db()  # type: ignore[union-attr]
        return dm_response(user, target.dm)


class DMParticipantsView(APIView):
    @extend_schema(
        request=DMAddParticipantsSerializer, responses=DMConversationSerializer, tags=DM_TAGS
    )
    def post(self, request: Request, dm_id: UUID) -> Response:
        serializer = DMAddParticipantsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = current_user(request)
        target = dm_target(user, dm_id)
        dms.add_participants(target, serializer.validated_data["user_ids"])
        return dm_response(user, target.dm)


class DMParticipantView(APIView):
    @extend_schema(responses={204: None}, tags=DM_TAGS, summary="Leave, or remove someone (owner)")
    def delete(self, request: Request, dm_id: UUID, user_id: UUID) -> Response:
        dms.remove_participant(dm_target(current_user(request), dm_id), user_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class DMAckSerializer(serializers.Serializer[dict[str, Any]]):
    last_read_message_id = serializers.UUIDField()


class DMAckView(APIView):
    @extend_schema(request=AckSerializer, responses=DMAckSerializer, tags=DM_TAGS)
    def post(self, request: Request, dm_id: UUID) -> Response:
        serializer = AckSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = current_user(request)
        target = dm_target(user, dm_id)
        dm = target.dm
        if dm is None or dm.last_message_id is None:
            raise exceptions.ValidationError({"message_id": ["The conversation has no messages."]})
        message_id = min(serializer.validated_data["message_id"], dm.last_message_id)
        participant = services.mark_dm_read(user, dm, message_id)
        return Response({"last_read_message_id": participant.last_read_message_id})


class ContactsView(APIView):
    @extend_schema(
        parameters=[OpenApiParameter("q", str, description="Username or display name")],
        responses=UserSummarySerializer(many=True),
        tags=DM_TAGS,
        summary="People you share a server with",
    )
    def get(self, request: Request) -> Response:
        users = dms.contacts(current_user(request), request.query_params.get("q", "")[:50])
        return Response(UserSummarySerializer(users, many=True).data)
