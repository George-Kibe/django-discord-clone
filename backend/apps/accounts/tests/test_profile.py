"""Profiles (FR-PROF-01, FR-PROF-03, FR-PROF-04) and the verified-email permission."""

import pytest
from django.urls import reverse
from rest_framework.test import APIRequestFactory

from apps.accounts.permissions import IsEmailVerified

from .factories import UserFactory

pytestmark = pytest.mark.django_db


def test_me_returns_private_profile(auth_client, user):
    body = auth_client.get(reverse("users-me")).json()
    assert body == {
        "id": str(user.id),
        "username": user.username,
        "display_name": user.display_name,
        "bio": "",
        "avatar_url": None,
        "date_joined": body["date_joined"],
        "email": user.email,
        "status": "online",
        "email_verified": True,
    }


def test_update_profile(auth_client, user):
    response = auth_client.patch(
        reverse("users-me"),
        {
            "display_name": "Neo",
            "bio": "Follow the white rabbit",
            "status": "dnd",
            "username": "The.One",
        },
        format="json",
    )
    assert response.status_code == 200, response.content
    user.refresh_from_db()
    assert (user.display_name, user.bio, user.status, user.username) == (
        "Neo",
        "Follow the white rabbit",
        "dnd",
        "the.one",
    )


def test_read_only_fields_are_ignored(auth_client, user):
    auth_client.patch(
        reverse("users-me"),
        {"email": "hijack@example.com", "email_verified": False, "id": "x"},
        format="json",
    )
    user.refresh_from_db()
    assert user.email != "hijack@example.com"
    assert user.is_email_verified


@pytest.mark.parametrize(
    "payload",
    [
        {"username": "TAKEN"},
        {"username": "a"},
        {"username": "bad name!"},
        {"status": "busy"},
        {"bio": "x" * 501},
        {"display_name": "x" * 65},
    ],
)
def test_update_profile_validation(auth_client, payload):
    UserFactory.create(username="taken")
    assert auth_client.patch(reverse("users-me"), payload, format="json").status_code == 400


def test_keeping_own_username_is_allowed(auth_client, user):
    assert (
        auth_client.patch(
            reverse("users-me"), {"username": user.username.upper()}, format="json"
        ).status_code
        == 200
    )


def test_public_profile(auth_client, api_client):
    other = UserFactory.create(bio="hello")
    body = auth_client.get(reverse("users-detail", args=[other.id])).json()
    assert body["username"] == other.username
    assert body["bio"] == "hello"
    assert "email" not in body
    assert "status" not in body  # presence is shared through the gateway, not profiles

    assert api_client.get(reverse("users-detail", args=[other.id])).status_code == 401
    assert (
        auth_client.get(reverse("users-detail", args=[UserFactory.build().id])).status_code == 404
    )

    other.is_active = False
    other.save()
    assert auth_client.get(reverse("users-detail", args=[other.id])).status_code == 404


def test_is_email_verified_permission(user, unverified_user):
    request = APIRequestFactory().get("/")
    permission = IsEmailVerified()
    request.user = user
    assert permission.has_permission(request, None)
    request.user = unverified_user
    assert not permission.has_permission(request, None)


def test_public_profile_lists_mutual_servers(client_for, user, make_user):
    from apps.servers.services import add_member, create_server

    other = make_user()
    shared = create_server(owner=user, name="Shared")
    add_member(shared, other)
    create_server(owner=other, name="Theirs only")
    create_server(owner=user, name="Mine only")
    body = client_for(user).get(reverse("users-detail", args=[other.id])).json()
    assert [s["name"] for s in body["mutual_servers"]] == ["Shared"]
    assert set(body["mutual_servers"][0]) == {"id", "name", "icon_url"}
