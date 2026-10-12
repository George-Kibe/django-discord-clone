from typing import TYPE_CHECKING, Any, ClassVar

from django.contrib.auth.models import AbstractUser, UserManager
from django.core.validators import RegexValidator
from django.db import models

from apps.core.models import UUIDModel

username_validator = RegexValidator(
    regex=r"^[a-z0-9_.]{2,32}$",
    message="Usernames are 2-32 characters: lowercase letters, digits, underscores and dots.",
)


if TYPE_CHECKING:
    _UserManagerBase = UserManager["User"]
else:  # Django managers are not subscriptable at runtime.
    _UserManagerBase = UserManager


class AccountManager(_UserManagerBase):
    """Email is the login identifier; email and username are stored lowercased."""

    def _create_user_object(
        self, username: str, email: str | None, password: str | None, **extra_fields: Any
    ) -> User:
        if not email:
            raise ValueError("Users must have an email address.")
        email = self.normalize_email(email).lower()
        return super()._create_user_object(  # type: ignore[misc,no-any-return]  # not in stubs
            username.lower(), email, password, **extra_fields
        )

    def create_user(  # type: ignore[override]
        self, email: str, username: str, password: str | None = None, **extra_fields: Any
    ) -> User:
        return super().create_user(username, email, password, **extra_fields)

    def create_superuser(  # type: ignore[override]
        self, email: str, username: str, password: str | None = None, **extra_fields: Any
    ) -> User:
        return super().create_superuser(username, email, password, **extra_fields)

    def get_by_natural_key(self, username: str | None) -> User:
        return self.get(email__iexact=username)


class User(UUIDModel, AbstractUser):
    class Status(models.TextChoices):
        ONLINE = "online", "Online"
        IDLE = "idle", "Idle"
        DND = "dnd", "Do not disturb"
        INVISIBLE = "invisible", "Invisible"

    # AbstractUser's first/last name are replaced by a single display name.
    first_name = None  # type: ignore[assignment]
    last_name = None  # type: ignore[assignment]

    email = models.EmailField("email address", unique=True)
    username = models.CharField(
        max_length=32,
        unique=True,
        validators=[username_validator],
        error_messages={"unique": "That username is taken."},
    )
    display_name = models.CharField(max_length=64, blank=True)
    bio = models.TextField(max_length=500, blank=True)
    avatar_public_id = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ONLINE)
    email_verified_at = models.DateTimeField(null=True, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)

    USERNAME_FIELD = "email"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS: ClassVar[list[str]] = ["username"]

    objects: ClassVar[AccountManager] = AccountManager()

    class Meta:
        ordering = ["username"]

    def __str__(self) -> str:
        return self.username

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.email = self.email.lower()
        self.username = self.username.lower()
        super().save(*args, **kwargs)

    def get_full_name(self) -> str:
        return self.display_name or self.username

    def get_short_name(self) -> str:
        return self.display_name or self.username

    @property
    def is_email_verified(self) -> bool:
        return self.email_verified_at is not None


class AuthAuditEvent(models.Model):
    """Security-relevant authentication events (FR-AUTH-08). Pruned after 90 days."""

    class Event(models.TextChoices):
        REGISTERED = "registered", "Registered"
        EMAIL_VERIFIED = "email_verified", "Email verified"
        LOGIN = "login", "Logged in"
        LOGIN_FAILED = "login_failed", "Login failed"
        LOGOUT = "logout", "Logged out"
        PASSWORD_CHANGED = "password_changed", "Password changed"
        PASSWORD_RESET = "password_reset", "Password reset"
        EMAIL_CHANGED = "email_changed", "Email changed"
        TOKEN_REFRESH_REUSE = "token_refresh_reuse", "Refresh token reuse detected"

    id = models.BigAutoField(primary_key=True)
    user = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="auth_events"
    )
    email_attempted = models.CharField(max_length=254, blank=True)
    event = models.CharField(max_length=32, choices=Event.choices)
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=512, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "created_at"]),
            models.Index(fields=["ip", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.get_event_display()} ({self.email_attempted or self.user_id})"


class BlockedUser(models.Model):
    """``blocker`` no longer receives DMs from ``blocked`` and sees their messages collapsed
    (FR-DM-04)."""

    blocker = models.ForeignKey(User, on_delete=models.CASCADE, related_name="blocks")
    blocked = models.ForeignKey(User, on_delete=models.CASCADE, related_name="blocked_by")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["blocker", "blocked"], name="unique_block"),
            models.CheckConstraint(
                condition=~models.Q(blocker=models.F("blocked")), name="no_self_block"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.blocker_id} blocks {self.blocked_id}"
