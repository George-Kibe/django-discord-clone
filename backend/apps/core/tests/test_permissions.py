"""Permission engine (ADR-012): precedence, admin bypass, VIEW_CHANNEL gate, exhaustive matrix."""

import itertools

import pytest

from apps.core.permissions import (
    ALL,
    DEFAULT_EVERYONE,
    NONE,
    Overwrite,
    Perm,
    base_permissions,
    channel_permissions,
)

EVERYONE, MOD, OTHER_ROLE, ME = "everyone", "mod", "other", "member-me"


def chan(base, overwrites, roles=(MOD,)):
    return channel_permissions(
        base, everyone_role_id=EVERYONE, member_role_ids=roles, member_id=ME, overwrites=overwrites
    )


def test_bits_are_stable():
    # Stored in the database: never renumber (docs/DATA_MODEL.md).
    stable = {
        "ADMINISTRATOR": 1,
        "VIEW_CHANNEL": 2,
        "SEND_MESSAGES": 256,
        "VIEW_AUDIT_LOG": 1 << 16,
    }
    assert {name: int(Perm[name]) for name in stable} == stable
    assert len(Perm) == 17


def test_base_permissions():
    assert base_permissions(is_owner=True, role_permissions=[]) == ALL
    assert (
        base_permissions(is_owner=False, role_permissions=[int(DEFAULT_EVERYONE)])
        == DEFAULT_EVERYONE
    )
    assert (
        base_permissions(is_owner=False, role_permissions=[1 << 40]) == NONE
    )  # unknown bits dropped
    union = base_permissions(
        is_owner=False, role_permissions=[int(Perm.VIEW_CHANNEL), int(Perm.KICK_MEMBERS)]
    )
    assert union == Perm.VIEW_CHANNEL | Perm.KICK_MEMBERS
    assert base_permissions(is_owner=False, role_permissions=[int(Perm.ADMINISTRATOR)]) == ALL


def test_administrator_bypasses_overwrites():
    deny_all = [Overwrite(allow=0, deny=int(ALL), role_id=EVERYONE)]
    assert chan(ALL, deny_all) == ALL


def test_without_view_channel_nothing_else_applies():
    ow = [Overwrite(allow=0, deny=int(Perm.VIEW_CHANNEL), role_id=EVERYONE)]
    assert chan(DEFAULT_EVERYONE, ow) == NONE


def test_role_allow_beats_everyone_deny_and_member_beats_role():
    send = int(Perm.SEND_MESSAGES)
    base = DEFAULT_EVERYONE
    ows = [
        Overwrite(allow=0, deny=send, role_id=EVERYONE),
        Overwrite(allow=send, deny=0, role_id=MOD),
    ]
    assert chan(base, ows) & Perm.SEND_MESSAGES
    ows.append(Overwrite(allow=0, deny=send, member_id=ME))
    assert not chan(base, ows) & Perm.SEND_MESSAGES


def test_role_allow_wins_over_another_roles_deny():
    send = int(Perm.SEND_MESSAGES)
    ows = [
        Overwrite(allow=send, deny=0, role_id=MOD),
        Overwrite(allow=0, deny=send, role_id=OTHER_ROLE),
    ]
    assert chan(DEFAULT_EVERYONE, ows, roles=(MOD, OTHER_ROLE)) & Perm.SEND_MESSAGES


def test_overwrites_for_roles_the_member_lacks_are_ignored():
    ows = [Overwrite(allow=0, deny=int(Perm.SEND_MESSAGES), role_id=OTHER_ROLE)]
    assert chan(DEFAULT_EVERYONE, ows) & Perm.SEND_MESSAGES


def _reference(base_has, everyone, role, member):
    """Straightforward model of Discord's rules for one bit. Each layer: None | 'allow' | 'deny'."""
    value = base_has
    for layer in (everyone, role, member):
        if layer == "allow":
            value = True
        elif layer == "deny":
            value = False
    return value


@pytest.mark.parametrize(
    ("base_has", "everyone", "role", "member"),
    list(
        itertools.product(
            [True, False], [None, "allow", "deny"], [None, "allow", "deny"], [None, "allow", "deny"]
        )
    ),
)
def test_exhaustive_single_bit_matrix(base_has, everyone, role, member):
    bit = int(Perm.SEND_MESSAGES)
    base = Perm.VIEW_CHANNEL | (Perm.SEND_MESSAGES if base_has else NONE)

    def ow(layer, **target):
        if layer is None:
            return []
        return [
            Overwrite(
                allow=bit if layer == "allow" else 0, deny=bit if layer == "deny" else 0, **target
            )
        ]

    overwrites = ow(everyone, role_id=EVERYONE) + ow(role, role_id=MOD) + ow(member, member_id=ME)
    assert bool(chan(base, overwrites) & bit) == _reference(base_has, everyone, role, member)
