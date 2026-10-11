"""Cloudinary signed uploads and avatars (FR-PROF-02, ADR-010, NFR-SEC-10)."""

from datetime import timedelta
from unittest import mock

import cloudinary
import cloudinary.exceptions
import cloudinary.utils
import pytest
from django.urls import reverse
from django.utils import timezone

from apps.media import tasks
from apps.media.models import PendingUpload

pytestmark = pytest.mark.django_db

SIGN = {"purpose": "avatar", "filename": "me.PNG", "size": 1024}


def sign(client, **overrides):
    return client.post(reverse("media-sign"), SIGN | overrides, format="json")


def test_sign_upload(auth_client, user, settings):
    response = sign(auth_client)
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["upload_url"] == "https://api.cloudinary.com/v1_1/test-cloud/image/upload"
    assert body["api_key"] == "123456"
    assert body["public_id"].startswith(f"{settings.CLOUDINARY_FOLDER_PREFIX}/avatars/{user.id}/")
    assert body["allowed_formats"] == "jpg,jpeg,png,webp,gif"
    params = {k: body[k] for k in ("public_id", "timestamp", "allowed_formats", "overwrite")}
    assert body["signature"] == cloudinary.utils.api_sign_request(params, "test-secret")
    assert "test-secret" not in response.content.decode()
    assert PendingUpload.objects.filter(user=user, public_id=body["public_id"]).exists()


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"size": 5 * 1024 * 1024 + 1}, "size"),
        ({"filename": "script.svg"}, "filename"),
        ({"filename": "noextension"}, "filename"),
        ({"purpose": "banner"}, "purpose"),
        ({"size": 0}, "size"),
    ],
)
def test_sign_upload_validation(auth_client, overrides, field):
    response = sign(auth_client, **overrides)
    assert response.status_code == 400
    assert field in response.json()["fields"]


def test_sign_requires_authentication(api_client):
    assert sign(api_client).status_code == 401


def test_sign_when_cloudinary_is_not_configured(auth_client):
    cloudinary.config().api_secret = None
    response = sign(auth_client)
    assert response.status_code == 503
    assert response.json()["code"] == "media_not_configured"


def test_sign_is_throttled(auth_client):
    for _ in range(30):
        assert sign(auth_client).status_code == 200
    assert sign(auth_client).status_code == 429


def _resource(public_id, **overrides):
    return {"public_id": public_id, "bytes": 2048, "format": "png", **overrides}


def test_set_avatar(auth_client, user):
    public_id = sign(auth_client).json()["public_id"]
    with mock.patch("cloudinary.api.resource", return_value=_resource(public_id)):
        response = auth_client.put(
            reverse("users-me-avatar"), {"public_id": public_id}, format="json"
        )
    assert response.status_code == 200, response.content
    url = response.json()["avatar_url"]
    assert url.startswith("https://res.cloudinary.com/test-cloud/image/upload/")
    assert "c_fill" in url and "w_256" in url and f"{public_id}" in url
    user.refresh_from_db()
    assert user.avatar_public_id == public_id
    assert not PendingUpload.objects.exists()


def test_replacing_avatar_deletes_previous_asset(auth_client, user):
    user.avatar_public_id = "test/avatars/old"
    user.save()
    public_id = sign(auth_client).json()["public_id"]
    with (
        mock.patch("cloudinary.api.resource", return_value=_resource(public_id)),
        mock.patch("cloudinary.uploader.destroy") as destroy,
    ):
        auth_client.put(reverse("users-me-avatar"), {"public_id": public_id}, format="json")
    destroy.assert_called_once_with("test/avatars/old", invalidate=True, resource_type="image")


def test_cannot_claim_someone_elses_upload(auth_client, api_client):
    from apps.accounts.tests.factories import UserFactory

    other = UserFactory.create()
    PendingUpload.objects.create(user=other, public_id="test/avatars/x/y", purpose="avatar")
    response = auth_client.put(
        reverse("users-me-avatar"), {"public_id": "test/avatars/x/y"}, format="json"
    )
    assert response.status_code == 400
    assert response.json()["code"] == "unknown_upload"


@pytest.mark.parametrize("bad", [{"bytes": 6 * 1024 * 1024}, {"format": "svg"}])
def test_uploads_violating_limits_are_rejected_and_deleted(auth_client, user, bad):
    public_id = sign(auth_client).json()["public_id"]
    with (
        mock.patch("cloudinary.api.resource", return_value=_resource(public_id, **bad)),
        mock.patch("cloudinary.uploader.destroy") as destroy,
    ):
        response = auth_client.put(
            reverse("users-me-avatar"), {"public_id": public_id}, format="json"
        )
    assert response.status_code == 400
    assert response.json()["code"] == "upload_rejected"
    destroy.assert_called_once()
    user.refresh_from_db()
    assert user.avatar_public_id == ""


def test_upload_that_never_reached_cloudinary(auth_client):
    public_id = sign(auth_client).json()["public_id"]
    with mock.patch("cloudinary.api.resource", side_effect=cloudinary.exceptions.NotFound("nope")):
        response = auth_client.put(
            reverse("users-me-avatar"), {"public_id": public_id}, format="json"
        )
    assert response.json()["code"] == "upload_missing"


def test_remove_avatar(auth_client, user):
    user.avatar_public_id = "test/avatars/current"
    user.save()
    with mock.patch("cloudinary.uploader.destroy") as destroy:
        response = auth_client.delete(reverse("users-me-avatar"))
    assert response.json()["avatar_url"] is None
    destroy.assert_called_once()


def test_cleanup_orphaned_uploads(user):
    old = PendingUpload.objects.create(user=user, public_id="test/a/old", purpose="avatar")
    PendingUpload.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(hours=25))
    PendingUpload.objects.create(user=user, public_id="test/a/new", purpose="avatar")
    with mock.patch("cloudinary.uploader.destroy") as destroy:
        assert tasks.cleanup_orphaned_uploads() == 1
    destroy.assert_called_once_with("test/a/old", invalidate=True, resource_type="image")
    assert list(PendingUpload.objects.values_list("public_id", flat=True)) == ["test/a/new"]


def test_image_url_without_cloud_name():
    from apps.media.services import image_url

    assert image_url("", size=64) is None
    cloudinary.config().cloud_name = None
    assert image_url("x", size=64) is None


def test_delete_asset_warns_loudly_when_not_configured(caplog):
    from apps.media.services import delete_asset

    cloudinary.config().api_secret = None
    with mock.patch("cloudinary.uploader.destroy") as destroy:
        delete_asset("test/avatars/x")
    destroy.assert_not_called()
    assert "was NOT deleted" in caplog.text
