import re

from rest_framework.throttling import ScopedRateThrottle

_RATE = re.compile(r"^(?P<num>\d+)/(?P<count>\d*)(?P<unit>[smhd])\w*$")
_SECONDS = {"s": 1, "m": 60, "h": 3600, "d": 86400}


class ScopedWindowThrottle(ScopedRateThrottle):
    """ScopedRateThrottle that also understands windows like "10/10s" (docs/API.md rate limits)."""

    def parse_rate(self, rate: str | None) -> tuple[int | None, int | None]:
        if rate is None:
            return None, None
        match = _RATE.match(rate)
        if not match:
            raise ValueError(f"Invalid throttle rate: {rate!r}")
        window = int(match["count"] or 1) * _SECONDS[match["unit"]]
        return int(match["num"]), window
