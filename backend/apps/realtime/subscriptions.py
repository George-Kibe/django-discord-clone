"""Which groups a connection receives: every server the user belongs to and every channel they
can view there. Recomputed when roles, overwrites, channels or membership change, so private
channel events never reach members who can't see them."""

from typing import Any

from django.db.models import Prefetch

from apps.accounts.models import User
from apps.chat_channels.models import Channel, PermissionOverwrite
from apps.core.permissions import Perm
from apps.servers.access import ServerAccess
from apps.servers.models import Member, Role

# {server_id: {channel_id: permission bits}}
Subscriptions = dict[str, dict[str, int]]


def compute(user: User, server_ids: list[Any] | None = None) -> Subscriptions:
    members = Member.objects.filter(user=user).select_related("server").prefetch_related("roles")
    if server_ids is not None:
        members = members.filter(server_id__in=server_ids)
    members_by_server = {m.server_id: m for m in members}
    if not members_by_server:
        return {}
    everyone = {
        r.server_id: r
        for r in Role.objects.filter(server_id__in=members_by_server, is_default=True)
    }
    channels = Channel.objects.filter(server_id__in=members_by_server).prefetch_related(
        Prefetch("overwrites", queryset=PermissionOverwrite.objects.all())
    )
    result: Subscriptions = {str(sid): {} for sid in members_by_server}
    accesses: dict[Any, ServerAccess] = {}
    for channel in channels:
        sid = channel.server_id
        access = accesses.get(sid)
        if access is None:
            member = members_by_server[sid]
            access = accesses[sid] = ServerAccess(
                user=user,
                server=member.server,
                member=member,
                roles=list(member.roles.all()),
                everyone=everyone[sid],
            )
        perms = access.channel_perms(channel)
        if perms & Perm.VIEW_CHANNEL:
            result[str(sid)][str(channel.pk)] = int(perms)
    return result


def compute_server(user: User, server_id: Any) -> dict[str, int] | None:
    """Visible channels in one server, or None if the user is no longer a member."""
    return compute(user, [server_id]).get(str(server_id))
