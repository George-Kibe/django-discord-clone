"""Where a message lives: a server channel or a DM conversation.

Every message endpoint resolves a ``Target`` first, so channels and DMs share one code path for
history, sending, reactions, pins, typing and search. Channel permissions come from the
permission engine; DM participants implicitly have every message permission (DATA_MODEL.md),
except that a block in a 1:1 DM stops sending and reacting (FR-DM-04).
"""

from dataclasses import dataclass
from typing import Any

from django.db.models import Q
from django.http import Http404
from rest_framework import exceptions

from apps.accounts.blocks import either_blocked
from apps.accounts.models import User
from apps.chat_channels.models import Channel
from apps.chat_channels.services import get_channel
from apps.core.permissions import ALL, Perm
from apps.realtime import events
from apps.servers.access import ServerAccess, get_access

from .models import DMConversation, DMParticipant, Message

DM_BLOCKED_PERMS = Perm.SEND_MESSAGES | Perm.ADD_REACTIONS | Perm.ATTACH_FILES


@dataclass
class Target:
    user: User
    perms: Perm
    channel: Channel | None = None
    dm: DMConversation | None = None
    access: ServerAccess | None = None
    blocked: bool = False  # 1:1 DM where either side blocked the other

    @property
    def kind(self) -> str:
        return "channel" if self.channel is not None else "dm"

    @property
    def id(self) -> Any:
        return self.channel.pk if self.channel is not None else self.dm.pk  # type: ignore[union-attr]

    @property
    def server_id(self) -> Any:
        return self.channel.server_id if self.channel is not None else None

    @property
    def group(self) -> str:
        if self.channel is not None:
            return events.channel_group(self.channel.pk)
        return events.dm_group(self.id)

    def messages(self) -> Any:
        return Message.objects.filter(**{self.kind: self.id})

    def scope(self) -> dict[str, Any]:
        """Identifies the conversation in event payloads."""
        return {
            "channel_id": str(self.channel.pk) if self.channel is not None else None,
            "dm_id": str(self.dm.pk) if self.dm is not None else None,
            "server_id": str(self.server_id) if self.server_id is not None else None,
        }

    def has(self, perm: Perm) -> bool:
        return bool(self.perms & perm)

    def require(self, perm: Perm) -> None:
        if self.has(perm):
            return
        if self.blocked and perm & DM_BLOCKED_PERMS:
            raise exceptions.PermissionDenied("You can't message this user.", code="blocked")
        raise exceptions.PermissionDenied(
            f"You need the {perm.name} permission here.", code="missing_permission"
        )


def channel_target(user: User, channel: Channel | Any) -> Target:
    """404 unless the user can view the channel."""
    if not isinstance(channel, Channel):
        channel = get_channel(channel)
    access = get_access(user, channel.server_id)
    perms = access.channel_perms(channel)
    if not perms & Perm.VIEW_CHANNEL:
        raise Http404
    return Target(user=user, perms=perms, channel=channel, access=access)


def dm_target(user: User, dm: DMConversation | Any) -> Target:
    """404 unless the user participates in the conversation."""
    dm_id = dm.pk if isinstance(dm, DMConversation) else dm
    participant = (
        DMParticipant.objects.select_related("conversation")
        .filter(conversation_id=dm_id, user=user)
        .first()
    )
    if participant is None:
        raise Http404
    conversation = participant.conversation
    perms = ALL & ~(Perm.ADMINISTRATOR | Perm.MANAGE_MESSAGES)
    blocked = False
    if not conversation.is_group:
        other = (
            DMParticipant.objects.filter(conversation=conversation)
            .exclude(user=user)
            .values_list("user_id", flat=True)
            .first()
        )
        if other is not None and either_blocked(user.pk, other):
            blocked = True
            perms &= ~DM_BLOCKED_PERMS
    return Target(user=user, perms=Perm(perms), dm=conversation, blocked=blocked)


def message_target(user: User, message: Message) -> Target:
    if message.channel_id is not None:
        return channel_target(user, message.channel)
    return dm_target(user, message.dm_id)


def message_scope_q(target: Target) -> Q:
    return Q(**{target.kind: target.id})


def message_scope(message: Message) -> tuple[dict[str, Any], str]:
    """Event scope and group of a message, without a viewer."""
    if message.channel_id is not None:
        server_id = (
            Channel.objects.filter(pk=message.channel_id)
            .values_list("server_id", flat=True)
            .first()
        )
        return (
            {"channel_id": str(message.channel_id), "dm_id": None, "server_id": str(server_id)},
            events.channel_group(message.channel_id),
        )
    return (
        {"channel_id": None, "dm_id": str(message.dm_id), "server_id": None},
        events.dm_group(message.dm_id),
    )
