"""Discord-style permission bitfield and computation (ADR-012, docs/DATA_MODEL.md#permissions).

Bits are append-only: never renumber, stored values depend on them.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from enum import IntFlag
from functools import reduce
from operator import or_


class Perm(IntFlag):
    ADMINISTRATOR = 1 << 0
    VIEW_CHANNEL = 1 << 1
    MANAGE_CHANNELS = 1 << 2
    MANAGE_ROLES = 1 << 3
    MANAGE_SERVER = 1 << 4
    CREATE_INVITE = 1 << 5
    KICK_MEMBERS = 1 << 6
    BAN_MEMBERS = 1 << 7
    SEND_MESSAGES = 1 << 8
    MANAGE_MESSAGES = 1 << 9
    ATTACH_FILES = 1 << 10
    ADD_REACTIONS = 1 << 11
    MENTION_EVERYONE = 1 << 12
    READ_MESSAGE_HISTORY = 1 << 13
    CREATE_POLLS = 1 << 14
    EXPORT_TRANSCRIPTS = 1 << 15
    VIEW_AUDIT_LOG = 1 << 16


NONE = Perm(0)
ALL = Perm(reduce(or_, Perm))

DEFAULT_EVERYONE = (
    Perm.VIEW_CHANNEL
    | Perm.SEND_MESSAGES
    | Perm.ATTACH_FILES
    | Perm.ADD_REACTIONS
    | Perm.READ_MESSAGE_HISTORY
    | Perm.CREATE_INVITE
    | Perm.CREATE_POLLS
)
DEFAULT_MODERATOR = (
    Perm.MANAGE_MESSAGES | Perm.KICK_MEMBERS | Perm.VIEW_AUDIT_LOG | Perm.EXPORT_TRANSCRIPTS
)

# Human-readable labels for the role editor (exposed by GET /api/v1/permissions).
DESCRIPTIONS: dict[Perm, str] = {
    Perm.ADMINISTRATOR: "Every permission, and bypasses channel overwrites. Grant with care.",
    Perm.VIEW_CHANNEL: "See channels and read new messages.",
    Perm.MANAGE_CHANNELS: "Create, edit, reorder and delete channels and categories.",
    Perm.MANAGE_ROLES: "Create and edit roles below their own, and assign them.",
    Perm.MANAGE_SERVER: "Change the server's name, description, icon and visibility.",
    Perm.CREATE_INVITE: "Create invite links.",
    Perm.KICK_MEMBERS: "Remove members from the server.",
    Perm.BAN_MEMBERS: "Ban members permanently.",
    Perm.SEND_MESSAGES: "Send messages in channels.",
    Perm.MANAGE_MESSAGES: "Delete and pin other people's messages.",
    Perm.ATTACH_FILES: "Upload images and files.",
    Perm.ADD_REACTIONS: "React to messages.",
    Perm.MENTION_EVERYONE: "Use @everyone.",
    Perm.READ_MESSAGE_HISTORY: "Read messages sent before they opened the channel.",
    Perm.CREATE_POLLS: "Create polls.",
    Perm.EXPORT_TRANSCRIPTS: "Export channel transcripts as PDF.",
    Perm.VIEW_AUDIT_LOG: "View the server audit log.",
}


@dataclass(frozen=True, slots=True)
class Overwrite:
    """A channel permission overwrite for a role or a member."""

    allow: int
    deny: int
    role_id: object | None = None
    member_id: object | None = None


def base_permissions(*, is_owner: bool, role_permissions: Iterable[int]) -> Perm:
    """Server-level permissions: union of @everyone and the member's roles."""
    if is_owner:
        return ALL
    perms = Perm(reduce(or_, role_permissions, 0)) & ALL
    return ALL if perms & Perm.ADMINISTRATOR else perms


def channel_permissions(
    base: Perm,
    *,
    everyone_role_id: object,
    member_role_ids: Iterable[object],
    member_id: object,
    overwrites: Iterable[Overwrite],
) -> Perm:
    """Apply overwrites in Discord's order: @everyone, then roles (deny then allow), then member."""
    if base & Perm.ADMINISTRATOR:
        return ALL
    overwrites = list(overwrites)
    role_ids = set(member_role_ids)
    perms = int(base)

    for ow in overwrites:
        if ow.role_id is not None and ow.role_id == everyone_role_id:
            perms = (perms & ~ow.deny) | ow.allow

    allow = deny = 0
    for ow in overwrites:
        if ow.role_id is not None and ow.role_id != everyone_role_id and ow.role_id in role_ids:
            allow |= ow.allow
            deny |= ow.deny
    perms = (perms & ~deny) | allow

    for ow in overwrites:
        if ow.member_id is not None and ow.member_id == member_id:
            perms = (perms & ~ow.deny) | ow.allow

    result = Perm(perms) & ALL
    # Without VIEW_CHANNEL a channel grants nothing else.
    return result if result & Perm.VIEW_CHANNEL else NONE
