from django.urls import path

from apps.realtime.consumers import GatewayConsumer, PingConsumer

websocket_urlpatterns = [
    path("ws/ping/", PingConsumer.as_asgi()),  # public connectivity check
    path("ws/", GatewayConsumer.as_asgi()),  # authenticated gateway
]
