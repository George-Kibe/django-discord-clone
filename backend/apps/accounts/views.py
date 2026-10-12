from typing import Any

from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.generics import RetrieveAPIView
from rest_framework.permissions import SAFE_METHODS, AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.media import services as media
from apps.media.tasks import delete_asset
from apps.realtime import notify

from . import services
from .authentication import enforce_csrf, user_from_access_token
from .cookies import ACCESS_COOKIE, REFRESH_COOKIE, clear_auth_cookies, set_auth_cookies
from .exceptions import TokenNotValid
from .models import User
from .serializers import (
    AvatarSerializer,
    DetailSerializer,
    EmailChangeSerializer,
    EmailSerializer,
    LoginSerializer,
    MeSerializer,
    MeUpdateSerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    RegisterSerializer,
    TokenSerializer,
    UserProfileSerializer,
)
from .throttles import IPScopedThrottle, LoginEmailThrottle
from .tokens import rotate_refresh_token
from .utils import current_user

AUTH_TAGS = ["auth"]
USER_TAGS = ["users"]


def _detail(message: str, status_code: int = status.HTTP_200_OK) -> Response:
    return Response({"detail": message}, status=status_code)


class AnonymousAuthView(APIView):
    """Base for public auth endpoints: no authentication, CSRF enforced on writes, IP throttled."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [IPScopedThrottle]
    csrf_protected = True

    def initial(self, request: Request, *args: Any, **kwargs: Any) -> None:
        super().initial(request, *args, **kwargs)
        if self.csrf_protected and request.method not in SAFE_METHODS:
            enforce_csrf(request)

    def get_authenticate_header(self, request: Request) -> str:
        return 'Bearer realm="api"'  # keep 401s as 401 (DRF turns them into 403 otherwise)


# ---------------------------------------------------------------------------- auth


@method_decorator(ensure_csrf_cookie, name="get")
class CSRFView(AnonymousAuthView):
    """Sets the ``csrftoken`` cookie. The frontend calls this before its first write."""

    throttle_classes = []

    @extend_schema(responses=DetailSerializer, tags=AUTH_TAGS)
    def get(self, request: Request) -> Response:
        return _detail("CSRF cookie set.")


class RegisterView(AnonymousAuthView):
    throttle_scope = "auth_register"

    @extend_schema(request=RegisterSerializer, responses={201: MeSerializer}, tags=AUTH_TAGS)
    def post(self, request: Request) -> Response:
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = services.register_user(**serializer.validated_data, request=request._request)
        return Response(MeSerializer(user).data, status=status.HTTP_201_CREATED)


class LoginView(AnonymousAuthView):
    throttle_scope = "auth_login"
    throttle_classes = [IPScopedThrottle, LoginEmailThrottle]

    @extend_schema(request=LoginSerializer, responses={200: MeSerializer}, tags=AUTH_TAGS)
    def post(self, request: Request) -> Response:
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user, refresh = services.login(**serializer.validated_data, request=request._request)
        response = Response(MeSerializer(user).data)
        set_auth_cookies(response, refresh)
        return response


class RefreshView(AnonymousAuthView):
    """Rotates the refresh cookie and issues a new access cookie.

    CSRF-exempt: it only reads the httpOnly refresh cookie (path-restricted, SameSite=Lax) and
    returns nothing an attacker could read. Reuse of a rotated token revokes all sessions.
    """

    throttle_classes = []
    csrf_protected = False

    def handle_exception(self, exc: Exception) -> Response:
        response = super().handle_exception(exc)
        if isinstance(exc, TokenNotValid):
            # Dead session: drop the cookies (incl. the routing hint) so the client stops retrying.
            clear_auth_cookies(response)
        return response

    @extend_schema(
        request=None,
        responses={200: MeSerializer, 401: OpenApiResponse(description="token_not_valid")},
        tags=AUTH_TAGS,
    )
    def post(self, request: Request) -> Response:
        user, refresh = rotate_refresh_token(request.COOKIES.get(REFRESH_COOKIE), request._request)
        response = Response(MeSerializer(user).data)
        set_auth_cookies(response, refresh)
        return response


class LogoutView(AnonymousAuthView):
    """Always succeeds and clears cookies, even if the access token has already expired."""

    throttle_classes = []

    @extend_schema(request=None, responses={204: None}, tags=AUTH_TAGS)
    def post(self, request: Request) -> Response:
        raw_access = request.COOKIES.get(ACCESS_COOKIE)
        user = user_from_access_token(raw_access) if raw_access else None
        services.logout(
            user=user, refresh_raw=request.COOKIES.get(REFRESH_COOKIE), request=request._request
        )
        if user is not None:
            # Same-browser tabs lose their cookies; other devices reconnect with their own.
            notify.revoke_sockets(user.pk)
        response = Response(status=status.HTTP_204_NO_CONTENT)
        clear_auth_cookies(response)
        return response


class VerifyEmailView(AnonymousAuthView):
    """Confirms an email verification or email-change link (the link may open in any browser)."""

    throttle_scope = "auth_verification"

    @extend_schema(request=TokenSerializer, responses={200: DetailSerializer}, tags=AUTH_TAGS)
    def post(self, request: Request) -> Response:
        serializer = TokenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.confirm_email_token(serializer.validated_data["token"], request._request)
        return _detail("Your email address is verified.")


class ResendVerificationView(AnonymousAuthView):
    throttle_scope = "auth_verification"

    @extend_schema(request=EmailSerializer, responses={202: DetailSerializer}, tags=AUTH_TAGS)
    def post(self, request: Request) -> Response:
        serializer = EmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.resend_verification(serializer.validated_data["email"])
        # Same response whether or not the account exists (no enumeration).
        return _detail(
            "If that account needs verifying, we've sent a new link.", status.HTTP_202_ACCEPTED
        )


class PasswordResetView(AnonymousAuthView):
    throttle_scope = "auth_password_reset"

    @extend_schema(request=EmailSerializer, responses={202: DetailSerializer}, tags=AUTH_TAGS)
    def post(self, request: Request) -> Response:
        serializer = EmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.request_password_reset(serializer.validated_data["email"])
        return _detail(
            "If an account exists for that email, we've sent a reset link.",
            status.HTTP_202_ACCEPTED,
        )


class PasswordResetConfirmView(AnonymousAuthView):
    throttle_scope = "auth_password_reset"

    @extend_schema(
        request=PasswordResetConfirmSerializer, responses={200: DetailSerializer}, tags=AUTH_TAGS
    )
    def post(self, request: Request) -> Response:
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.confirm_password_reset(**serializer.validated_data, request=request._request)
        return _detail("Your password has been reset. You can now sign in.")


class PasswordChangeView(APIView):
    @extend_schema(request=PasswordChangeSerializer, responses={200: MeSerializer}, tags=AUTH_TAGS)
    def post(self, request: Request) -> Response:
        serializer = PasswordChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = current_user(request)
        refresh = services.change_password(
            user=user, **serializer.validated_data, request=request._request
        )
        response = Response(MeSerializer(user).data)
        set_auth_cookies(response, refresh)
        return response


# ---------------------------------------------------------------------------- users


class MeView(APIView):
    @extend_schema(responses=MeSerializer, tags=USER_TAGS)
    def get(self, request: Request) -> Response:
        return Response(MeSerializer(current_user(request)).data)

    @extend_schema(request=MeUpdateSerializer, responses=MeSerializer, tags=USER_TAGS)
    def patch(self, request: Request) -> Response:
        user = current_user(request)
        previous_status = user.status
        serializer = MeUpdateSerializer(user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        notify.user_updated(user.pk)
        if user.status != previous_status:
            notify.status_changed(user.pk, user.status)
        return Response(MeSerializer(user).data)


class EmailChangeView(APIView):
    @extend_schema(request=EmailChangeSerializer, responses={202: DetailSerializer}, tags=USER_TAGS)
    def post(self, request: Request) -> Response:
        serializer = EmailChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.request_email_change(user=current_user(request), **serializer.validated_data)
        return _detail("Check your new inbox for a confirmation link.", status.HTTP_202_ACCEPTED)


class AvatarView(APIView):
    """Attach an uploaded image (see POST /media/sign) as the avatar, or remove it."""

    @extend_schema(request=AvatarSerializer, responses=MeSerializer, tags=USER_TAGS)
    def put(self, request: Request) -> Response:
        serializer = AvatarSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = current_user(request)
        public_id = serializer.validated_data["public_id"]
        media.claim_upload(user=user, public_id=public_id, purpose="avatar")
        _replace_avatar(user, public_id)
        return Response(MeSerializer(user).data)

    @extend_schema(responses=MeSerializer, tags=USER_TAGS)
    def delete(self, request: Request) -> Response:
        user = current_user(request)
        _replace_avatar(user, "")
        return Response(MeSerializer(user).data)


def _replace_avatar(user: User, public_id: str) -> None:
    old = user.avatar_public_id
    user.avatar_public_id = public_id
    user.save(update_fields=["avatar_public_id"])
    notify.user_updated(user.pk)
    if old and old != public_id:
        delete_asset.delay(old)


class UserDetailView(RetrieveAPIView[User]):
    queryset = User.objects.filter(is_active=True)
    serializer_class = UserProfileSerializer

    @extend_schema(tags=USER_TAGS)
    def get(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        return super().get(request, *args, **kwargs)
