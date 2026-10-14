from apps.core.tasks import ping


def test_ping_task_runs_eagerly():
    assert ping.delay().get(timeout=1) == "pong"


def test_tasks_inherit_the_publishing_request_id():
    from types import SimpleNamespace

    from apps.core.celery_context import (
        _attach_request_id,
        _bind_request_id,
        _unbind_request_id,
    )
    from apps.core.request_id import get_request_id, request_id_var

    token = request_id_var.set("req-123456789")
    headers: dict[str, str] = {}
    _attach_request_id(headers=headers)
    request_id_var.reset(token)
    assert headers == {"request_id": "req-123456789"}

    _bind_request_id(task=SimpleNamespace(request=SimpleNamespace(request_id="req-123456789")))
    assert get_request_id() == "req-123456789"
    _unbind_request_id()
    _bind_request_id(task=SimpleNamespace(request=SimpleNamespace()))  # beat-started task
    assert get_request_id().startswith("task-")
    _unbind_request_id()
    assert get_request_id() == "-"
