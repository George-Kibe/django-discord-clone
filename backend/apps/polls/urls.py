from django.urls import path

from . import views

urlpatterns = [
    path("<uuid:poll_id>/votes", views.PollVotesView.as_view(), name="poll-votes"),
    path("<uuid:poll_id>/close", views.PollCloseView.as_view(), name="poll-close"),
]
