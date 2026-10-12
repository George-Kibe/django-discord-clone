from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.accounts.serializers import UserSummarySerializer
from apps.media.services import attachment_urls

from .models import MAX_ATTACHMENTS, MAX_GROUP_DM_SIZE, MAX_MESSAGE_LENGTH, Attachment, Message


class AttachmentSerializer(serializers.ModelSerializer[Attachment]):
    url = serializers.SerializerMethodField()
    preview_url = serializers.SerializerMethodField()
    is_image = serializers.SerializerMethodField()

    class Meta:
        model = Attachment
        fields = [
            "id",
            "filename",
            "content_type",
            "size_bytes",
            "width",
            "height",
            "is_image",
            "url",
            "preview_url",
        ]
        read_only_fields = fields

    def get_url(self, attachment: Attachment) -> str | None:
        return attachment_urls(attachment.public_id, attachment.resource_type, attachment.filename)[
            "url"
        ]

    def get_preview_url(self, attachment: Attachment) -> str | None:
        return attachment_urls(attachment.public_id, attachment.resource_type, attachment.filename)[
            "preview_url"
        ]

    def get_is_image(self, attachment: Attachment) -> bool:
        return attachment.resource_type == "image"


class ReactionSummarySerializer(serializers.Serializer[dict[str, Any]]):
    emoji = serializers.CharField()
    count = serializers.IntegerField()
    me = serializers.BooleanField(help_text="Whether the requesting user reacted with it.")


class MentionRoleSerializer(serializers.Serializer[dict[str, Any]]):
    id = serializers.UUIDField()
    name = serializers.CharField()
    color = serializers.IntegerField()


class ReplyPreviewSerializer(serializers.Serializer[Message]):
    id = serializers.UUIDField()
    author = UserSummarySerializer(allow_null=True)
    content = serializers.SerializerMethodField()
    deleted = serializers.SerializerMethodField()
    has_attachments = serializers.SerializerMethodField()

    def get_content(self, message: Message) -> str:
        return "" if message.deleted_at else message.content[:200]

    def get_deleted(self, message: Message) -> bool:
        return message.deleted_at is not None

    def get_has_attachments(self, message: Message) -> bool:
        return bool(message.attachments.all()) if message.deleted_at is None else False


class PollOptionResultSerializer(serializers.Serializer[dict[str, Any]]):
    id = serializers.IntegerField()
    text = serializers.CharField()
    votes = serializers.IntegerField()


class PollSummarySerializer(serializers.Serializer[dict[str, Any]]):
    id = serializers.UUIDField()
    question = serializers.CharField()
    allow_multiple = serializers.BooleanField()
    closes_at = serializers.DateTimeField(allow_null=True)
    closed_at = serializers.DateTimeField(allow_null=True)
    options = PollOptionResultSerializer(many=True)
    total_voters = serializers.IntegerField()
    my_votes = serializers.ListField(
        child=serializers.IntegerField(), help_text="Your chosen option ids (empty in broadcasts)."
    )


