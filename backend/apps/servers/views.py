from typing import Any
from uuid import UUID

from django.db.models import Prefetch, Q
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsEmailVerified
from apps.accounts.utils import current_user
from apps.core.pagination import PageNumberPagination
from apps.core.permissions import Perm
from apps.core.throttling import ScopedWindowThrottle
from apps.realtime import presence

from . import services
from .access import ServerAccess, get_access
from .models import Ban, Invite, Member, Role, Server, ServerAuditEvent, Topic
from .serializers import (
    AuditEventSerializer,
    AuditPageSerializer,
    BanCreateSerializer,
    BanSerializer,
    DiscoverServerSerializer,
    InviteCreateSerializer,
    InvitePreviewSerializer,
    InviteSerializer,
    MemberSerializer,
    MemberUpdateSerializer,
    ReasonSerializer,
    RoleReorderSerializer,
    RoleSerializer,
    ServerCreateSerializer,
    ServerDetailSerializer,
    ServerSerializer,
    ServerUpdateSerializer,
    TopicSerializer,
    TransferOwnershipSerializer,
)

TAGS = ["servers"]


def _detail(access: ServerAccess) -> dict[str, Any]:
    access.server.refresh_from_db()
    return ServerDetailSerializer(access.server, context={"access": access}).data


class ServerScopedView(APIView):
    def access(self, request: Request, server_id: UUID) -> ServerAccess:
        return get_access(current_user(request), server_id)


# ---------------------------------------------------------------------------- servers


class ServerListView(APIView):
    def get_permissions(self):  # type: ignore[no-untyped-def]
        if self.request.method == "POST":
            return [IsAuthenticated(), IsEmailVerified()]
        return [IsAuthenticated()]

    @extend_schema(
        responses=ServerSerializer(many=True), tags=TAGS, summary="Servers I'm a member of"
    )
    def get(self, request: Request) -> Response:
        servers = Server.objects.filter(members__user=current_user(request)).select_related("topic")
        return Response(ServerSerializer(servers, many=True).data)

    @extend_schema(
        request=ServerCreateSerializer, responses={201: ServerDetailSerializer}, tags=TAGS
    )
    def post(self, request: Request) -> Response:
        serializer = ServerCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = current_user(request)
        server = services.create_server(owner=user, **serializer.validated_data)
        return Response(_detail(get_access(user, server)), status=status.HTTP_201_CREATED)


class ServerDetailView(ServerScopedView):
    @extend_schema(responses=ServerDetailSerializer, tags=TAGS)
    def get(self, request: Request, server_id: UUID) -> Response:
        return Response(_detail(self.access(request, server_id)))

    @extend_schema(request=ServerUpdateSerializer, responses=ServerDetailSerializer, tags=TAGS)
    def patch(self, request: Request, server_id: UUID) -> Response:
        access = self.access(request, server_id)
        serializer = ServerUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        services.update_server(access, dict(serializer.validated_data))
        return Response(_detail(access))

    @extend_schema(responses={204: None}, tags=TAGS)
    def delete(self, request: Request, server_id: UUID) -> Response:
        services.delete_server(self.access(request, server_id))
        return Response(status=status.HTTP_204_NO_CONTENT)


class TransferOwnershipView(ServerScopedView):
    @extend_schema(request=TransferOwnershipSerializer, responses=ServerDetailSerializer, tags=TAGS)
    def post(self, request: Request, server_id: UUID) -> Response:
        access = self.access(request, server_id)
        serializer = TransferOwnershipSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.transfer_ownership(access, serializer.validated_data["user_id"])
        return Response(_detail(get_access(access.user, server_id)))


class JoinServerView(APIView):
    permission_classes = [IsAuthenticated, IsEmailVerified]

    @extend_schema(
        request=None,
        responses={201: ServerDetailSerializer},
        tags=TAGS,
        summary="Join a public server",
    )
    def post(self, request: Request, server_id: UUID) -> Response:
        server = Server.objects.filter(pk=server_id).first()
        if server is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        user = current_user(request)
        services.join_public_server(server, user)
        return Response(_detail(get_access(user, server)), status=status.HTTP_201_CREATED)


class LeaveServerView(ServerScopedView):
    @extend_schema(request=None, responses={204: None}, tags=TAGS)
    def post(self, request: Request, server_id: UUID) -> Response:
        services.leave_server(self.access(request, server_id))
        return Response(status=status.HTTP_204_NO_CONTENT)


class TopicListView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(responses=TopicSerializer(many=True), tags=TAGS)
    def get(self, request: Request) -> Response:
        return Response(TopicSerializer(Topic.objects.all(), many=True).data)


# ---------------------------------------------------------------------------- members


