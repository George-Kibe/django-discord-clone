from typing import Any

from rest_framework.permissions import BasePermission
from rest_framework.request import Request


class IsEmailVerified(BasePermission):
    """FR-AUTH-02: verified email required (used for posting and creating servers)."""

    message = "Verify your email address to do this."
    code = "email_not_verified"

    def has_permission(self, request: Request, view: Any) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and getattr(user, "is_email_verified", False))
