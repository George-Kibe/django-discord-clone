"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { hasPerm, toggleBit, type PermName } from "@/lib/permissions";
import { cn } from "@/lib/utils";

import { keys, usePermissionInfo, useRoles, type Role, type ServerDetail } from "../../api";
import { roleColor } from "../member-list";

const fail = (e: unknown) =>
  toast.error(e instanceof ApiError ? e.message : "Something went wrong.");

/** Mirrors the API hierarchy rule so the UI doesn't offer what the server would refuse. */
function topPosition(server: ServerDetail, roles: Role[]): number {
  if (server.me.is_owner) return Number.MAX_SAFE_INTEGER;
  return Math.max(
    0,
    ...roles.filter((r) => server.me.role_ids.includes(r.id)).map((r) => r.position),
  );
}

function RoleEditor({
  server,
  role,
  editable,
}: {
  server: ServerDetail;
  role: Role;
  editable: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: info = [] } = usePermissionInfo();
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(roleColor(role.color) ?? "#99aab5");
  const [hoist, setHoist] = useState(Boolean(role.hoist));
  const [permissions, setPermissions] = useState(role.permissions ?? 0);
  const [busy, setBusy] = useState(false);
  const mine = server.me.permissions;

  async function save() {
    setBusy(true);
    try {
      await api.PATCH("/api/v1/servers/{server_id}/roles/{role_id}", {
        params: { path: { server_id: server.id, role_id: role.id } },
        body: role.is_default
          ? { permissions }
          : { name, color: parseInt(color.slice(1), 16), hoist, permissions },
      });
      await queryClient.invalidateQueries({ queryKey: keys.roles(server.id) });
      await queryClient.invalidateQueries({ queryKey: keys.server(server.id) });
      toast.success("Role saved");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5" data-testid="role-editor">
      {!role.is_default ? (
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="grid gap-2">
            <Label htmlFor="role-name">Role name</Label>
            <Input
              id="role-name"
              value={name}
              maxLength={100}
              disabled={!editable}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="role-color">Colour</Label>
            <input
              id="role-color"
              type="color"
              value={color}
              disabled={!editable}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-16 cursor-pointer rounded-md border border-border bg-transparent"
            />
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Switch
              id="role-hoist"
              checked={hoist}
              disabled={!editable}
              onCheckedChange={setHoist}
            />
            <Label htmlFor="role-hoist">Show members with this role separately</Label>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          @everyone applies to every member of the server.
        </p>
      )}
      <fieldset className="grid gap-2" disabled={!editable}>
        <legend className="mb-2 text-sm font-semibold">Permissions</legend>
        {info.map((p) => {
          const perm = p.name as PermName;
          // Members can only grant what they hold (the API enforces this too).
          const grantable =
            server.me.is_owner || hasPerm(mine, "ADMINISTRATOR") || hasPerm(mine, perm);
          return (
            <label
              key={p.name}
              className={cn(
                "flex items-start gap-3 rounded-md p-2 hover:bg-accent/50",
                !grantable && "opacity-50",
              )}
            >
              <Checkbox
                checked={(permissions & p.value) !== 0}
                disabled={!editable || !grantable}
                onCheckedChange={(checked) =>
                  setPermissions((bits) => toggleBit(bits, perm, checked === true))
                }
                aria-describedby={`perm-${p.name}`}
              />
              <span>
                <span className="block text-sm font-medium">
                  {p.name
                    .replaceAll("_", " ")
                    .toLowerCase()
                    .replace(/^\w/, (c) => c.toUpperCase())}
                </span>
                <span id={`perm-${p.name}`} className="block text-xs text-muted-foreground">
                  {p.description}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {editable ? (
        <div>
          <Button type="button" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save role"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          You can only edit roles below your highest role.
        </p>
      )}
    </div>
  );
}

export function RolesTab({ server }: { server: ServerDetail }) {
  const queryClient = useQueryClient();
  const { data: roles = [] } = useRoles(server.id);
  const [selected, setSelected] = useState<string | null>(null);
  const top = topPosition(server, roles);
  const canManage = hasPerm(server.me.permissions, "MANAGE_ROLES");
  const sorted = [...roles].sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
  const ordered = sorted.filter((r) => !r.is_default);
  const current = roles.find((r) => r.id === selected) ?? sorted[0];
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.roles(server.id) });

  async function create() {
    try {
      const { data } = await api.POST("/api/v1/servers/{server_id}/roles", {
        params: { path: { server_id: server.id } },
        body: { name: "new role" },
      });
      if (!data) return;
      // Show the new role's editor right away (refetching first let edits land in the
      // previously selected role's form and get discarded on remount).
      queryClient.setQueryData<Role[]>(keys.roles(server.id), (old = []) => [
        ...old.map((r) =>
          !r.is_default && (r.position ?? 0) >= 1 ? { ...r, position: (r.position ?? 0) + 1 } : r,
        ),
        data,
      ]);
      setSelected(data.id);
      void refresh();
    } catch (e) {
      fail(e);
    }
  }

  async function remove(role: Role) {
    if (!window.confirm(`Delete the ${role.name} role?`)) return;
    try {
      await api.DELETE("/api/v1/servers/{server_id}/roles/{role_id}", {
        params: { path: { server_id: server.id, role_id: role.id } },
      });
      setSelected(null);
      await refresh();
    } catch (e) {
      fail(e);
    }
  }

  async function move(role: Role, delta: -1 | 1) {
    const ids = ordered.map((r) => r.id);
    const index = ids.indexOf(role.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await api.PATCH("/api/v1/servers/{server_id}/roles/reorder", {
        params: { path: { server_id: server.id } },
        body: { role_ids: ids },
      });
      await refresh();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[220px_1fr]">
      <div className="grid content-start gap-1">
        {canManage ? (
          <Button type="button" variant="outline" size="sm" onClick={create} className="mb-2">
            <Plus /> Create role
          </Button>
        ) : null}
        <ul aria-label="Roles" className="grid gap-0.5">
          {sorted.map((role) => {
            const manageable = canManage && (role.is_default || (role.position ?? 0) < top);
            return (
              <li key={role.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelected(role.id)}
                  aria-current={current?.id === role.id}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                    current?.id === role.id && "bg-accent",
                  )}
                >
                  <span
                    className="size-3 shrink-0 rounded-full bg-muted-foreground"
                    style={{ background: roleColor(role.color) }}
                    aria-hidden
                  />
                  <span className="truncate">{role.name}</span>
                </button>
                {manageable && !role.is_default ? (
                  <span className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      className="flex size-6 items-center justify-center rounded hover:bg-accent"
                      aria-label={`Move ${role.name} up`}
                      onClick={() => move(role, -1)}
                    >
                      <ArrowUp className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="flex size-6 items-center justify-center rounded hover:bg-accent"
                      aria-label={`Move ${role.name} down`}
                      onClick={() => move(role, 1)}
                    >
                      <ArrowDown className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="flex size-6 items-center justify-center rounded text-destructive hover:bg-accent"
                      aria-label={`Delete ${role.name}`}
                      onClick={() => remove(role)}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
      {current ? (
        <RoleEditor
          key={current.id}
          server={server}
          role={current}
          editable={canManage && (current.is_default || (current.position ?? 0) < top)}
        />
      ) : null}
    </div>
  );
}
