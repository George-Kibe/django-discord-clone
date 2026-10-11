from typing import Any

from rest_framework import serializers

from apps.accounts.serializers import UserSummarySerializer

from .models import MAX_MESSAGE_LENGTH, Message


class MessageSerializer(serializers.ModelSerializer[Message]):
    author = UserSummarySerializer(read_only=True, allow_null=True)
    channel_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = Message
        fields = [
            "id",
            "channel_id",
            "author",
            "type",
            "content",
            "nonce",
            "created_at",
            "edited_at",
        ]
        read_only_fields = fields


class MessagePageSerializer(serializers.Serializer[dict[str, Any]]):
    results = MessageSerializer(many=True)
    has_more = serializers.BooleanField()


class MessageWriteSerializer(serializers.Serializer[dict[str, Any]]):
    content = serializers.CharField(max_length=MAX_MESSAGE_LENGTH, trim_whitespace=False)
    nonce = serializers.CharField(max_length=64, required=False, allow_blank=True, allow_null=True)

    def validate_content(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("Message can't be empty.")
        return value.strip("\n")


class MessageEditSerializer(serializers.Serializer[dict[str, Any]]):
    content = serializers.CharField(max_length=MAX_MESSAGE_LENGTH, trim_whitespace=False)

    def validate_content(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("Message can't be empty. Delete it instead.")
        return value.strip("\n")


class MessageQuerySerializer(serializers.Serializer[dict[str, Any]]):
    before = serializers.UUIDField(required=False)
    after = serializers.UUIDField(required=False)
    limit = serializers.IntegerField(min_value=1, max_value=100, default=50)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if attrs.get("before") and attrs.get("after"):
            raise serializers.ValidationError("Use either before or after, not both.")
        return attrs