def _members(server_id: UUID) -> Any:
    return (
        Member.objects.filter(server_id=server_id)
        .select_related("user", "server")
        .prefetch_related(Prefetch("roles", queryset=Role.objects.only("id")))
        .order_by("joined_at")
    )


class MemberListView(ServerScopedView):
    pagination_class = PageNumberPagination

    @extend_schema(responses=MemberSerializer(many=True), tags=TAGS)
    def get(self, request: Request, server_id: UUID) -> Response:
        self.access(request, server_id)
        paginator = PageNumberPagination()
        paginator.page_size = 100
        page: list[Member] | None = paginator.paginate_queryset(
            _members(server_id), request, view=self
        )
        members = page or []
        context = {"presence": presence.get_presence(m.user_id for m in members)}
        return paginator.get_paginated_response(
            MemberSerializer(members, many=True, context=context).data
        )


class MemberDetailView(ServerScopedView):
    @extend_schema(request=MemberUpdateSerializer, responses=MemberSerializer, tags=TAGS)
    def patch(self, request: Request, server_id: UUID, user_id: UUID) -> Response:
        access = self.access(request, server_id)
        member = _members(server_id).filter(user_id=user_id).first()
        if member is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        serializer = MemberUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        services.update_member(access, member, serializer.validated_data)
        context = {"presence": presence.get_presence([member.user_id])}
        return Response(
            MemberSerializer(_members(server_id).get(pk=member.pk), context=context).data
        )


# ---------------------------------------------------------------------------- roles


class RoleListView(ServerScopedView):
    @extend_schema(responses=RoleSerializer(many=True), tags=TAGS)
    def get(self, request: Request, server_id: UUID) -> Response:
        access = self.access(request, server_id)
        return Response(RoleSerializer(Role.objects.filter(server=access.server), many=True).data)

    @extend_schema(request=RoleSerializer, responses={201: RoleSerializer}, tags=TAGS)
    def post(self, request: Request, server_id: UUID) -> Response:
        access = self.access(request, server_id)
        serializer = RoleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        role = services.create_role(access, dict(serializer.validated_data))
        return Response(RoleSerializer(role).data, status=status.HTTP_201_CREATED)


