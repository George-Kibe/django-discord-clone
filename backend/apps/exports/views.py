from typing import Any
from uuid import UUID

from django.http import FileResponse
from django.urls import reverse
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import exceptions, serializers, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.utils import current_user
from apps.messaging.targets import channel_target, dm_target

from . import services
from .models import ExportJob

TAGS = ["exports"]


class ExportRequestSerializer(serializers.Serializer[dict[str, Any]]):
    channel_id = serializers.UUIDField(required=False, allow_null=True)
    dm_id = serializers.UUIDField(required=False, allow_null=True)
    date_from = serializers.DateField(required=False, allow_null=True)
    date_to = serializers.DateField(required=False, allow_null=True)

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if bool(attrs.get("channel_id")) == bool(attrs.get("dm_id")):
            raise serializers.ValidationError("Give exactly one of channel_id or dm_id.")
        return attrs


class ExportJobSerializer(serializers.ModelSerializer[ExportJob]):
    channel_id = serializers.UUIDField(read_only=True, allow_null=True)
    dm_id = serializers.UUIDField(read_only=True, allow_null=True)
    download_url = serializers.SerializerMethodField(
        help_text="Signed link, valid for 15 minutes. Only when the export is done."
    )

    class Meta:
        model = ExportJob
        fields = [
            "id",
            "status",
            "channel_id",
            "dm_id",
            "date_from",
            "date_to",
            "message_count",
            "created_at",
            "completed_at",
            "expires_at",
            "download_url",
        ]
        read_only_fields = fields

    def get_download_url(self, job: ExportJob) -> str | None:
        if job.status != ExportJob.Status.DONE:
            return None
        path = reverse("export-download", args=[job.pk])
        return f"{path}?token={services.download_token(job)}"


class ExportListView(APIView):
    @extend_schema(request=ExportRequestSerializer, responses={202: ExportJobSerializer}, tags=TAGS)
    def post(self, request: Request) -> Response:
        serializer = ExportRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = current_user(request)
        target = (
            channel_target(user, data["channel_id"])
            if data.get("channel_id")
            else dm_target(user, data["dm_id"])
        )
        job = services.start(target, date_from=data.get("date_from"), date_to=data.get("date_to"))
        return Response(ExportJobSerializer(job).data, status=status.HTTP_202_ACCEPTED)


def _job(request: Request, export_id: UUID) -> ExportJob:
    job = ExportJob.objects.filter(pk=export_id, requested_by=current_user(request)).first()
    if job is None:
        raise exceptions.NotFound()
    return job


class ExportDetailView(APIView):
    @extend_schema(responses=ExportJobSerializer, tags=TAGS)
    def get(self, request: Request, export_id: UUID) -> Response:
        return Response(ExportJobSerializer(_job(request, export_id)).data)


class ExportDownloadView(APIView):
    @extend_schema(
        parameters=[OpenApiParameter("token", str, required=True)],
        responses={(200, "application/pdf"): bytes},
        tags=TAGS,
    )
    def get(self, request: Request, export_id: UUID) -> FileResponse:
        if services.check_token(
            request.query_params.get("token", ""), current_user(request)
        ) != str(export_id):
            raise exceptions.PermissionDenied("Invalid download link.", code="bad_link")
        job = _job(request, export_id)
        if job.status != ExportJob.Status.DONE:
            raise exceptions.NotFound("This export is no longer available.")
        try:
            handle = services.path_for(job).open("rb")  # FileResponse closes it
        except FileNotFoundError:
            raise exceptions.NotFound("This export is no longer available.") from None
        return FileResponse(handle, as_attachment=True, filename=f"transcript-{job.pk}.pdf")
