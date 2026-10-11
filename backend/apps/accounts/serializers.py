from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.media.services import image_url

from .models import User, username_validator

AVATAR_SIZE = 256


class LowercaseCharField(serializers.CharField):
    def to_internal_value(self, data: Any) -> str:
        return super().to_internal_value(data).lower()


class LowercaseEmailField(serializers.EmailField):
    def to_internal_value(self, data: Any) -> str:
        return super().to_internal_value(data).lower()


class UsernameField(LowercaseCharField):
    def __init__(self, **kwargs: Any) -> None:
        super().__init__(min_length=2, max_length=32, validators=[username_validator], **kwargs)


class UserSummarySerializer(serializers.ModelSerializer[User]):
    """Compact user embedded in messages, members and invites."""

    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "display_name", "avatar_url"]
        read_only_fields = fields

    def get_avatar_url(self, user: User) -> str | None:
        return image_url(user.avatar_public_id, size=128)


class PublicUserSerializer(serializers.ModelSerializer[User]):
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "display_name", "bio", "avatar_url", "date_joined"]
        read_only_fields = fields

    def get_avatar_url(self, user: User) -> str | None:
        return image_url(user.avatar_public_id, size=AVATAR_SIZE)


class MutualServerSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    name = serializers.CharField()
    icon_url = serializers.CharField(allow_null=True)


class UserProfileSerializer(PublicUserSerializer):
    """GET /users/{id}: public profile plus the servers shared with the viewer (FR-PROF-03)."""

    mutual_servers = serializers.SerializerMethodField()

    class Meta(PublicUserSerializer.Meta):
        fields = [*PublicUserSerializer.Meta.fields, "mutual_servers"]
        read_only_fields = fields

    @extend_schema_field(MutualServerSerializer(many=True))
    def get_mutual_servers(self, user: User) -> list[dict[str, Any]]:
        from apps.servers.models import Server

        viewer = self.context["request"].user
        shared = (
            Server.objects.filter(members__user=user)
            .filter(members__user=viewer)
            .only("id", "name", "icon_public_id")
            .order_by("name")
        )
        return [
            {"id": s.pk, "name": s.name, "icon_url": image_url(s.icon_public_id, size=64)}
            for s in shared
        ]


class MeSerializer(PublicUserSerializer):
    """The signed-in user's own profile (response shape)."""

    email_verified = serializers.BooleanField(source="is_email_verified", read_only=True)

    class Meta(PublicUserSerializer.Meta):
        fields = [*PublicUserSerializer.Meta.fields, "email", "status", "email_verified"]
        read_only_fields = fields


class MeUpdateSerializer(serializers.ModelSerializer[User]):
    """PATCH /users/me input. Responses use MeSerializer."""

    username = UsernameField(required=False)

    class Meta:
        model = User
        fields = ["username", "display_name", "bio", "status"]

    def validate_username(self, value: str) -> str:
        if User.objects.filter(username=value).exclude(pk=self.instance.pk).exists():  # type: ignore[union-attr]
            raise serializers.ValidationError("That username is taken.", code="username_taken")
        return value


class RegisterSerializer(serializers.Serializer[dict[str, Any]]):
    email = LowercaseEmailField(max_length=254)
    username = UsernameField()
    display_name = serializers.CharField(max_length=64, required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, max_length=128, trim_whitespace=False)

    def validate_email(self, value: str) -> str:
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError(
                "An account with this email already exists.", code="email_taken"
            )
        return value

    def validate_username(self, value: str) -> str:
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("That username is taken.", code="username_taken")
        return value


class LoginSerializer(serializers.Serializer[dict[str, Any]]):
    email = LowercaseEmailField()
    password = serializers.CharField(max_length=128, trim_whitespace=False)


class EmailSerializer(serializers.Serializer[dict[str, Any]]):
    email = LowercaseEmailField()


class TokenSerializer(serializers.Serializer[dict[str, Any]]):
    token = serializers.CharField(max_length=1024)


class PasswordResetConfirmSerializer(serializers.Serializer[dict[str, Any]]):
    uid = serializers.CharField(max_length=128)
    token = serializers.CharField(max_length=128)
    password = serializers.CharField(max_length=128, trim_whitespace=False)


class PasswordChangeSerializer(serializers.Serializer[dict[str, Any]]):
    current_password = serializers.CharField(max_length=128, trim_whitespace=False)
    new_password = serializers.CharField(max_length=128, trim_whitespace=False)


class EmailChangeSerializer(serializers.Serializer[dict[str, Any]]):
    new_email = LowercaseEmailField(max_length=254)
    password = serializers.CharField(max_length=128, trim_whitespace=False)


class AvatarSerializer(serializers.Serializer[dict[str, Any]]):
    public_id = serializers.CharField(max_length=255)


class DetailSerializer(serializers.Serializer[dict[str, Any]]):
    detail = serializers.CharField()
