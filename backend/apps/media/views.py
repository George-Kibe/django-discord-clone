from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.accounts.utils import current_user

from . import services
from .serializers import SignUploadRequestSerializer, SignUploadResponseSerializer


class SignUploadView(APIView):
    """Signed parameters for a direct browser upload to Cloudinary (ADR-010)."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "media_sign"

    @extend_schema(
        request=SignUploadRequestSerializer,
        responses={200: SignUploadResponseSerializer},
        tags=["media"],
    )
    def post(self, request: Request) -> Response:
        serializer = SignUploadRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        params = services.sign_upload(user=current_user(request), **serializer.validated_data)
        return Response(params)
