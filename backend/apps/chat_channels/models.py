from django.db import models
from django.db.models import Q

from apps.core.models import BaseModel
from apps.servers.models import Member, Role, Server


class Category(BaseModel):
    server = models.ForeignKey(Server, on_delete=models.CASCADE, related_name="categories")
    name = models.CharField(max_length=100)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "created_at"]
        verbose_name_plural = "categories"

    def __str__(self) -> str:
        return self.name


class Channel(BaseModel):
    class Type(models.TextChoices):
        TEXT = "text", "Text"

    server = models.ForeignKey(Server, on_delete=models.CASCADE, related_name="channels")
    category = models.ForeignKey(
        Category, null=True, blank=True, on_delete=models.SET_NULL, related_name="channels"
    )
    type = models.CharField(max_length=16, choices=Type.choices, default=Type.TEXT)
    name = models.CharField(max_length=100)  # lowercase-hyphenated
    topic = models.CharField(max_length=1024, blank=True)
    position = models.PositiveIntegerField(default=0)
    slowmode_seconds = models.PositiveIntegerField(default=0)
    last_message_id = models.UUIDField(null=True, blank=True)  # for unread state (Phase 4)

    class Meta:
        ordering = ["position", "created_at"]

    def __str__(self) -> str:
        return f"#{self.name}"


class PermissionOverwrite(BaseModel):
    """Allow/deny bits for one role or one member in one channel (FR-ROLE-05)."""

    channel = models.ForeignKey(Channel, on_delete=models.CASCADE, related_name="overwrites")
    role = models.ForeignKey(Role, null=True, blank=True, on_delete=models.CASCADE)
    member = models.ForeignKey(Member, null=True, blank=True, on_delete=models.CASCADE)
    allow = models.BigIntegerField(default=0)
    deny = models.BigIntegerField(default=0)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=(Q(role__isnull=False) & Q(member__isnull=True))
                | (Q(role__isnull=True) & Q(member__isnull=False)),
                name="overwrite_exactly_one_target",
            ),
            models.UniqueConstraint(
                fields=["channel", "role"],
                condition=Q(role__isnull=False),
                name="unique_role_overwrite",
            ),
            models.UniqueConstraint(
                fields=["channel", "member"],
                condition=Q(member__isnull=False),
                name="unique_member_overwrite",
            ),
        ]

    def __str__(self) -> str:
        return f"overwrite {self.pk}"


class ReadState(models.Model):
    """Where a user stopped reading a channel (FR-CH-04).

    Unread means ``channel.last_message_id`` is newer than ``last_read_message_id``."""

    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="read_states")
    channel = models.ForeignKey(Channel, on_delete=models.CASCADE, related_name="read_states")
    last_read_message_id = models.UUIDField(null=True, blank=True)
    mention_count = models.PositiveIntegerField(default=0)  # filled by mentions in Phase 5
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "channel"], name="unique_read_state"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} read {self.channel_id} to {self.last_read_message_id}"
