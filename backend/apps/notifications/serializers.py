from typing import Any

from rest_framework import serializers

from apps.accounts.serializers import UserSummarySerializer

from .models import MuteSetting, Notification


class NotificationSerializer(serializers.ModelSerializer[Notification]):
    actor = UserSummarySerializer(read_only=True, allow_null=True)
    message_id = serializers.UUIDField(read_only=True, allow_null=True)
    data = serializers.DictField(  # type: ignore[assignment]
        read_only=True,
        help_text="Where it happened and a preview: server_id, server_name, channel_id, "
        "channel_name, dm_id, dm_name, content, count (coalesced DMs).",
    )

    class Meta:
        model = Notification
        fields = ["id", "type", "actor", "message_id", "data", "read_at", "created_at"]
        read_only_fields = fields


class NotificationPageSerializer(serializers.Serializer[dict[str, Any]]):
    results = NotificationSerializer(many=True)
    unread_count = serializers.IntegerField()
    next_cursor = serializers.UUIDField(allow_null=True)


class NotificationQuerySerializer(serializers.Serializer[dict[str, Any]]):
    unread = serializers.BooleanField(required=False, default=False)
    cursor = serializers.UUIDField(required=False)
    limit = serializers.IntegerField(min_value=1, max_value=50, default=25)


class MarkReadSerializer(serializers.Serializer[dict[str, Any]]):
    ids = serializers.ListField(child=serializers.UUIDField(), required=False, max_length=200)
    all = serializers.BooleanField(required=False, default=False)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if not attrs.get("all") and not attrs.get("ids"):
            raise serializers.ValidationError("Give ids or all=true.")
        return attrs


class MuteSettingSerializer(serializers.ModelSerializer[MuteSetting]):
    server_id = serializers.UUIDField(read_only=True, allow_null=True)
    channel_id = serializers.UUIDField(read_only=True, allow_null=True)
    dm_id = serializers.UUIDField(read_only=True, allow_null=True)

    class Meta:
        model = MuteSetting
        fields = ["server_id", "channel_id", "dm_id", "muted_until"]
        read_only_fields = fields


class MuteWriteSerializer(serializers.Serializer[dict[str, Any]]):
    target_type = serializers.ChoiceField(choices=["server", "channel", "dm"])
    target_id = serializers.UUIDField()
    muted = serializers.BooleanField()
    muted_until = serializers.DateTimeField(
        required=False, allow_null=True, help_text="Omit or null: until unmuted."
    )
