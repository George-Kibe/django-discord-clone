"""Server, role, membership and invite business logic (FR-SRV, FR-ROLE)."""

from datetime import timedelta
from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone
from rest_framework import exceptions

from apps.accounts.models import User
from apps.core.permissions import DEFAULT_EVERYONE, DEFAULT_MODERATOR, Perm
from apps.media import services as media
from apps.media.tasks import delete_asset

from .access import ServerAccess
from .models import Invite, Member, Role, Server


class Conflict(exceptions.APIException):
    status_code = 409
    default_detail = "Conflict."
    default_code = "conflict"


# ---------------------------------------------------------------------------- servers


@transaction.atomic
def create_server(*, owner: User, name: str, description: str = "", **extra: Any) -> Server:
    """FR-SRV-01/02: a new server comes with @everyone, Moderator, Admin and a #general channel."""
    from apps.chat_channels.models import Category, Channel

    icon_public_id = extra.pop("icon_public_id", "")
    server = Server.objects.create(
        owner=owner, name=name, description=description, member_count=1, **extra
    )
    Role.objects.bulk_create(
        [
            Role(
                server=server,
                name="@everyone",
                position=0,
                permissions=int(DEFAULT_EVERYONE),
                is_default=True,
            ),
            Role(
                server=server,
                name="Moderator",
                position=1,
                permissions=int(DEFAULT_MODERATOR),
                color=0x3BA55C,
                hoist=True,
            ),
            Role(
                server=server,
                name="Admin",
                position=2,
                permissions=int(Perm.ADMINISTRATOR),
                color=0xED4245,
                hoist=True,
            ),
        ]
    )
    Member.objects.create(server=server, user=owner)
    category = Category.objects.create(server=server, name="Text Channels", position=0)
    Channel.objects.create(server=server, category=category, name="general", position=0)
    if icon_public_id:
        _set_icon(server, owner, icon_public_id)
    return server


def _set_icon(server: Server, user: User, public_id: str) -> None:
    old = server.icon_public_id
    if public_id:
        media.claim_upload(user=user, public_id=public_id, purpose="server_icon")
    server.icon_public_id = public_id
    server.save(update_fields=["icon_public_id", "updated_at"])
    if old and old != public_id:
        delete_asset.delay(old)


@transaction.atomic
def update_server(access: ServerAccess, data: dict[str, Any]) -> Server:
    access.require(Perm.MANAGE_SERVER)
    server = access.server
    if "icon_public_id" in data:
        _set_icon(server, access.user, data.pop("icon_public_id") or "")
    for key, value in data.items():
        setattr(server, key, value)
    server.save()
    return server


def delete_server(access: ServerAccess) -> None:
    access.require_owner()
    icon = access.server.icon_public_id
    access.server.delete()
    if icon:
        delete_asset.delay(icon)


@transaction.atomic
def transfer_ownership(access: ServerAccess, new_owner_id: Any) -> Server:
    """FR-SRV-09."""
    access.require_owner()
    if new_owner_id == access.user.pk:
        raise exceptions.ValidationError({"user_id": ["You already own this server."]})
    if not Member.objects.filter(server=access.server, user_id=new_owner_id).exists():
        raise exceptions.ValidationError({"user_id": ["The new owner must be a member."]})
    access.server.owner_id = new_owner_id
    access.server.save(update_fields=["owner", "updated_at"])
    return access.server


@transaction.atomic
def add_member(server: Server, user: User) -> Member:
    """Joins ``user`` to ``server`` (FR-SRV-05). 409 if already a member."""
    try:
        with transaction.atomic():
            member = Member.objects.create(server=server, user=user)
    except IntegrityError:
        raise Conflict("You're already a member of this server.", code="already_member") from None
    Server.objects.filter(pk=server.pk).update(member_count=F("member_count") + 1)
    return member


def join_public_server(server: Server, user: User) -> Member:
    if not server.is_public:
        raise exceptions.NotFound()
    return add_member(server, user)


@transaction.atomic
def leave_server(access: ServerAccess) -> None:
    """FR-SRV-06: the owner has to transfer ownership first."""
    if access.is_owner:
        raise exceptions.ValidationError(
            {"non_field_errors": ["Transfer ownership before leaving your server."]},
            code="owner_cannot_leave",
        )
    access.member.delete()
    Server.objects.filter(pk=access.server.pk).update(member_count=F("member_count") - 1)


# ---------------------------------------------------------------------------- roles


@transaction.atomic
def create_role(access: ServerAccess, data: dict[str, Any]) -> Role:
    """New roles go right above @everyone (position 1); the others shift up."""
    access.require(Perm.MANAGE_ROLES)
    permissions = int(data.get("permissions", 0))
    access.assert_grantable(permissions)
    Role.objects.filter(server=access.server, is_default=False).update(position=F("position") + 1)
    return Role.objects.create(
        server=access.server, position=1, **(data | {"permissions": permissions})
    )


def _manageable_role(access: ServerAccess, role: Role) -> None:
    if not access.can_manage_role(role):
        raise exceptions.PermissionDenied(
            "You can only manage roles below your highest role.", code="role_hierarchy"
        )


@transaction.atomic
def update_role(access: ServerAccess, role: Role, data: dict[str, Any]) -> Role:
    access.require(Perm.MANAGE_ROLES)
    if role.is_default:
        data.pop("name", None)  # @everyone can't be renamed, only its permissions change
        if not (access.is_owner or access.has(Perm.ADMINISTRATOR)):
            _manageable_role(access, role)
    else:
        _manageable_role(access, role)
    if "permissions" in data:
        access.assert_grantable(int(data["permissions"]))
    for key, value in data.items():
        setattr(role, key, value)
    role.save()
    return role


