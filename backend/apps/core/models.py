import uuid

from django.db import models


class UUIDModel(models.Model):
    """Time-ordered UUIDv7 primary key (ADR-011)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid7, editable=False)

    class Meta:
        abstract = True


class TimestampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class BaseModel(UUIDModel, TimestampedModel):
    """Default base for domain models: UUIDv7 PK + created/updated timestamps."""

    class Meta:
        abstract = True
