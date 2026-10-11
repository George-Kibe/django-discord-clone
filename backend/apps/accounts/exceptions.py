from rest_framework import exceptions, status


class TokenNotValid(exceptions.AuthenticationFailed):
    """401 telling the client to call POST /auth/refresh (docs/API.md §1 Authentication)."""

    status_code = status.HTTP_401_UNAUTHORIZED
    default_detail = "Token is invalid or expired."
    default_code = "token_not_valid"
