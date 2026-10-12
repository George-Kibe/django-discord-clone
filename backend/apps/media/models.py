from django.conf import settings
from django.db import models

from apps.core.models import UUIDModel


class PendingUpload(UUIDModel):
    """A signed upload that hasn't been attached to anything yet (ADR-010).

    Rows are deleted once the asset is attached; leftovers older than
    PENDING_UPLOAD_TTL_HOURS are removed from Cloudinary by a daily task.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="pending_uploads"
    )
    public_id = models.CharField(max_length=255, unique=True)
    purpose = models.CharField(max_length=32)
    resource_type = models.CharField(max_length=8, default="image")  # Cloudinary: image | raw
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    def __str__(self) -> str:
        return self.public_id
