from apps.core.tasks import ping


def test_ping_task_runs_eagerly():
    assert ping.delay().get(timeout=1) == "pong"
