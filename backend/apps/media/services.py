"""Cloudinary integration: signed direct uploads, verification, URLs, deletion (ADR-010)."""

import logging
import time
import uuid
from typing import Any

import cloudinary
import cloudinary.api
import cloudinary.exceptions
import cloudinary.uploader
import cloudinary.utils
from django.conf import settings
from rest_framework import exceptions

from apps.accounts.models import User

from .models import PendingUpload

logger = logging.getLogger(__name__)


class MediaNotConfigured(exceptions.APIException):
    status_code = 503
    default_detail = "File uploads are not configured."
    default_code = "media_not_configured"


def is_configured() -> bool:
    config = cloudinary.config()
    return bool(config.cloud_name and config.api_key and config.api_secret)


def _require_configured() -> Any:
    if not is_configured():
        raise MediaNotConfigured()
    return cloudinary.config()


def _rules(purpose: str) -> dict[str, Any]:
    rules: dict[str, Any] | None = settings.MEDIA_UPLOAD_RULES.get(purpose)
    if rules is None:
        raise exceptions.ValidationError({"purpose": ["Unknown upload purpose."]})
    return rules


def _extension(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def sign_upload(*, user: User, purpose: str, filename: str, size: int) -> dict[str, Any]:
    """Validate the declared file and return signed params for a browser -> Cloudinary upload."""
    config = _require_configured()
    rules = _rules(purpose)
    if size > rules["max_bytes"]:
        raise exceptions.ValidationError(
            {"size": [f"File is too large (max {rules['max_bytes'] // (1024 * 1024)} MB)."]},
            code="file_too_large",
        )
    if _extension(filename) not in rules["formats"]:
        raise exceptions.ValidationError(
            {"filename": [f"Allowed formats: {', '.join(rules['formats'])}."]},
            code="invalid_format",
        )

    public_id = f"{settings.CLOUDINARY_FOLDER_PREFIX}/{purpose}s/{user.pk}/{uuid.uuid4().hex}"
    params: dict[str, Any] = {
        "public_id": public_id,
        "timestamp": int(time.time()),
        "allowed_formats": ",".join(rules["formats"]),
        "overwrite": "false",
    }
    signature = cloudinary.utils.api_sign_request(params, config.api_secret)
    PendingUpload.objects.create(user=user, public_id=public_id, purpose=purpose)
    return {
        "upload_url": f"https://api.cloudinary.com/v1_1/{config.cloud_name}/image/upload",
        "api_key": config.api_key,
        "signature": signature,
        **params,
    }


def claim_upload(*, user: User, public_id: str, purpose: str) -> dict[str, Any]:
    """Confirm an upload belongs to the user, exists in Cloudinary and respects the limits.

    Returns Cloudinary's resource metadata. Removes the PendingUpload marker on success.
    """
    _require_configured()
    rules = _rules(purpose)
    pending = PendingUpload.objects.filter(user=user, public_id=public_id, purpose=purpose).first()
    if pending is None:
        raise exceptions.ValidationError({"public_id": ["Unknown upload."]}, code="unknown_upload")
    try:
        resource: dict[str, Any] = cloudinary.api.resource(public_id, resource_type="image")
    except cloudinary.exceptions.NotFound:
        raise exceptions.ValidationError(
            {"public_id": ["Upload not found. Please upload the file again."]},
            code="upload_missing",
        ) from None

    if (
        resource.get("bytes", 0) > rules["max_bytes"]
        or resource.get("format") not in rules["formats"]
    ):
        delete_asset(public_id)
        pending.delete()
        raise exceptions.ValidationError(
            {"public_id": ["The uploaded file is not allowed."]}, code="upload_rejected"
        )
    pending.delete()
    return resource


def delete_asset(public_id: str) -> None:
    if not public_id:
        return
    if not is_configured():
        logger.warning("Cloudinary not configured; asset %s was NOT deleted", public_id)
        return
    cloudinary.uploader.destroy(public_id, invalidate=True, resource_type="image")


def image_url(public_id: str, *, size: int) -> str | None:
    """Square, auto-format/quality transformation URL (built locally, no API call)."""
    if not public_id or not cloudinary.config().cloud_name:
        return None
    url, _ = cloudinary.utils.cloudinary_url(
        public_id,
        secure=True,
        transformation=[
            {"width": size, "height": size, "crop": "fill", "gravity": "face"},
            {"fetch_format": "auto", "quality": "auto"},
        ],
    )
    return str(url)
