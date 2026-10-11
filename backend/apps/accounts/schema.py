"""OpenAPI description of the cookie-based JWT authentication (imported in AppConfig.ready)."""

from typing import Any

from drf_spectacular.extensions import OpenApiAuthenticationExtension


class JWTCookieAuthenticationScheme(OpenApiAuthenticationExtension):  # type: ignore[no-untyped-call]
    target_class = "apps.accounts.authentication.JWTCookieAuthentication"
    name = "jwtCookieAuth"

    def get_security_definition(self, auto_schema: Any) -> dict[str, str]:
        return {
            "type": "apiKey",
            "in": "cookie",
            "name": "access",
            "description": "httpOnly access JWT set by POST /api/v1/auth/login (ADR-006).",
        }
