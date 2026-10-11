from rest_framework import exceptions
from rest_framework.request import Request

from .models import User


def current_user(request: Request) -> User:
    """The authenticated user, typed. Views using it must require authentication."""
    user = request.user
    if not isinstance(user, User):
        raise exceptions.NotAuthenticated()
    return user
