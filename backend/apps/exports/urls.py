from django.urls import path

from . import views

list_urlpatterns = [path("", views.ExportListView.as_view(), name="exports")]

detail_urlpatterns = [
    path("<uuid:export_id>", views.ExportDetailView.as_view(), name="export"),
    path("<uuid:export_id>/download", views.ExportDownloadView.as_view(), name="export-download"),
]
