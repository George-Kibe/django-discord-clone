from django.conf import settings
from django.db import models
from django.db.models import Q

from apps.core.models import UUIDModel


class ExportJob(UUIDModel):
    """A PDF transcript export (FR-EXP-01..03). The file lives on the exports volume for
    EXPORT_TTL_HOURS and is downloaded through a signed, short-lived link."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        DONE = "done", "Done"
        FAILED = "failed", "Failed"
        EXPIRED = "expired", "Expired"

    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="exports"
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
    date_from = models.DateField(null=True, blank=True)
    date_to = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    file_name = models.CharField(max_length=255, blank=True)  # relative to EXPORT_ROOT
    message_count = models.PositiveIntegerField(default=0)
    error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=Q(channel__isnull=False, dm__isnull=True)
                | Q(channel__isnull=True, dm__isnull=False),
                name="export_channel_xor_dm",
            )
        ]

    def __str__(self) -> str:
        return f"export {self.pk} ({self.status})"
