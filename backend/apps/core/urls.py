from django.urls import path

from .views import MetaView, PermissionListView

urlpatterns = [
    path("meta", MetaView.as_view(), name="meta"),
    path("permissions", PermissionListView.as_view(), name="permissions"),
]
