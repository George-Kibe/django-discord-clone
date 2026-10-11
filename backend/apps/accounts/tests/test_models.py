import uuid

import pytest
from django.contrib.auth import authenticate, get_user_model
from django.db import IntegrityError

from .factories import UserFactory

pytestmark = pytest.mark.django_db

User = get_user_model()


def test_primary_key_is_uuid7():
    user = UserFactory.create()
    assert isinstance(user.pk, uuid.UUID)
    assert user.pk.version == 7


def test_create_user_lowercases_email_and_username():
    user = User.objects.create_user(email="Alice@Example.COM", username="Alice", password="x" * 12)
    assert user.email == "alice@example.com"
    assert user.username == "alice"
    assert user.check_password("x" * 12)
    assert not user.is_staff


def test_create_user_requires_email():
    with pytest.raises(ValueError, match="email"):
        User.objects.create_user(email="", username="bob")


def test_create_superuser():
    admin = User.objects.create_superuser(email="root@example.com", username="root", password="pw")
    assert admin.is_staff
    assert admin.is_superuser


def test_email_is_unique_case_insensitively():
    UserFactory.create(email="dup@example.com")
    with pytest.raises(IntegrityError):
        UserFactory.create(email="DUP@example.com")


def test_authenticate_with_email_any_case():
    UserFactory.create(email="carol@example.com", password="correct-horse-battery")
    assert authenticate(email="CAROL@example.com", password="correct-horse-battery") is not None
    assert authenticate(email="carol@example.com", password="wrong") is None


def test_display_name_falls_back_to_username():
    user = UserFactory.create(username="dave", display_name="")
    assert user.get_full_name() == "dave"
    assert str(user) == "dave"
    assert not user.is_email_verified
