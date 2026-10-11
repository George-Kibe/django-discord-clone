from django.urls import path

from .views import SignUploadView

urlpatterns = [
    path("sign", SignUploadView.as_view(), name="media-sign"),
]