def delete_role(access: ServerAccess, role: Role) -> None:
    access.require(Perm.MANAGE_ROLES)
    if role.is_default:
        raise exceptions.ValidationError({"non_field_errors": ["@everyone can't be deleted."]})
    _manageable_role(access, role)
    role.delete()


@transaction.atomic
def reorder_roles(access: ServerAccess, ordered_ids: list[Any]) -> list[Role]:
    """``ordered_ids`` lists every non-default role from highest to lowest.

    Roles at or above the actor's highest role must keep their position (FR-ROLE-03).
    """
    access.require(Perm.MANAGE_ROLES)
    roles = {
        r.pk: r
        for r in Role.objects.select_for_update().filter(server=access.server, is_default=False)
    }
    if set(ordered_ids) != set(roles) or len(ordered_ids) != len(roles):
        raise exceptions.ValidationError(
            {"role_ids": ["List every role except @everyone exactly once."]}
        )
    total = len(ordered_ids)
    changed = []
    for index, role_id in enumerate(ordered_ids):
        role = roles[role_id]
        new_position = total - index
        if new_position == role.position:
            continue
        if not (access.can_manage_role(role) and new_position < access.top_position):
            raise exceptions.PermissionDenied(
                "You can only reorder roles below your highest role.", code="role_hierarchy"
            )
        role.position = new_position
        changed.append(role)
    Role.objects.bulk_update(changed, ["position"])
    return sorted(roles.values(), key=lambda r: -r.position)


# ---------------------------------------------------------------------------- members


@transaction.atomic
def update_member(access: ServerAccess, member: Member, data: dict[str, Any]) -> Member:
    is_self = member.pk == access.member.pk
    target_is_owner = member.user_id == access.server.owner_id
    target_top = max((r.position for r in member.roles.all()), default=0)
    outranks_target = access.is_owner or (not target_is_owner and target_top < access.top_position)

    if "nickname" in data:
        if not is_self:
            access.require(Perm.MANAGE_ROLES)
            if not outranks_target:
                raise exceptions.PermissionDenied(
                    "You can't change this member's nickname.", code="role_hierarchy"
                )
        member.nickname = data["nickname"]
        member.save(update_fields=["nickname", "updated_at"])

    if "role_ids" in data:
        access.require(Perm.MANAGE_ROLES)
        if not is_self and not outranks_target:
            raise exceptions.PermissionDenied(
                "You can't change this member's roles.", code="role_hierarchy"
            )
        wanted = set(data["role_ids"])
        server_roles = {
            r.pk: r for r in Role.objects.filter(server=access.server, is_default=False)
        }
        unknown = wanted - set(server_roles)
        if unknown:
            raise exceptions.ValidationError({"role_ids": ["Unknown role."]})
        current = {r.pk for r in member.roles.all()}
        for role_id in wanted ^ current:  # every role being added or removed
            _manageable_role(access, server_roles[role_id])
        member.roles.set([server_roles[r] for r in wanted])
    return member


# ---------------------------------------------------------------------------- invites

MAX_AGE_CHOICES = [0, 1800, 3600, 21600, 43200, 86400, 604800]  # seconds; 0 = never


def create_invite(
    access: ServerAccess, *, max_age: int, max_uses: int | None, channel: Any = None
) -> Invite:
    access.require(Perm.CREATE_INVITE)
    expires_at = timezone.now() + timedelta(seconds=max_age) if max_age else None
    for _ in range(5):  # retry the (astronomically unlikely) code collision
        try:
            with transaction.atomic():
                return Invite.objects.create(
                    server=access.server,
                    channel=channel,
                    inviter=access.user,
                    max_uses=max_uses or None,
                    expires_at=expires_at,
                )
        except IntegrityError:
            continue
    raise Conflict("Couldn't create an invite. Try again.")


def visible_invites(access: ServerAccess) -> Any:
    qs = Invite.objects.filter(server=access.server, revoked_at__isnull=True).select_related(
        "inviter"
    )
    return qs if access.has(Perm.MANAGE_SERVER) else qs.filter(inviter=access.user)


def revoke_invite(access: ServerAccess, invite: Invite) -> None:
    if invite.inviter_id != access.user.pk:
        access.require(Perm.MANAGE_SERVER)
    invite.revoked_at = timezone.now()
    invite.save(update_fields=["revoked_at"])


def get_usable_invite(code: str) -> Invite:
    invite = Invite.objects.select_related("server", "inviter").filter(code=code).first()
    if invite is None or not invite.is_usable:
        raise exceptions.NotFound("This invite is invalid or has expired.", code="invalid_invite")
    return invite


@transaction.atomic
def accept_invite(code: str, user: User) -> Server:
    """FR-SRV-05. Already a member: no-op (the invite use isn't consumed)."""
    invite = Invite.objects.select_for_update().filter(code=code).first()
    if invite is None or not invite.is_usable:
        raise exceptions.NotFound("This invite is invalid or has expired.", code="invalid_invite")
    server = Server.objects.get(pk=invite.server_id)
    if Member.objects.filter(server=server, user=user).exists():
        return server
    add_member(server, user)
    invite.uses = F("uses") + 1
    invite.save(update_fields=["uses"])
    return server