class MessageSerializer(serializers.ModelSerializer[Message]):
    """Context: ``reactions`` and ``polls`` ({message_id: summary}), see services.serialize."""

    author = UserSummarySerializer(read_only=True, allow_null=True)
    channel_id = serializers.UUIDField(read_only=True, allow_null=True)
    dm_id = serializers.UUIDField(read_only=True, allow_null=True)
    reply_to = serializers.SerializerMethodField()
    attachments = AttachmentSerializer(many=True, read_only=True)
    reactions = serializers.SerializerMethodField()
    mentions = serializers.SerializerMethodField()
    mention_roles = serializers.SerializerMethodField()
    poll = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            "id",
            "channel_id",
            "dm_id",
            "author",
            "type",
            "content",
            "nonce",
            "created_at",
            "edited_at",
            "pinned_at",
            "reply_to",
            "attachments",
            "reactions",
            "mentions",
            "mention_roles",
            "mention_everyone",
            "poll",
        ]
        read_only_fields = fields

    @extend_schema_field(ReplyPreviewSerializer(allow_null=True))
    def get_reply_to(self, message: Message) -> dict[str, Any] | None:
        if message.reply_to_id is None or message.reply_to is None:
            return None
        return dict(ReplyPreviewSerializer(message.reply_to).data)

    @extend_schema_field(ReactionSummarySerializer(many=True))
    def get_reactions(self, message: Message) -> list[dict[str, Any]]:
        summaries: dict[Any, list[dict[str, Any]]] = self.context.get("reactions") or {}
        return summaries.get(message.pk, [])

    @extend_schema_field(UserSummarySerializer(many=True))
    def get_mentions(self, message: Message) -> list[dict[str, Any]]:
        users = [m.user for m in message.mentions.all() if m.user is not None]
        return list(UserSummarySerializer(users, many=True).data)

    @extend_schema_field(PollSummarySerializer(allow_null=True))
    def get_poll(self, message: Message) -> dict[str, Any] | None:
        polls: dict[Any, dict[str, Any]] = self.context.get("polls") or {}
        return polls.get(message.pk)

    @extend_schema_field(MentionRoleSerializer(many=True))
    def get_mention_roles(self, message: Message) -> list[dict[str, Any]]:
        return [
            {"id": str(m.role.pk), "name": m.role.name, "color": m.role.color}
            for m in message.mentions.all()
            if m.role is not None
        ]


class MessagePageSerializer(serializers.Serializer[dict[str, Any]]):
    results = MessageSerializer(many=True)
    has_more = serializers.BooleanField()


def _clean_content(value: str) -> str:
    return value.strip("\n")


class AttachmentRefSerializer(serializers.Serializer[dict[str, Any]]):
    public_id = serializers.CharField(
        max_length=255, help_text="From POST /media/sign (purpose=attachment), uploaded."
    )
    filename = serializers.CharField(max_length=255, help_text="The original file name.")


class PollCreateSerializer(serializers.Serializer[dict[str, Any]]):
    question = serializers.CharField(max_length=300)
    options = serializers.ListField(
        child=serializers.CharField(max_length=100), min_length=2, max_length=10
    )
    allow_multiple = serializers.BooleanField(default=False)
    duration_minutes = serializers.IntegerField(
        min_value=1,
        max_value=7 * 24 * 60,
        required=False,
        allow_null=True,
        help_text="Closes automatically after this long (max 7 days). Omit to keep it open.",
    )


class MessageWriteSerializer(serializers.Serializer[dict[str, Any]]):
    content = serializers.CharField(
        max_length=MAX_MESSAGE_LENGTH, trim_whitespace=False, allow_blank=True, default=""
    )
    nonce = serializers.CharField(max_length=64, required=False, allow_blank=True, allow_null=True)
    reply_to = serializers.UUIDField(required=False, allow_null=True)
    poll = PollCreateSerializer(required=False, allow_null=True)
    attachments = AttachmentRefSerializer(many=True, required=False, max_length=MAX_ATTACHMENTS)  # type: ignore[call-arg]  # DRF supports it; stubs lag

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        content = _clean_content(attrs.get("content", ""))
        if not content.strip() and not attrs.get("attachments") and not attrs.get("poll"):
            raise serializers.ValidationError({"content": ["Message can't be empty."]})
        attrs["content"] = content
        return attrs


class MessageEditSerializer(serializers.Serializer[dict[str, Any]]):
    content = serializers.CharField(max_length=MAX_MESSAGE_LENGTH, trim_whitespace=False)

    def validate_content(self, value: str) -> str:
        if not value.strip():
            raise serializers.ValidationError("Message can't be empty. Delete it instead.")
        return _clean_content(value)


class MessageQuerySerializer(serializers.Serializer[dict[str, Any]]):
    before = serializers.UUIDField(required=False)
    after = serializers.UUIDField(required=False)
    limit = serializers.IntegerField(min_value=1, max_value=100, default=50)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if attrs.get("before") and attrs.get("after"):
            raise serializers.ValidationError("Use either before or after, not both.")
        return attrs


