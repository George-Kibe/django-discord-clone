from apps.core.management.commands.export_permissions import render
from apps.core.permissions import Perm


def test_render_contains_every_bit():
    ts = render()
    for perm in Perm:
        assert f"  {perm.name}: {int(perm)}," in ts
    assert "export const DEFAULT_EVERYONE" in ts
