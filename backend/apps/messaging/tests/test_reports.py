"""Message reports (FR-MOD-03)."""

import pytest
from django.urls import reverse

from apps.chat_channels.models import Channel
from apps.messaging.models import MessageReport

pytestmark = pytest.mark.django_db


def test_report_a_message(client_for, user, make_user, server, join):
    channel = Channel.objects.get(server=server, name="general")
    reporter = make_user()
    join(server, reporter)
    message = (
        client_for(user)
        .post(
            reverse("channel-messages", args=[channel.pk]), {"content": "bad stuff"}, format="json"
        )
        .json()
    )
    url = reverse("message-report", args=[message["id"]])
    assert client_for(reporter).post(url, {"reason": "spam"}, format="json").status_code == 201
    report = MessageReport.objects.get()
    assert report.content_snapshot == "bad stuff" and report.status == "open"
    assert client_for(reporter).post(url, {"reason": "again"}, format="json").status_code == 400
    assert client_for(user).post(url, {"reason": "me"}, format="json").status_code == 400  # own
    assert client_for(make_user()).post(url, {"reason": "x"}, format="json").status_code == 404