class SearchQuerySerializer(serializers.Serializer[dict[str, Any]]):
    q = serializers.CharField(required=False, allow_blank=True, max_length=200, default="")
    author = serializers.UUIDField(required=False, help_text="Only messages from this user.")
    channel = serializers.UUIDField(required=False, help_text="Server search only.")
    has = serializers.ChoiceField(
        choices=["attachment", "image", "file"], required=False, help_text="Attachment filter."
    )
    before = serializers.DateField(required=False, help_text="Sent before this date.")
    after = serializers.DateField(required=False, help_text="Sent after this date.")
    cursor = serializers.UUIDField(required=False, help_text="`next_cursor` from the last page.")
    limit = serializers.IntegerField(min_value=1, max_value=50, default=25)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        filters = ("author", "channel", "has", "before", "after")
        if not attrs.get("q", "").strip() and not any(attrs.get(f) for f in filters):
            raise serializers.ValidationError({"q": ["Enter something to search for."]})
        return attrs


class SearchResultPageSerializer(serializers.Serializer[dict[str, Any]]):
    results = MessageSerializer(many=True)
    total = serializers.IntegerField()
    next_cursor = serializers.UUIDField(allow_null=True)


class ReactionUsersSerializer(serializers.Serializer[dict[str, Any]]):
    emoji = serializers.CharField()
    users = UserSummarySerializer(many=True)


# ---------------------------------------------------------------------------- DMs


class DMRecipientSerializer(UserSummarySerializer):
    presence = serializers.ChoiceField(choices=["online", "idle", "dnd", "offline"])

    class Meta(UserSummarySerializer.Meta):
        fields = [*UserSummarySerializer.Meta.fields, "presence"]
        read_only_fields = fields


class DMConversationSerializer(serializers.Serializer[Any]):
    """Context: ``participants`` ({dm_id: [User]}), ``me`` (DMParticipant by dm id)."""

    id = serializers.UUIDField()
    is_group = serializers.BooleanField()
    name = serializers.CharField()
    owner_id = serializers.UUIDField(allow_null=True)
    last_message_id = serializers.UUIDField(allow_null=True)
    recipients = serializers.SerializerMethodField(help_text="Everyone except you.")
    last_read_message_id = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()

    @extend_schema_field(DMRecipientSerializer(many=True))
    def get_recipients(self, conversation: Any) -> list[dict[str, Any]]:
        users = self.context["participants"].get(conversation.pk, [])
        me = self.context["user"]
        presence: dict[str, str] = self.context.get("presence") or {}
        return [
            {**UserSummarySerializer(u).data, "presence": presence.get(str(u.pk), "offline")}
            for u in users
            if u.pk != me.pk
        ]

    @extend_schema_field(serializers.UUIDField(allow_null=True))
    def get_last_read_message_id(self, conversation: Any) -> str | None:
        mine = self.context["me"].get(conversation.pk)
        return str(mine.last_read_message_id) if mine and mine.last_read_message_id else None

    @extend_schema_field(serializers.IntegerField())
    def get_unread_count(self, conversation: Any) -> int:
        mine = self.context["me"].get(conversation.pk)
        return mine.unread_count if mine else 0


class DMCreateSerializer(serializers.Serializer[dict[str, Any]]):
    user_ids = serializers.ListField(
        child=serializers.UUIDField(),
        min_length=1,
        max_length=MAX_GROUP_DM_SIZE - 1,
        help_text="One user opens (or reuses) a 1:1 DM; more create a group DM.",
    )
    name = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")


class DMUpdateSerializer(serializers.Serializer[dict[str, Any]]):
    name = serializers.CharField(max_length=100, required=False, allow_blank=True)
    closed = serializers.BooleanField(required=False, help_text="Hide it from your sidebar.")


class DMAddParticipantsSerializer(serializers.Serializer[dict[str, Any]]):
    user_ids = serializers.ListField(
        child=serializers.UUIDField(), min_length=1, max_length=MAX_GROUP_DM_SIZE - 1
    )


class DMAckRequestSerializer(serializers.Serializer[dict[str, Any]]):
    message_id = serializers.UUIDField()
