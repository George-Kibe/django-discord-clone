from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import UUIDModel


class Notification(UUIDModel):
    """An inbox entry (FR-PRES-02). DM notifications are coalesced per conversation while
    unread, so a busy DM is one entry with a count."""

    class Type(models.TextChoices):
        MENTION = "mention", "Mention"
        REPLY = "reply", "Reply"
        DM = "dm", "Direct message"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )
    type = models.CharField(max_length=16, choices=Type.choices)
    message = models.ForeignKey(
        "messaging.Message", null=True, blank=True, on_delete=models.CASCADE, related_name="+"
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    data = models.JSONField(default=dict, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]
        indexes = [models.Index(fields=["user", "read_at", "-id"], name="notification_inbox")]

    def __str__(self) -> str:
        return f"{self.type} for {self.user_id}"


class MuteSetting(models.Model):
    """Mute a server, channel or DM (FR-PRES-04). ``muted_until`` NULL means until unmuted.

    Muted targets don't notify for @everyone/@role mentions or DMs; direct @mentions and replies
    still do. Clients also dim their unread markers.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="mute_settings"
    )
    server = models.ForeignKey(
        "servers.Server", null=True, blank=True, on_delete=models.CASCADE, related_name="+"
    )
    channel = models.ForeignKey(
        "chat_channels.Channel", null=True, blank=True, on_delete=models.CASCADE, related_name="+"
    )
    dm = models.ForeignKey(
        "messaging.DMConversation",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="+",
    )
    muted_until = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(server__isnull=False, channel__isnull=True, dm__isnull=True)
                | Q(server__isnull=True, channel__isnull=False, dm__isnull=True)
                | Q(server__isnull=True, channel__isnull=True, dm__isnull=False),
                name="mute_exactly_one_target",
            ),
            models.UniqueConstraint(
                fields=["user", "server"],
                condition=Q(server__isnull=False),
                name="unique_mute_server",
            ),
            models.UniqueConstraint(
                fields=["user", "channel"],
                condition=Q(channel__isnull=False),
                name="unique_mute_channel",
            ),
            models.UniqueConstraint(
                fields=["user", "dm"], condition=Q(dm__isnull=False), name="unique_mute_dm"
            ),
        ]

    def __str__(self) -> str:
        return f"mute {self.server_id or self.channel_id or self.dm_id}"
