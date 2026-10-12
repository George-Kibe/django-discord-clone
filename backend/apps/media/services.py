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


def resource_type_for(purpose: str, filename: str) -> str:
    """Cloudinary resource type for a file: images get previews, other files are stored raw."""
    rules = _rules(purpose)
    extension = _extension(filename)
    if extension in rules["formats"]:
        return "image"
    if extension in rules.get("raw_formats", []):
        return "raw"
    allowed = [*rules["formats"], *rules.get("raw_formats", [])]
    raise exceptions.ValidationError(
        {"filename": [f"Allowed formats: {', '.join(allowed)}."]}, code="invalid_format"
    )


def sign_upload(*, user: User, purpose: str, filename: str, size: int) -> dict[str, Any]:
    """Validate the declared file and return signed params for a browser -> Cloudinary upload."""
    config = _require_configured()
    rules = _rules(purpose)
    if size > rules["max_bytes"]:
        raise exceptions.ValidationError(
            {"size": [f"File is too large (max {rules['max_bytes'] // (1024 * 1024)} MB)."]},
            code="file_too_large",
        )
    resource_type = resource_type_for(purpose, filename)

    public_id = f"{settings.CLOUDINARY_FOLDER_PREFIX}/{purpose}s/{user.pk}/{uuid.uuid4().hex}"
    params: dict[str, Any] = {"timestamp": int(time.time()), "overwrite": "false"}
    if resource_type == "image":
        params["allowed_formats"] = ",".join(rules["formats"])
    else:
        public_id = f"{public_id}.{_extension(filename)}"  # raw files keep their extension
    params["public_id"] = public_id
    signature = cloudinary.utils.api_sign_request(params, config.api_secret)
    PendingUpload.objects.create(
        user=user, public_id=public_id, purpose=purpose, resource_type=resource_type
    )
    return {
        "upload_url": f"https://api.cloudinary.com/v1_1/{config.cloud_name}/{resource_type}/upload",
        "api_key": config.api_key,
        "signature": signature,
        "resource_type": resource_type,
        **params,
    }


def claim_upload(*, user: User, public_id: str, purpose: str) -> dict[str, Any]:
    """Confirm an upload belongs to the user, exists in Cloudinary and respects the limits.

    Returns Cloudinary's resource metadata (plus ``resource_type``). Removes the PendingUpload
    marker on success.
    """
    _require_configured()
    rules = _rules(purpose)
    pending = PendingUpload.objects.filter(user=user, public_id=public_id, purpose=purpose).first()
    if pending is None:
        raise exceptions.ValidationError({"public_id": ["Unknown upload."]}, code="unknown_upload")
    resource_type = pending.resource_type
    try:
        resource: dict[str, Any] = cloudinary.api.resource(public_id, resource_type=resource_type)
    except cloudinary.exceptions.NotFound:
        raise exceptions.ValidationError(
            {"public_id": ["Upload not found. Please upload the file again."]},
            code="upload_missing",
        ) from None

    allowed_format = resource_type == "raw" or resource.get("format") in rules["formats"]
    if resource.get("bytes", 0) > rules["max_bytes"] or not allowed_format:
        delete_asset(public_id, resource_type)
        pending.delete()
        raise exceptions.ValidationError(
            {"public_id": ["The uploaded file is not allowed."]}, code="upload_rejected"
        )
    pending.delete()
    return {**resource, "resource_type": resource_type}


def delete_asset(public_id: str, resource_type: str = "image") -> None:
    if not public_id:
        return
    if not is_configured():
        logger.warning("Cloudinary not configured; asset %s was NOT deleted", public_id)
        return
    cloudinary.uploader.destroy(public_id, invalidate=True, resource_type=resource_type)


def attachment_urls(public_id: str, resource_type: str, filename: str) -> dict[str, str | None]:
    """Original URL plus, for images, a bounded preview (built locally, no API call)."""
    if not public_id or not cloudinary.config().cloud_name:
        return {"url": None, "preview_url": None}
    url, _ = cloudinary.utils.cloudinary_url(public_id, secure=True, resource_type=resource_type)
    if resource_type != "image":
        return {"url": str(url), "preview_url": None}
    preview, _ = cloudinary.utils.cloudinary_url(
        public_id,
        secure=True,
        transformation=[
            {"width": 800, "height": 600, "crop": "limit"},
            {"fetch_format": "auto", "quality": "auto"},
        ],
    )
    return {"url": str(url), "preview_url": str(preview)}


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
