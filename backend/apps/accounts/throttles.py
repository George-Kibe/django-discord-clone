from typing import Any

from rest_framework.request import Request
from rest_framework.throttling import ScopedRateThrottle, SimpleRateThrottle


class IPScopedThrottle(ScopedRateThrottle):
    """Per-IP throttle for anonymous auth endpoints, keyed by the view's ``throttle_scope``."""

    def get_cache_key(self, request: Request, view: Any) -> str | None:
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class LoginEmailThrottle(SimpleRateThrottle):
    """Per-account login limit, so a distributed attack on one email is still capped."""

    scope = "auth_login_email"

    def get_cache_key(self, request: Request, view: Any) -> str | None:
        email = request.data.get("email") if hasattr(request.data, "get") else None
        if not email:
            return None
        return self.cache_format % {"scope": self.scope, "ident": str(email).strip().lower()}
