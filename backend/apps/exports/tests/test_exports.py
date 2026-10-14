"""PDF transcript exports (FR-EXP-01..03)."""

from datetime import timedelta

import pytest
from django.core import signing
from django.urls import reverse
from django.utils import timezone

from apps.chat_channels.models import Channel
from apps.exports.models import ExportJob
from apps.exports.tasks import delete_expired
from apps.notifications.models import Notification

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def export_root(settings, tmp_path):
    settings.EXPORT_ROOT = str(tmp_path)
    return tmp_path


@pytest.fixture
def channel(server):
    return Channel.objects.get(server=server, name="general")


@pytest.fixture
def member(make_user, server, join):
    user = make_user(username="member")
    join(server, user)
    return user


def start(client, **body):
    return client.post(reverse("exports"), body, format="json")


def test_export_channel_end_to_end(
    client_for, user, member, channel, export_root, django_capture_on_commit_callbacks
):
    for text in ("first message", f"hello <@{member.pk}> 👋", "third"):
        client_for(user).post(
            reverse("channel-messages", args=[channel.pk]), {"content": text}, format="json"
        )
    with django_capture_on_commit_callbacks(execute=True):
        response = start(client_for(user), channel_id=str(channel.pk))
    assert response.status_code == 202, response.content
    job = ExportJob.objects.get(pk=response.json()["id"])
    assert job.status == "done" and job.message_count == 3
    pdf = (export_root / job.file_name).read_bytes()
    assert pdf.startswith(b"%PDF")

    note = Notification.objects.get(user=user, type="export_ready")
    assert note.data["export_id"] == str(job.pk) and note.data["channel_name"] == "general"

    detail = client_for(user).get(reverse("export", args=[job.pk])).json()
    assert detail["status"] == "done" and detail["download_url"]
    download = client_for(user).get(detail["download_url"])
    assert download.status_code == 200
    assert download["Content-Type"] == "application/pdf"
    assert b"".join(download.streaming_content).startswith(b"%PDF")


def test_download_links_are_personal_and_expire(
    client_for, user, member, channel, settings, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        job_id = start(client_for(user), channel_id=str(channel.pk)).json()["id"]
    url = client_for(user).get(reverse("export", args=[job_id])).json()["download_url"]
    assert client_for(member).get(url).status_code in (403, 404)
    assert client_for(user).get(url.split("?")[0] + "?token=forged").status_code == 403
    settings.EXPORT_LINK_MAX_AGE = -1
    expired = client_for(user).get(url)
    assert expired.status_code == 403 and expired.json()["code"] == "link_expired"


def test_channel_exports_need_permission(client_for, member, channel):
    assert start(client_for(member), channel_id=str(channel.pk)).status_code == 403


def test_dm_participants_can_export(client_for, user, member, django_capture_on_commit_callbacks):
    dm = client_for(user).post(reverse("dms"), {"user_ids": [str(member.pk)]}, format="json").json()
    client_for(user).post(reverse("dm-messages", args=[dm["id"]]), {"content": "hi"}, format="json")
    with django_capture_on_commit_callbacks(execute=True):
        response = start(client_for(member), dm_id=dm["id"])
    assert response.status_code == 202
    assert ExportJob.objects.get(pk=response.json()["id"]).message_count == 1


def test_date_range_and_validation(client_for, user, channel, django_capture_on_commit_callbacks):
    client_for(user).post(
        reverse("channel-messages", args=[channel.pk]), {"content": "today"}, format="json"
    )
    tomorrow = (timezone.now() + timedelta(days=1)).date().isoformat()
    with django_capture_on_commit_callbacks(execute=True):
        job_id = start(client_for(user), channel_id=str(channel.pk), date_from=tomorrow).json()[
            "id"
        ]
    assert ExportJob.objects.get(pk=job_id).message_count == 0
    today = timezone.now().date().isoformat()
    bad = start(client_for(user), channel_id=str(channel.pk), date_from=tomorrow, date_to=today)
    assert bad.status_code == 400
    assert start(client_for(user)).status_code == 400  # neither channel nor DM


def test_expired_files_are_deleted(
    client_for, user, channel, export_root, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        job_id = start(client_for(user), channel_id=str(channel.pk)).json()["id"]
    job = ExportJob.objects.get(pk=job_id)
    ExportJob.objects.filter(pk=job_id).update(expires_at=timezone.now() - timedelta(minutes=1))
    assert delete_expired() == 1
    assert not (export_root / job.file_name).exists()
    assert ExportJob.objects.get(pk=job_id).status == "expired"
    token = signing.dumps({"export": job_id, "user": str(user.pk)}, salt="exports.download")
    gone = client_for(user).get(reverse("export-download", args=[job_id]) + f"?token={token}")
    assert gone.status_code == 404


def test_manage_messages_is_enough_to_export(client_for, member, server, channel):
    """FR-EXP-01 names Manage Messages; Export Transcripts alone also works."""
    from apps.core.permissions import Perm
    from apps.servers.models import Role

    role = Role.objects.create(
        server=server, name="Janitor", position=1, permissions=int(Perm.MANAGE_MESSAGES)
    )
    member.memberships.get(server=server).roles.add(role)
    assert start(client_for(member), channel_id=str(channel.pk)).status_code == 202
