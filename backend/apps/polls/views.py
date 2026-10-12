from typing import Any
from uuid import UUID

from drf_spectacular.utils import extend_schema
from rest_framework import exceptions, serializers, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.utils import current_user
from apps.messaging.services import serialize
from apps.messaging.targets import message_target

from . import services
from .models import Poll

TAGS = ["polls"]


class VoteSerializer(serializers.Serializer[dict[str, Any]]):
    option_ids = serializers.ListField(
        child=serializers.IntegerField(), min_length=1, max_length=10
    )


def _poll(request: Request, poll_id: UUID) -> tuple[Poll, Any]:
    poll = (
        Poll.objects.select_related("message__channel", "message__dm")
        .filter(pk=poll_id, message__deleted_at__isnull=True)
        .first()
    )
    if poll is None:
        raise exceptions.NotFound()
    return poll, message_target(current_user(request), poll.message)


class PollVotesView(APIView):
    @extend_schema(request=VoteSerializer, responses={204: None}, tags=TAGS, summary="Vote")
    def put(self, request: Request, poll_id: UUID) -> Response:
        serializer = VoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        poll, target = _poll(request, poll_id)
        services.vote(target, poll, target.user, serializer.validated_data["option_ids"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(responses={204: None}, tags=TAGS, summary="Withdraw your vote")
    def delete(self, request: Request, poll_id: UUID) -> Response:
        poll, target = _poll(request, poll_id)
        services.withdraw(target, poll, target.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PollCloseView(APIView):
    @extend_schema(request=None, responses={204: None}, tags=TAGS, summary="Close the poll")
    def post(self, request: Request, poll_id: UUID) -> Response:
        poll, target = _poll(request, poll_id)
        services.close(target, poll)
        return Response(status=status.HTTP_204_NO_CONTENT)


__all__ = ["PollCloseView", "PollVotesView", "serialize"]
