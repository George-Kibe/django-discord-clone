import pytest

from apps.core.throttling import ScopedWindowThrottle


@pytest.mark.parametrize(
    ("rate", "expected"),
    [("10/10s", (10, 10)), ("5/min", (5, 60)), ("20/hour", (20, 3600)), ("3/2d", (3, 172800))],
)
def test_parse_rate(rate, expected):
    assert (
        ScopedWindowThrottle.parse_rate(ScopedWindowThrottle.__new__(ScopedWindowThrottle), rate)
        == expected
    )


def test_invalid_rate():
    with pytest.raises(ValueError, match="Invalid"):
        ScopedWindowThrottle.parse_rate(ScopedWindowThrottle.__new__(ScopedWindowThrottle), "lots")
