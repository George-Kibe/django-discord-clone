"""Security configuration that the fast test settings would otherwise hide."""

from django.contrib.auth.hashers import Argon2PasswordHasher

from config.settings import base


def test_argon2_is_the_production_password_hasher():
    """NFR-SEC-02: tests swap in MD5 for speed; production must hash with Argon2."""
    assert base.PASSWORD_HASHERS[0] == "django.contrib.auth.hashers.Argon2PasswordHasher"
    hasher = Argon2PasswordHasher()
    encoded = hasher.encode("correct-horse-battery", hasher.salt())
    assert encoded.startswith("argon2$argon2id$")
    assert hasher.verify("correct-horse-battery", encoded)


def test_password_policy_minimum_length():
    minimum = next(
        v for v in base.AUTH_PASSWORD_VALIDATORS if str(v["NAME"]).endswith("LengthValidator")
    )
    assert minimum == {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 10},
    }
