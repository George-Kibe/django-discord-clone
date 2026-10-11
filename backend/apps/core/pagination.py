from rest_framework import pagination


class PageNumberPagination(pagination.PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 100


class MessageCursorPagination(pagination.CursorPagination):
    """Newest-first cursor pagination over UUIDv7 ids (time-ordered)."""

    page_size = 50
    max_page_size = 100
    page_size_query_param = "limit"
    ordering = "-id"
