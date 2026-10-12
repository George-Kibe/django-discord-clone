from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.accounts.serializers import UserSummarySerializer
from apps.core.permissions import ALL
from apps.media.services import image_url

from .models import Invite, Member, Role, Server, Topic
from .services import MAX_AGE_CHOICES

ICON_SIZE = 128


class TopicSerializer(serializers.ModelSerializer[Topic]):
    class Meta:
        model = Topic
        fields = ["id", "name", "slug"]


class ServerSerializer(serializers.ModelSerializer[Server]):
    icon_url = serializers.SerializerMethodField()
    owner_id = serializers.UUIDField(read_only=True)
    topic = TopicSerializer(read_only=True)

    class Meta:
        model = Server
        fields = [
            "id",
            "name",
            "description",
            "icon_url",
            "owner_id",
            "topic",
            "is_public",
            "member_count",
            "created_at",
        ]
        read_only_fields = fields

    def get_icon_url(self, server: Server) -> str | None:
        return image_url(server.icon_public_id, size=ICON_SIZE)


class MyMembershipSerializer(serializers.Serializer[dict[str, Any]]):
    is_owner = serializers.BooleanField()
    permissions = serializers.IntegerField(help_text="Effective server-level permission bitfield.")
    role_ids = serializers.ListField(child=serializers.UUIDField())
    nickname = serializers.CharField()


class ServerDetailSerializer(ServerSerializer):
    me = serializers.SerializerMethodField()

    class Meta(ServerSerializer.Meta):
        fields = [*ServerSerializer.Meta.fields, "me"]
        read_only_fields = fields

    @extend_schema_field(MyMembershipSerializer)
    def get_me(self, server: Server) -> dict[str, Any]:
        access = self.context["access"]
        return MyMembershipSerializer(
            {
                "is_owner": access.is_owner,
                "permissions": int(access.base),
                "role_ids": sorted(access.role_ids, key=str),
                "nickname": access.member.nickname,
            }
        ).data


class ServerCreateSerializer(serializers.Serializer[dict[str, Any]]):
    name = serializers.CharField(max_length=100)
    description = serializers.CharField(max_length=1000, required=False, allow_blank=True)
    icon_public_id = serializers.CharField(max_length=255, required=False, allow_blank=True)
    is_public = serializers.BooleanField(required=False)
    topic_id = serializers.PrimaryKeyRelatedField(
        queryset=Topic.objects.all(), source="topic", required=False, allow_null=True
    )

    def validate_name(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Give your server a name.")
        return value


class ServerUpdateSerializer(ServerCreateSerializer):
    name = serializers.CharField(max_length=100, required=False)


class TransferOwnershipSerializer(serializers.Serializer[dict[str, Any]]):
    user_id = serializers.UUIDField()


class RoleSerializer(serializers.ModelSerializer[Role]):
    class Meta:
        model = Role
        fields = [
            "id",
            "name",
            "color",
            "position",
            "permissions",
            "is_default",
            "mentionable",
            "hoist",
        ]
        read_only_fields = ["id", "position", "is_default"]

    def validate_permissions(self, value: int) -> int:
        if value < 0 or value & ~int(ALL):
            raise serializers.ValidationError("Unknown permission bits.")
        return value

    def validate_color(self, value: int) -> int:
        if value > 0xFFFFFF:
            raise serializers.ValidationError("Use a 24-bit RGB colour.")
        return value


class RoleReorderSerializer(serializers.Serializer[dict[str, Any]]):
    role_ids = serializers.ListField(child=serializers.UUIDField(), help_text="Highest first.")


class MemberSerializer(serializers.ModelSerializer[Member]):
    user = UserSummarySerializer(read_only=True)
    role_ids = serializers.SerializerMethodField()
    is_owner = serializers.SerializerMethodField()
    presence = serializers.SerializerMethodField(
        help_text="online, idle, dnd or offline (invisible users appear offline)."
    )

    class Meta:
        model = Member
        fields = ["user", "nickname", "role_ids", "is_owner", "joined_at", "presence"]
        read_only_fields = fields

    def get_role_ids(self, member: Member) -> list[str]:
        return sorted(str(r.pk) for r in member.roles.all())

    def get_is_owner(self, member: Member) -> bool:
        return member.user_id == member.server.owner_id

    @extend_schema_field(serializers.ChoiceField(choices=["online", "idle", "dnd", "offline"]))
    def get_presence(self, member: Member) -> str:
        presence: dict[str, str] = self.context.get("presence") or {}
        return presence.get(str(member.user_id), "offline")


class MemberUpdateSerializer(serializers.Serializer[dict[str, Any]]):
    nickname = serializers.CharField(max_length=32, required=False, allow_blank=True)
    role_ids = serializers.ListField(child=serializers.UUIDField(), required=False)


class InviteSerializer(serializers.ModelSerializer[Invite]):
    inviter = UserSummarySerializer(read_only=True)
    server_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = Invite
        fields = ["code", "server_id", "inviter", "max_uses", "uses", "expires_at", "created_at"]
        read_only_fields = fields


class InviteCreateSerializer(serializers.Serializer[dict[str, Any]]):
    max_age = serializers.ChoiceField(
        choices=MAX_AGE_CHOICES, default=604800, help_text="Seconds; 0 = never."
    )
    max_uses = serializers.IntegerField(
        min_value=0, max_value=100, default=0, help_text="0 = unlimited."
    )


class InviteServerSerializer(serializers.ModelSerializer[Server]):
    icon_url = serializers.SerializerMethodField()

    class Meta:
        model = Server
        fields = ["id", "name", "description", "icon_url", "member_count"]
        read_only_fields = fields

    def get_icon_url(self, server: Server) -> str | None:
        return image_url(server.icon_public_id, size=ICON_SIZE)


class InvitePreviewSerializer(serializers.ModelSerializer[Invite]):
    server = InviteServerSerializer(read_only=True)
    inviter = UserSummarySerializer(read_only=True)

    class Meta:
        model = Invite
        fields = ["code", "server", "inviter", "expires_at"]
        read_only_fields = fields


# ---------------------------------------------------------------------------- moderation, discovery


class ReasonSerializer(serializers.Serializer[dict[str, Any]]):
    reason = serializers.CharField(max_length=512, required=False, allow_blank=True, default="")


class BanCreateSerializer(ReasonSerializer):
    user_id = serializers.UUIDField()


class BanSerializer(serializers.Serializer[Any]):
    user = UserSummarySerializer()
    moderator = UserSummarySerializer(allow_null=True)
    reason = serializers.CharField()
    created_at = serializers.DateTimeField()


class AuditEventSerializer(serializers.Serializer[Any]):
    id = serializers.IntegerField()
    action = serializers.CharField()
    action_label = serializers.CharField(source="get_action_display")
    actor = UserSummarySerializer(allow_null=True)
    target_type = serializers.CharField()
    target_id = serializers.CharField()
    target_label = serializers.CharField()
    changes = serializers.JSONField()
    created_at = serializers.DateTimeField()


class AuditPageSerializer(serializers.Serializer[dict[str, Any]]):
    results = AuditEventSerializer(many=True)
    next_cursor = serializers.IntegerField(allow_null=True)


class DiscoverServerSerializer(ServerSerializer):
    joined = serializers.SerializerMethodField(help_text="Whether you're already a member.")

    class Meta(ServerSerializer.Meta):
        fields = [*ServerSerializer.Meta.fields, "joined"]
        read_only_fields = fields

    def get_joined(self, server: Server) -> bool:
        return server.pk in self.context.get("joined", set())
