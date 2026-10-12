"""Server audit log (FR-MOD-02): who changed what, kept with the server."""

from typing import Any

from .models import ServerAuditEvent

Action = ServerAuditEvent.Action


def record(
    server_id: Any,
    actor: Any,
    action: str,
    *,
    target_type: str = "",
    target_id: Any = "",
    label: str = "",
    changes: dict[str, Any] | None = None,
) -> None:
    ServerAuditEvent.objects.create(
        server_id=server_id,
        actor=actor,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id else "",
        target_label=label[:200],
        changes=_plain(changes or {}),
    )


def _plain(value: Any) -> Any:
    """JSON-safe copy (UUIDs, dates, ...)."""
    import json

    from django.core.serializers.json import DjangoJSONEncoder

    return json.loads(json.dumps(value, cls=DjangoJSONEncoder))
