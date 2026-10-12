import secrets
import string

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.core.models import BaseModel

INVITE_ALPHABET = string.ascii_letters + string.digits


def generate_invite_code() -> str:
    return "".join(secrets.choice(INVITE_ALPHABET) for _ in range(8))


class Topic(models.Model):
    """Server topics for discovery (FR-SRV-07/08). Seeded by a data migration, managed by staff."""

    name = models.CharField(max_length=50, unique=True)
    slug = models.SlugField(max_length=50, unique=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class Server(BaseModel):
    name = models.CharField(max_length=100)
    description = models.TextField(max_length=1000, blank=True)
    icon_public_id = models.CharField(max_length=255, blank=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="owned_servers"
    )
    topic = models.ForeignKey(
        Topic, null=True, blank=True, on_delete=models.SET_NULL, related_name="servers"
    )
    is_public = models.BooleanField(default=False)
    member_count = models.PositiveIntegerField(default=0)  # denormalized, kept by services

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class Role(BaseModel):
    server = models.ForeignKey(Server, on_delete=models.CASCADE, related_name="roles")
    name = models.CharField(max_length=100)
    color = models.PositiveIntegerField(default=0)  # 0xRRGGBB, 0 = default colour
    position = models.PositiveIntegerField(default=0)  # higher = more senior; @everyone = 0
    permissions = models.BigIntegerField(default=0)
    is_default = models.BooleanField(default=False)  # @everyone
    mentionable = models.BooleanField(default=False)
    hoist = models.BooleanField(default=False)

    class Meta:
        ordering = ["-position", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["server"], condition=Q(is_default=True), name="one_default_role_per_server"
            ),
        ]

    def __str__(self) -> str:
        return self.name


class Member(BaseModel):
    server = models.ForeignKey(Server, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships"
    )
    nickname = models.CharField(max_length=32, blank=True)
    roles = models.ManyToManyField(Role, blank=True, related_name="members")
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["joined_at"]
        constraints = [
            models.UniqueConstraint(fields=["server", "user"], name="unique_server_member"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} in {self.server_id}"


class Invite(models.Model):
    code = models.CharField(max_length=10, primary_key=True, default=generate_invite_code)
    server = models.ForeignKey(Server, on_delete=models.CASCADE, related_name="invites")
    channel = models.ForeignKey(
        "chat_channels.Channel", null=True, blank=True, on_delete=models.SET_NULL
    )
    inviter = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="invites"
    )
    max_uses = models.PositiveIntegerField(null=True, blank=True)  # null = unlimited
    uses = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(null=True, blank=True)  # null = never
    revoked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.code

    @property
    def is_usable(self) -> bool:
        if self.revoked_at is not None:
            return False
        if self.expires_at is not None and self.expires_at <= timezone.now():
            return False
        return self.max_uses is None or self.uses < self.max_uses


class Ban(models.Model):
    """A banned user can't rejoin (invites, public join) until unbanned (FR-MOD-01)."""

    server = models.ForeignKey(Server, on_delete=models.CASCADE, related_name="bans")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="server_bans"
    )
    moderator = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    reason = models.CharField(max_length=512, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["server", "user"], name="unique_ban")]

    def __str__(self) -> str:
        return f"{self.user_id} banned from {self.server_id}"


class ServerAuditEvent(models.Model):
    """Moderation and configuration history of a server (FR-MOD-02)."""

    class Action(models.TextChoices):
        SERVER_UPDATE = "server.update", "Server updated"
        MEMBER_KICK = "member.kick", "Member kicked"
        MEMBER_BAN = "member.ban", "Member banned"
        MEMBER_UNBAN = "member.unban", "Member unbanned"
        MEMBER_UPDATE = "member.update", "Member roles or nickname changed"
        ROLE_CREATE = "role.create", "Role created"
        ROLE_UPDATE = "role.update", "Role updated"
        ROLE_DELETE = "role.delete", "Role deleted"
        CHANNEL_CREATE = "channel.create", "Channel created"
        CHANNEL_UPDATE = "channel.update", "Channel updated"
        CHANNEL_DELETE = "channel.delete", "Channel deleted"
        OVERWRITE_UPDATE = "overwrite.update", "Channel permissions changed"
        MESSAGE_DELETE = "message.delete", "Message deleted by a moderator"
        INVITE_CREATE = "invite.create", "Invite created"
        INVITE_REVOKE = "invite.revoke", "Invite revoked"

    server = models.ForeignKey(Server, on_delete=models.CASCADE, related_name="audit_events")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    action = models.CharField(max_length=32, choices=Action.choices)
    target_type = models.CharField(max_length=16, blank=True)  # user | role | channel | message
    target_id = models.CharField(max_length=64, blank=True)
    target_label = models.CharField(max_length=200, blank=True)  # name at the time
    changes = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-id"]
        indexes = [models.Index(fields=["server", "-id"], name="audit_server_recent")]

    def __str__(self) -> str:
        return f"{self.action} in {self.server_id}"
