"""Resolve a user's membership and effective permissions in a server (ADR-012).

Every server-scoped view goes through ``get_access``. Non-members get 404, not 403, so server
existence doesn't leak (docs/ARCHITECTURE.md §7).
"""

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from django.http import Http404
from rest_framework import exceptions

from apps.accounts.models import User
from apps.core.permissions import NONE, Overwrite, Perm, base_permissions, channel_permissions

from .models import Member, Role, Server

if TYPE_CHECKING:
    from apps.chat_channels.models import Channel

OWNER_POSITION = 1 << 30  # the owner outranks every role


@dataclass
class ServerAccess:
    user: User
    server: Server
    member: Member
    roles: list[Role]  # the member's roles, excluding @everyone
    everyone: Role
    base: Perm = field(init=False)

    def __post_init__(self) -> None:
        self.base = base_permissions(
            is_owner=self.is_owner,
            role_permissions=[self.everyone.permissions, *(r.permissions for r in self.roles)],
        )

    # ------------------------------------------------------------------ identity / hierarchy

    @property
    def is_owner(self) -> bool:
        return self.server.owner_id == self.user.pk

    @property
    def role_ids(self) -> set[Any]:
        return {r.pk for r in self.roles}

    @property
    def top_position(self) -> int:
        if self.is_owner:
            return OWNER_POSITION
        return max((r.position for r in self.roles), default=0)

    def has(self, perm: Perm) -> bool:
        return bool(self.base & perm) or bool(self.base & Perm.ADMINISTRATOR)

    def require(self, perm: Perm) -> None:
        if not self.has(perm):
            raise exceptions.PermissionDenied(
                f"You need the {perm.name} permission.", code="missing_permission"
            )

    def require_owner(self) -> None:
        if not self.is_owner:
            raise exceptions.PermissionDenied(
                "Only the server owner can do this.", code="not_owner"
            )

    def can_manage_role(self, role: Role) -> bool:
        """MANAGE_ROLES and the role sits below the actor's highest role (FR-ROLE-03)."""
        return self.has(Perm.MANAGE_ROLES) and role.position < self.top_position

    def assert_grantable(self, permissions: int) -> None:
        """Members can't hand out permissions they don't hold themselves."""
        if self.is_owner or self.has(Perm.ADMINISTRATOR):
            return
        missing = Perm(permissions) & ~self.base
        if missing:
            raise exceptions.PermissionDenied(
                f"You can't grant permissions you don't have: {missing!r}.",
                code="cannot_grant_permission",
            )

    # ------------------------------------------------------------------ channels

    def channel_perms(self, channel: Channel) -> Perm:
        """Effective permissions in a channel. Expects ``channel.overwrites`` to be prefetched."""
        if channel.server_id != self.server.pk:
            return NONE
        overwrites = [
            Overwrite(allow=o.allow, deny=o.deny, role_id=o.role_id, member_id=o.member_id)
            for o in channel.overwrites.all()
        ]
        return channel_permissions(
            self.base,
            everyone_role_id=self.everyone.pk,
            member_role_ids=self.role_ids,
            member_id=self.member.pk,
            overwrites=overwrites,
        )

    def require_channel(self, channel: Channel, perm: Perm) -> Perm:
        perms = self.channel_perms(channel)
        if not perms & Perm.VIEW_CHANNEL:
            raise Http404  # invisible channels don't exist for this member
        if not perms & perm:
            raise exceptions.PermissionDenied(
                f"You need the {perm.name} permission in this channel.", code="missing_permission"
            )
        return perms


def get_access(user: User, server: Server | Any) -> ServerAccess:
    """Membership and permissions of ``user`` in ``server`` (instance or id). 404 for outsiders."""
    server_id = server.pk if isinstance(server, Server) else server
    member = (
        Member.objects.select_related("server")
        .prefetch_related("roles")
        .filter(server_id=server_id, user=user)
        .first()
    )
    if member is None:
        raise Http404
    everyone = Role.objects.get(server_id=server_id, is_default=True)
    return ServerAccess(
        user=user,
        server=member.server,
        member=member,
        roles=list(member.roles.all()),
        everyone=everyone,
    )
