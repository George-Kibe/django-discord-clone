from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.chat_channels.models import Channel
from apps.core.models import BaseModel

MAX_MESSAGE_LENGTH = 4000


class Message(BaseModel):
    """A channel message. The UUIDv7 id is time-ordered and doubles as the pagination cursor."""

    class Type(models.TextChoices):
        DEFAULT = "default", "Default"
        SYSTEM = "system", "System"

    channel = models.ForeignKey(Channel, on_delete=models.CASCADE, related_name="messages")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="messages"
    )
    type = models.CharField(max_length=16, choices=Type.choices, default=Type.DEFAULT)
    content = models.TextField(max_length=MAX_MESSAGE_LENGTH)
    # Client idempotency key. NULL (not "") when absent: the unique constraint skips NULLs.
    nonce = models.CharField(max_length=64, null=True, blank=True)  # noqa: DJ001
    edited_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-id"]
        indexes = [models.Index(fields=["channel", "-id"], name="message_channel_history")]
        constraints = [
            models.UniqueConstraint(
                fields=["author", "nonce"],
                condition=Q(nonce__isnull=False),
                name="unique_author_nonce",
            ),
        ]

    def __str__(self) -> str:
        return self.content[:50]
