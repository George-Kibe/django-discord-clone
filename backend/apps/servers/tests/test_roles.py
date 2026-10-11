"""Roles and hierarchy (FR-ROLE-01..04)."""

import pytest
from django.urls import reverse

from apps.core.permissions import Perm
from apps.servers.models import Member, Role

pytestmark = pytest.mark.django_db


@pytest.fixture
def manager(make_user, server, join):
    """A member holding a 'Manager' role (MANAGE_ROLES + KICK) ranked just below Moderator."""
    user = make_user()
    member = join(server, user)
    role = Role.objects.create(
        server=server,
        name="Manager",
        position=1,
        permissions=int(Perm.MANAGE_ROLES | Perm.KICK_MEMBERS),
    )
    Role.objects.filter(server=server, name="Moderator").update(position=2)
    Role.objects.filter(server=server, name="Admin").update(position=3)
    member.roles.add(role)
    return user


def roles_url(server):
    return reverse("server-roles", args=[server.pk])


def test_list_roles_highest_first(client_for, user, server):
    names = [r["name"] for r in client_for(user).get(roles_url(server)).json()]
    assert names == ["Admin", "Moderator", "@everyone"]


def test_create_role_goes_above_everyone(client_for, user, server):
    response = client_for(user).post(
        roles_url(server),
        {"name": "Helpers", "color": 0x00FF00, "permissions": int(Perm.KICK_MEMBERS)},
    )
    assert response.status_code == 201, response.content
    positions = {r.name: r.position for r in Role.objects.filter(server=server)}
    assert positions == {"@everyone": 0, "Helpers": 1, "Moderator": 2, "Admin": 3}


@pytest.mark.parametrize(
    "payload",
    [{"name": "x", "permissions": 1 << 40}, {"name": "x", "color": 0x1000000}, {"name": ""}],
)
def test_create_role_validation(client_for, user, server, payload):
    assert client_for(user).post(roles_url(server), payload).status_code == 400


def test_members_without_manage_roles_cannot_create(client_for, make_user, server, join):
    member = make_user()
    join(server, member)
    assert client_for(member).post(roles_url(server), {"name": "x"}).status_code == 403


def test_cannot_grant_permissions_you_lack(client_for, manager, server):
    response = client_for(manager).post(
        roles_url(server), {"name": "Evil", "permissions": int(Perm.ADMINISTRATOR)}
    )
    assert response.status_code == 403
    assert response.json()["code"] == "cannot_grant_permission"
    ok = client_for(manager).post(
        roles_url(server), {"name": "Kickers", "permissions": int(Perm.KICK_MEMBERS)}
    )
    assert ok.status_code == 201


def test_hierarchy_blocks_editing_higher_or_equal_roles(client_for, manager, server):
    moderator = Role.objects.get(server=server, name="Moderator")
    own = Role.objects.get(server=server, name="Manager")
    url = lambda role: reverse("server-role", args=[server.pk, role.pk])  # noqa: E731
    assert client_for(manager).patch(url(moderator), {"name": "x"}).status_code == 403
    assert (
        client_for(manager).patch(url(own), {"name": "x"}).status_code == 403
    )  # equal = not below
    low = Role.objects.create(server=server, name="Low", position=0)
    Role.objects.filter(pk=low.pk).update(position=0)
    assert client_for(manager).patch(url(low), {"name": "Lower"}).status_code == 200
    assert client_for(manager).delete(url(moderator)).status_code == 403


def test_everyone_role_protections(client_for, user, server):
    everyone = Role.objects.get(server=server, is_default=True)
    url = reverse("server-role", args=[server.pk, everyone.pk])
    response = client_for(user).patch(
        url, {"name": "renamed", "permissions": int(Perm.VIEW_CHANNEL)}
    )
    assert response.status_code == 200
    everyone.refresh_from_db()
    assert everyone.name == "@everyone" and everyone.permissions == int(Perm.VIEW_CHANNEL)
    assert client_for(user).delete(url).status_code == 400


def test_reorder_roles(client_for, user, manager, server):
    roles = {r.name: r for r in Role.objects.filter(server=server, is_default=False)}
    url = reverse("server-roles-reorder", args=[server.pk])
    order = [roles["Moderator"].pk, roles["Admin"].pk, roles["Manager"].pk]  # swap top two
    assert client_for(manager).patch(url, {"role_ids": [str(i) for i in order]}).status_code == 403
    assert (
        client_for(user).patch(url, {"role_ids": [str(roles["Admin"].pk)]}).status_code == 400
    )  # incomplete
    response = client_for(user).patch(url, {"role_ids": [str(i) for i in order]})
    assert response.status_code == 200
    assert [r["name"] for r in response.json()] == ["Moderator", "Admin", "Manager", "@everyone"]


