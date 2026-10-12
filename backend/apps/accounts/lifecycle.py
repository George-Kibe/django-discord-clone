"""Account deletion and personal data export (FR-AUTH-09, NFR-PRIV-02)."""

from typing import Any

from django.db import transaction
from django.http import HttpRequest
from django.utils import timezone
from rest_framework import exceptions

from apps.media.tasks import delete_asset
from apps.realtime import notify

from . import audit, tokens
from .models import AuthAuditEvent, User


@transaction.atomic
def delete_account(user: User, password: str, request: HttpRequest) -> None:
    """Messages stay, shown as "Deleted User" (author set to NULL). Owned servers must be
    transferred or deleted first, like Discord."""
    from apps.servers.models import Server

    if not user.check_password(password):
        raise exceptions.ValidationError(
            {"password": ["Incorrect password."]}, code="wrong_password"
        )
    owned = list(Server.objects.filter(owner=user).values_list("name", flat=True))
    if owned:
        raise exceptions.ValidationError(
            {
                "non_field_errors": [
                    "Transfer ownership of or delete your servers first: " + ", ".join(owned)
                ]
            },
            code="owns_servers",
        )
    email = user.email
    avatar = user.avatar_public_id
    user_id = user.pk
    tokens.revoke_all_refresh_tokens(user)
    notify.revoke_sockets(user_id)
    audit.record(AuthAuditEvent.Event.ACCOUNT_DELETED, request, email=email)
    _leave_servers(user)
    user.delete()
    if avatar:
        transaction.on_commit(lambda: delete_asset.delay(avatar))


def _leave_servers(user: User) -> None:
    """Membership rows cascade; keep member counts and other members' lists in sync."""
    from django.db.models import F

    from apps.realtime import events
    from apps.servers.models import Member, Server

    for server_id in Member.objects.filter(user=user).values_list("server_id", flat=True):
        Server.objects.filter(pk=server_id).update(member_count=F("member_count") - 1)
        events.publish(
            events.server_group(server_id),
            "member.left",
            {"server_id": str(server_id), "user_id": str(user.pk)},
        )


def export_data(user: User) -> dict[str, Any]:
    """Everything we hold about the user that they can take with them (JSON)."""
    from apps.messaging.models import DMParticipant, Message, Reaction
    from apps.polls.models import PollVote
    from apps.servers.models import Member

    messages = (
        Message.objects.filter(author=user, deleted_at__isnull=True)
        .select_related("channel__server")
        .prefetch_related("attachments")
        .order_by("id")
    )
    return {
        "exported_at": timezone.now(),
        "profile": {
            "id": user.pk,
            "email": user.email,
            "username": user.username,
            "display_name": user.display_name,
            "bio": user.bio,
            "status": user.status,
            "date_joined": user.date_joined,
            "email_verified_at": user.email_verified_at,
        },
        "servers": [
            {
                "id": m.server_id,
                "name": m.server.name,
                "nickname": m.nickname,
                "joined_at": m.joined_at,
                "roles": [r.name for r in m.roles.all()],
            }
            for m in Member.objects.filter(user=user)
            .select_related("server")
            .prefetch_related("roles")
        ],
        "direct_messages": [
            {"id": p.conversation_id, "is_group": p.conversation.is_group, "joined_at": p.joined_at}
            for p in DMParticipant.objects.filter(user=user).select_related("conversation")
        ],
        "messages": [
            {
                "id": m.pk,
                "created_at": m.created_at,
                "edited_at": m.edited_at,
                "server": m.channel.server.name if m.channel else None,
                "channel": m.channel.name if m.channel else None,
                "dm_id": m.dm_id,
                "content": m.content,
                "attachments": [a.filename for a in m.attachments.all()],
            }
            for m in messages.iterator(chunk_size=500)
        ],
        "reactions": list(
            Reaction.objects.filter(user=user).values("message_id", "emoji", "created_at")
        ),
        "poll_votes": list(
            PollVote.objects.filter(user=user).values("poll_id", "option__text", "created_at")
        ),
        "blocked_users": list(user.blocks.values_list("blocked__username", flat=True)),
    }
