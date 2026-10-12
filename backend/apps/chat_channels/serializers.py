from typing import Any

from rest_framework import serializers

from apps.core.permissions import ALL

from .models import Category, Channel, PermissionOverwrite


class CategorySerializer(serializers.ModelSerializer[Category]):
    class Meta:
        model = Category
        fields = ["id", "name", "position"]
        read_only_fields = ["id", "position"]


class ChannelSerializer(serializers.ModelSerializer[Channel]):
    category_id = serializers.UUIDField(read_only=True, allow_null=True)
    server_id = serializers.UUIDField(read_only=True)
    permissions = serializers.SerializerMethodField(help_text="Your effective permissions here.")

    class Meta:
        model = Channel
        fields = [
            "id",
            "server_id",
            "category_id",
            "type",
            "name",
            "topic",
            "position",
            "slowmode_seconds",
            "permissions",
        ]
        read_only_fields = fields

    def get_permissions(self, channel: Channel) -> int:
        perms = self.context.get("channel_perms", {}).get(channel.pk)
        if perms is None:
            perms = self.context["access"].channel_perms(channel)
        return int(perms)


class ChannelWriteSerializer(serializers.Serializer[dict[str, Any]]):
    name = serializers.CharField(max_length=100)
    topic = serializers.CharField(max_length=1024, required=False, allow_blank=True)
    category_id = serializers.UUIDField(required=False, allow_null=True)
    slowmode_seconds = serializers.IntegerField(min_value=0, max_value=21600, required=False)


class ChannelUpdateSerializer(ChannelWriteSerializer):
    name = serializers.CharField(max_length=100, required=False)


class ChannelOrderItemSerializer(serializers.Serializer[dict[str, Any]]):
    id = serializers.UUIDField()
    category_id = serializers.UUIDField(allow_null=True)
    position = serializers.IntegerField(min_value=0)


class ChannelReorderSerializer(serializers.Serializer[dict[str, Any]]):
    channels = ChannelOrderItemSerializer(many=True)


class OverwriteSerializer(serializers.ModelSerializer[PermissionOverwrite]):
    role_id = serializers.UUIDField(read_only=True, allow_null=True)
    user_id = serializers.SerializerMethodField()

    class Meta:
        model = PermissionOverwrite
        fields = ["id", "role_id", "user_id", "allow", "deny"]
        read_only_fields = fields

    def get_user_id(self, overwrite: PermissionOverwrite) -> str | None:
        member = overwrite.member
        return str(member.user_id) if member is not None else None


def _valid_bits(value: int) -> None:
    if value < 0 or value & ~int(ALL):
        raise serializers.ValidationError("Unknown permission bits.")


class OverwriteWriteSerializer(serializers.Serializer[dict[str, Any]]):
    role_id = serializers.UUIDField(required=False, allow_null=True)
    user_id = serializers.UUIDField(required=False, allow_null=True)
    allow = serializers.IntegerField(validators=[_valid_bits])
    deny = serializers.IntegerField(validators=[_valid_bits])


class AckSerializer(serializers.Serializer[dict[str, Any]]):
    message_id = serializers.UUIDField()


class ReadStateSerializer(serializers.Serializer[dict[str, Any]]):
    channel_id = serializers.UUIDField()
    server_id = serializers.UUIDField()
    last_message_id = serializers.UUIDField(allow_null=True)
    last_read_message_id = serializers.UUIDField(allow_null=True)
    mention_count = serializers.IntegerField()
