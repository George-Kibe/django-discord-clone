from django.conf import settings
from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVector, SearchVectorField
from django.db import models
from django.db.models import Q

from apps.chat_channels.models import Channel
from apps.core.models import BaseModel

MAX_MESSAGE_LENGTH = 4000
MAX_ATTACHMENTS = 5
MAX_GROUP_DM_SIZE = 10


class DMConversation(BaseModel):
    """A 1:1 or group direct-message conversation (FR-DM-01/02)."""

    is_group = models.BooleanField(default=False)
    name = models.CharField(max_length=100, blank=True)  # groups only
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="owned_dms",
    )
    # 1:1 only: "<smaller user id>:<larger user id>", so a pair can never get two conversations.
    dm_key = models.CharField(max_length=80, null=True, blank=True, unique=True)
    last_message_id = models.UUIDField(null=True, blank=True)

    def __str__(self) -> str:
        return self.name or str(self.pk)


class DMParticipant(models.Model):
    """Membership plus the participant's own state: hidden from the sidebar, read marker."""

    conversation = models.ForeignKey(
        DMConversation, on_delete=models.CASCADE, related_name="participants"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="dm_participations"
    )
    joined_at = models.DateTimeField(auto_now_add=True)
    closed = models.BooleanField(default=False)
    last_read_message_id = models.UUIDField(null=True, blank=True)
    unread_count = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["conversation", "user"], name="unique_dm_participant")
        ]

    def __str__(self) -> str:
        return f"{self.user_id} in {self.conversation_id}"


class Message(BaseModel):
    """A channel or DM message. The UUIDv7 id is time-ordered and doubles as the cursor."""

    class Type(models.TextChoices):
        DEFAULT = "default", "Default"
        REPLY = "reply", "Reply"
        SYSTEM = "system", "System"

    channel = models.ForeignKey(
        Channel, null=True, blank=True, on_delete=models.CASCADE, related_name="messages"
    )
    dm = models.ForeignKey(
        DMConversation, null=True, blank=True, on_delete=models.CASCADE, related_name="messages"
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="messages"
    )
    type = models.CharField(max_length=16, choices=Type.choices, default=Type.DEFAULT)
    content = models.TextField(max_length=MAX_MESSAGE_LENGTH, blank=True)
    reply_to = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="replies"
    )
    # Client idempotency key. NULL (not "") when absent: the unique constraint skips NULLs.
    nonce = models.CharField(max_length=64, null=True, blank=True)  # noqa: DJ001
    edited_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    pinned_at = models.DateTimeField(null=True, blank=True)
    mention_everyone = models.BooleanField(default=False)
    search_vector = models.GeneratedField(
        expression=SearchVector("content", config="simple"),
        output_field=SearchVectorField(),
        db_persist=True,
    )

    class Meta:
        ordering = ["-id"]
        indexes = [
            models.Index(fields=["channel", "-id"], name="message_channel_history"),
            models.Index(fields=["dm", "-id"], name="message_dm_history"),
            models.Index(fields=["author", "id"], name="message_author"),
            GinIndex(fields=["search_vector"], name="message_search"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["author", "nonce"],
                condition=Q(nonce__isnull=False),
                name="unique_author_nonce",
            ),
            models.CheckConstraint(
                condition=Q(channel__isnull=False, dm__isnull=True)
                | Q(channel__isnull=True, dm__isnull=False),
                name="message_in_channel_xor_dm",
            ),
        ]

    def __str__(self) -> str:
        return self.content[:50]


class Attachment(BaseModel):
    """A file uploaded straight to Cloudinary and attached to a message (FR-MSG-10)."""

    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="attachments")
    public_id = models.CharField(max_length=255, unique=True)
    resource_type = models.CharField(max_length=8)  # image | raw
    filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100, blank=True)
    size_bytes = models.PositiveIntegerField()
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return self.filename


class Reaction(models.Model):
    """One user's emoji on a message (FR-MSG-09). Counts are aggregated per emoji."""

    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reactions"
    )
    emoji = models.CharField(max_length=32)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["message", "user", "emoji"], name="unique_reaction")
        ]
        indexes = [models.Index(fields=["message", "emoji"], name="reaction_message_emoji")]

    def __str__(self) -> str:
        return self.emoji


class Mention(models.Model):
    """A user or role mentioned in a message (FR-MSG-08). Drives notifications and badges."""

    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="mentions")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="mentions",
    )
    role = models.ForeignKey(
        "servers.Role", null=True, blank=True, on_delete=models.CASCADE, related_name="mentions"
    )

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(user__isnull=False, role__isnull=True)
                | Q(user__isnull=True, role__isnull=False),
                name="mention_user_xor_role",
            )
        ]

    def __str__(self) -> str:
        return f"{self.user_id or self.role_id}"
