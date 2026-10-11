from django.urls import path
from . import views

app_name = "polls"

urlpatterns = [
    path('home/', views.home, name="home"),
    path('create/', views.create, name="create"),
    path('results/<poll_id>/', views.results, name="results"),
    path('vote/<poll_id>/', views.vote, name="vote"),
]