class RoleDetailView(ServerScopedView):
    def role(self, access: ServerAccess, role_id: UUID) -> Role | None:
        return Role.objects.filter(server=access.server, pk=role_id).first()

    @extend_schema(request=RoleSerializer, responses=RoleSerializer, tags=TAGS)
    def patch(self, request: Request, server_id: UUID, role_id: UUID) -> Response:
        access = self.access(request, server_id)
        role = self.role(access, role_id)
        if role is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        serializer = RoleSerializer(role, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        return Response(
            RoleSerializer(services.update_role(access, role, dict(serializer.validated_data))).data
        )

    @extend_schema(responses={204: None}, tags=TAGS)
    def delete(self, request: Request, server_id: UUID, role_id: UUID) -> Response:
        access = self.access(request, server_id)
        role = self.role(access, role_id)
        if role is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        services.delete_role(access, role)
        return Response(status=status.HTTP_204_NO_CONTENT)


class RoleReorderView(ServerScopedView):
    @extend_schema(request=RoleReorderSerializer, responses=RoleSerializer(many=True), tags=TAGS)
    def patch(self, request: Request, server_id: UUID) -> Response:
        access = self.access(request, server_id)
        serializer = RoleReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.reorder_roles(access, serializer.validated_data["role_ids"])
        return Response(RoleSerializer(Role.objects.filter(server=access.server), many=True).data)


# ---------------------------------------------------------------------------- invites


class ServerInviteListView(ServerScopedView):
    throttle_scope = "invite_create"

    def get_throttles(self):  # type: ignore[no-untyped-def]
        return [ScopedWindowThrottle()] if self.request.method == "POST" else []

    @extend_schema(responses=InviteSerializer(many=True), tags=TAGS)
    def get(self, request: Request, server_id: UUID) -> Response:
        invites = [
            i for i in services.visible_invites(self.access(request, server_id)) if i.is_usable
        ]
        return Response(InviteSerializer(invites, many=True).data)

    @extend_schema(request=InviteCreateSerializer, responses={201: InviteSerializer}, tags=TAGS)
    def post(self, request: Request, server_id: UUID) -> Response:
        access = self.access(request, server_id)
        serializer = InviteCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        invite = services.create_invite(access, **serializer.validated_data)
        return Response(InviteSerializer(invite).data, status=status.HTTP_201_CREATED)


class InviteDetailView(APIView):
    def get_permissions(self):  # type: ignore[no-untyped-def]
        return [AllowAny()] if self.request.method == "GET" else [IsAuthenticated()]

    @extend_schema(responses=InvitePreviewSerializer, tags=TAGS, summary="Invite preview (public)")
    def get(self, request: Request, code: str) -> Response:
        return Response(InvitePreviewSerializer(services.get_usable_invite(code)).data)

    @extend_schema(responses={204: None}, tags=TAGS, summary="Revoke an invite")
    def delete(self, request: Request, code: str) -> Response:
        invite = Invite.objects.filter(code=code, revoked_at__isnull=True).first()
        if invite is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        services.revoke_invite(get_access(current_user(request), invite.server_id), invite)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AcceptInviteView(APIView):
    permission_classes = [IsAuthenticated, IsEmailVerified]

    @extend_schema(request=None, responses=ServerDetailSerializer, tags=TAGS)
    def post(self, request: Request, code: str) -> Response:
        user = current_user(request)
        server = services.accept_invite(code, user)
        return Response(_detail(get_access(user, server)))


# ---------------------------------------------------------------------------- moderation (FR-MOD)


class KickView(ServerScopedView):
    @extend_schema(request=ReasonSerializer, responses={204: None}, tags=TAGS, summary="Kick")
    def post(self, request: Request, server_id: UUID, user_id: UUID) -> Response:
        serializer = ReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.kick(self.access(request, server_id), user_id, **serializer.validated_data)
        return Response(status=status.HTTP_204_NO_CONTENT)


class BanListView(ServerScopedView):
    @extend_schema(responses=BanSerializer(many=True), tags=TAGS)
    def get(self, request: Request, server_id: UUID) -> Response:
        access = self.access(request, server_id)
        access.require(Perm.BAN_MEMBERS)
        bans = Ban.objects.filter(server=access.server).select_related("user", "moderator")
        return Response(BanSerializer(bans, many=True).data)

    @extend_schema(request=BanCreateSerializer, responses={201: BanSerializer}, tags=TAGS)
    def post(self, request: Request, server_id: UUID) -> Response:
        serializer = BanCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        row = services.ban(self.access(request, server_id), **serializer.validated_data)
        return Response(BanSerializer(row).data, status=status.HTTP_201_CREATED)


class BanDetailView(ServerScopedView):
    @extend_schema(responses={204: None}, tags=TAGS, summary="Unban")
    def delete(self, request: Request, server_id: UUID, user_id: UUID) -> Response:
        services.unban(self.access(request, server_id), user_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AuditLogView(ServerScopedView):
    @extend_schema(
        parameters=[
            OpenApiParameter("cursor", int, description="`next_cursor` from the last page"),
            OpenApiParameter("action", str, description="Filter by action"),
        ],
        responses=AuditPageSerializer,
        tags=TAGS,
    )
    def get(self, request: Request, server_id: UUID) -> Response:
        access = self.access(request, server_id)
        access.require(Perm.VIEW_AUDIT_LOG)
        qs = ServerAuditEvent.objects.filter(server=access.server).select_related("actor")
        if action := request.query_params.get("action"):
            qs = qs.filter(action=action)
        cursor = request.query_params.get("cursor")
        if cursor and cursor.isdigit():
            qs = qs.filter(id__lt=int(cursor))
        rows = list(qs.order_by("-id")[:51])
        page = rows[:50]
        return Response(
            {
                "results": AuditEventSerializer(page, many=True).data,
                "next_cursor": page[-1].pk if len(rows) > 50 else None,
            }
        )


class DiscoverView(APIView):
    """FR-SRV-08: public servers, searchable by name/description, filterable by topic."""

    pagination_class = PageNumberPagination

    @extend_schema(
        parameters=[
            OpenApiParameter("q", str, description="Name or description"),
            OpenApiParameter("topic", str, description="Topic slug"),
            OpenApiParameter("page", int),
        ],
        responses=DiscoverServerSerializer(many=True),
        tags=TAGS,
    )
    def get(self, request: Request) -> Response:
        qs = Server.objects.filter(is_public=True).select_related("topic")
        if q := request.query_params.get("q", "").strip()[:100]:
            qs = qs.filter(Q(name__icontains=q) | Q(description__icontains=q))
        if topic := request.query_params.get("topic"):
            qs = qs.filter(topic__slug=topic)
        qs = qs.order_by("-member_count", "name")
        paginator = PageNumberPagination()
        paginator.page_size = 24
        page: list[Server] | None = paginator.paginate_queryset(qs, request, view=self)
        servers = page or []
        joined = set(
            Member.objects.filter(
                user=current_user(request), server_id__in=[s.pk for s in servers]
            ).values_list("server_id", flat=True)
        )
        return paginator.get_paginated_response(
            DiscoverServerSerializer(servers, many=True, context={"joined": joined}).data
        )
