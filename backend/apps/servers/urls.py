from django.urls import path

from . import views

server_urlpatterns = [
    path("", views.ServerListView.as_view(), name="servers"),
    path("<uuid:server_id>", views.ServerDetailView.as_view(), name="server-detail"),
    path(
        "<uuid:server_id>/transfer-ownership",
        views.TransferOwnershipView.as_view(),
        name="server-transfer",
    ),
    path("<uuid:server_id>/join", views.JoinServerView.as_view(), name="server-join"),
    path("<uuid:server_id>/leave", views.LeaveServerView.as_view(), name="server-leave"),
    path("<uuid:server_id>/members", views.MemberListView.as_view(), name="server-members"),
    path(
        "<uuid:server_id>/members/<uuid:user_id>",
        views.MemberDetailView.as_view(),
        name="server-member",
    ),
    path("<uuid:server_id>/roles", views.RoleListView.as_view(), name="server-roles"),
    path(
        "<uuid:server_id>/roles/reorder",
        views.RoleReorderView.as_view(),
        name="server-roles-reorder",
    ),
    path(
        "<uuid:server_id>/roles/<uuid:role_id>", views.RoleDetailView.as_view(), name="server-role"
    ),
    path("<uuid:server_id>/invites", views.ServerInviteListView.as_view(), name="server-invites"),
]

invite_urlpatterns = [
    path("<str:code>", views.InviteDetailView.as_view(), name="invite"),
    path("<str:code>/accept", views.AcceptInviteView.as_view(), name="invite-accept"),
]
