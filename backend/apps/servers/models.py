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
