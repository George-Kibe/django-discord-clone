"""Mention tokens in message content (FR-MSG-08), in Discord's format so renames don't break them:

- ``<@user_id>``: a user (the composer's autocomplete inserts these)
- ``<@&role_id>``: a role
- ``@everyone``: everyone who can see the channel (needs MENTION_EVERYONE)
"""

import re
import uuid
from dataclasses import dataclass, field
from typing import Any

from apps.core.permissions import Perm
from apps.servers.models import Member, Role

from .models import DMParticipant
from .targets import Target

USER_TOKEN = re.compile(r"<@([0-9a-fA-F-]{36})>")
ROLE_TOKEN = re.compile(r"<@&([0-9a-fA-F-]{36})>")
EVERYONE_TOKEN = re.compile(r"(?<![\w`])@everyone\b")
MAX_MENTIONS = 50


@dataclass
class ParsedMentions:
    user_ids: list[Any] = field(default_factory=list)  # valid: members / participants
    roles: list[Role] = field(default_factory=list)  # valid roles in this server
    effective_roles: list[Role] = field(default_factory=list)  # roles that actually notify
    everyone: bool = False  # @everyone that notifies (permission checked)


def _uuids(pattern: re.Pattern[str], content: str) -> list[uuid.UUID]:
    found: list[uuid.UUID] = []
    for raw in pattern.findall(content):
        try:
            value = uuid.UUID(raw)
        except ValueError:
            continue
        if value not in found:
            found.append(value)
    return found[:MAX_MENTIONS]


def parse(target: Target, content: str) -> ParsedMentions:
    result = ParsedMentions()
    user_ids = _uuids(USER_TOKEN, content)
    if target.channel is not None:
        if user_ids:
            result.user_ids = list(
                Member.objects.filter(
                    server_id=target.channel.server_id, user_id__in=user_ids
                ).values_list("user_id", flat=True)
            )
        role_ids = _uuids(ROLE_TOKEN, content)
        if role_ids:
            result.roles = list(
                Role.objects.filter(
                    server_id=target.channel.server_id, pk__in=role_ids, is_default=False
                )
            )
        can_mention_all = target.has(Perm.MENTION_EVERYONE)
        result.effective_roles = [r for r in result.roles if r.mentionable or can_mention_all]
        result.everyone = can_mention_all and bool(EVERYONE_TOKEN.search(content))
    elif user_ids:
        result.user_ids = list(
            DMParticipant.objects.filter(
                conversation_id=target.id, user_id__in=user_ids
            ).values_list("user_id", flat=True)
        )
    return result