def test_manager_can_reorder_only_below_own_role(client_for, manager, server):
    a = Role.objects.create(server=server, name="A", position=0)
    b = Role.objects.create(server=server, name="B", position=0)
    Role.objects.filter(pk=a.pk).update(position=0)
    # Normalize: Admin3 Moderator2 Manager1 + A,B must sit below Manager, so shift everything up.
    for name, pos in {"Admin": 5, "Moderator": 4, "Manager": 3, "A": 2, "B": 1}.items():
        Role.objects.filter(server=server, name=name).update(position=pos)
    ids = {r.name: str(r.pk) for r in Role.objects.filter(server=server, is_default=False)}
    url = reverse("server-roles-reorder", args=[server.pk])
    response = client_for(manager).patch(
        url, {"role_ids": [ids[n] for n in ["Admin", "Moderator", "Manager", "B", "A"]]}
    )
    assert response.status_code == 200, response.content
    assert Role.objects.get(pk=b.pk).position == 2


def test_member_role_assignment_respects_hierarchy(client_for, manager, make_user, server, join):
    target_user = make_user()
    target = join(server, target_user)
    url = reverse("server-member", args=[server.pk, target_user.pk])
    moderator = Role.objects.get(server=server, name="Moderator")
    low = Role.objects.create(server=server, name="Low", position=0)
    Role.objects.filter(pk=low.pk).update(position=0)

    assert client_for(manager).patch(url, {"role_ids": [str(moderator.pk)]}).status_code == 403
    response = client_for(manager).patch(url, {"role_ids": [str(low.pk)]})
    assert response.status_code == 200
    assert response.json()["role_ids"] == [str(low.pk)]
    assert list(target.roles.all()) == [low]


def test_cannot_change_roles_of_higher_members_or_owner(
    client_for, manager, user, make_user, server, join
):
    boss_user = make_user()
    boss = join(server, boss_user)
    boss.roles.add(Role.objects.get(server=server, name="Moderator"))
    low = Role.objects.create(server=server, name="Low", position=0)
    for target in (boss_user, user):
        url = reverse("server-member", args=[server.pk, target.pk])
        assert client_for(manager).patch(url, {"role_ids": [str(low.pk)]}).status_code == 403


def test_nicknames(client_for, make_user, manager, server, join):
    member_user = make_user()
    join(server, member_user)
    own = reverse("server-member", args=[server.pk, member_user.pk])
    assert client_for(member_user).patch(own, {"nickname": "Nicky"}).json()["nickname"] == "Nicky"
    other = reverse("server-member", args=[server.pk, manager.pk])
    assert client_for(member_user).patch(other, {"nickname": "x"}).status_code == 403
    assert client_for(manager).patch(own, {"nickname": "Renamed"}).status_code == 200


def test_unknown_role_and_member(client_for, user, make_user, server):
    import uuid

    assert (
        client_for(user)
        .patch(reverse("server-member", args=[server.pk, uuid.uuid4()]), {"nickname": "x"})
        .status_code
        == 404
    )
    url = reverse("server-member", args=[server.pk, user.pk])
    assert client_for(user).patch(url, {"role_ids": [str(uuid.uuid4())]}).status_code == 400


def test_member_list_and_query_count(
    client_for, user, make_user, server, join, django_assert_max_num_queries
):
    for _ in range(10):
        join(server, make_user()).roles.add(Role.objects.get(server=server, name="Moderator"))
    with django_assert_max_num_queries(6):
        body = client_for(user).get(reverse("server-members", args=[server.pk])).json()
    assert body["count"] == 11
    owner_row = next(m for m in body["results"] if m["user"]["id"] == str(user.pk))
    assert owner_row["is_owner"] is True
    assert set(owner_row["user"]) == {"id", "username", "display_name", "avatar_url"}


def test_permissions_endpoint(api_client):
    rows = api_client.get(reverse("permissions")).json()
    assert len(rows) == len(Perm)
    assert rows[0] == {"name": "ADMINISTRATOR", "value": 1, "description": rows[0]["description"]}
    assert all(r["description"] for r in rows)


def test_assigning_roles_to_self_is_limited_too(client_for, manager, server):
    member = Member.objects.get(server=server, user=manager)
    moderator = Role.objects.get(server=server, name="Moderator")
    url = reverse("server-member", args=[server.pk, manager.pk])
    current = [str(r.pk) for r in member.roles.all()]
    assert (
        client_for(manager).patch(url, {"role_ids": [*current, str(moderator.pk)]}).status_code
        == 403
    )
