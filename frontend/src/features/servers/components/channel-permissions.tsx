"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { Perm, type PermName } from "@/lib/permissions";
import { PERMISSION_DESCRIPTIONS } from "@/types/permissions";
import { cn } from "@/lib/utils";

import { keys, useMembers, useOverwrites, useRoles, type Channel, type Overwrite } from "../api";
import { displayName } from "./member-list";

/** Permissions that mean something per channel. */
const CHANNEL_PERMS: PermName[] = [
  "VIEW_CHANNEL",
  "SEND_MESSAGES",
  "READ_MESSAGE_HISTORY",
  "ATTACH_FILES",
  "ADD_REACTIONS",
  "CREATE_POLLS",
  "MENTION_EVERYONE",
  "MANAGE_MESSAGES",
  "EXPORT_TRANSCRIPTS",
  "MANAGE_CHANNELS",
];

const LABEL = (p: PermName) =>
  p
    .toLowerCase()
    .split("_")
    .map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

type Target =
  { kind: "role"; id: string; name: string } | { kind: "member"; id: string; name: string };
type State = "deny" | "inherit" | "allow";

function stateOf(o: Overwrite | undefined, perm: PermName): State {
  if (!o) return "inherit";
  if (o.allow & Perm[perm]) return "allow";
  if (o.deny & Perm[perm]) return "deny";
  return "inherit";
}

function TriState({
  perm,
  value,
  onChange,
}: {
  perm: PermName;
  value: State;
  onChange: (state: State) => void;
}) {
  const options: { state: State; label: string; symbol: string }[] = [
    { state: "deny", label: "Deny", symbol: "✕" },
    { state: "inherit", label: "Inherit", symbol: "/" },
    { state: "allow", label: "Allow", symbol: "✓" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={LABEL(perm)}
      className="flex overflow-hidden rounded-md border border-border"
    >
      {options.map((o) => (
        <button
          key={o.state}
          type="button"
          role="radio"
          aria-checked={value === o.state}
          aria-label={o.label}
          title={o.label}
          onClick={() => onChange(o.state)}
          className={cn(
            "flex size-8 items-center justify-center text-sm",
            value === o.state
              ? o.state === "allow"
                ? "bg-[#23a55a] text-white"
                : o.state === "deny"
                  ? "bg-[#d83c3e] text-white"
                  : "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          <span aria-hidden>{o.symbol}</span>
        </button>
      ))}
    </div>
  );
}

/** FR-ROLE-05: per-channel overwrites, plus a one-click "private channel". */
export function ChannelPermissions({ channel }: { channel: Channel }) {
  const queryClient = useQueryClient();
  const { data: overwrites = [] } = useOverwrites(channel.id);
  const { data: roles = [] } = useRoles(channel.server_id);
  const { data: members = [] } = useMembers(channel.server_id);
  const everyone = roles.find((r) => r.is_default);
  const [selected, setSelected] = useState<Target | null>(null);
  const [adding, setAdding] = useState("");

  const overwriteFor = (t: Target) =>
    overwrites.find((o) => (t.kind === "role" ? o.role_id === t.id : o.user_id === t.id));
  const targets: Target[] = [
    ...(everyone ? [{ kind: "role" as const, id: everyone.id, name: "@everyone" }] : []),
    ...roles
      .filter((r) => !r.is_default && overwrites.some((o) => o.role_id === r.id))
      .map((r) => ({ kind: "role" as const, id: r.id, name: r.name })),
    ...members
      .filter((m) => overwrites.some((o) => o.user_id === m.user.id))
      .map((m) => ({ kind: "member" as const, id: m.user.id, name: displayName(m) })),
  ];
  const current = selected ?? targets[0] ?? null;
  const everyoneOverwrite = everyone
    ? overwrites.find((o) => o.role_id === everyone.id)
    : undefined;
  const isPrivate = Boolean(everyoneOverwrite && everyoneOverwrite.deny & Perm.VIEW_CHANNEL);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["channels", channel.id, "overwrites"] });
    await queryClient.invalidateQueries({ queryKey: keys.channels(channel.server_id) });
  };

  async function save(target: Target, allow: number, deny: number) {
    try {
      const existing = overwriteFor(target);
      if (!allow && !deny) {
        if (existing)
          await api.DELETE("/api/v1/channels/{channel_id}/overwrites/{overwrite_id}", {
            params: { path: { channel_id: channel.id, overwrite_id: existing.id } },
          });
      } else {
        await api.PUT("/api/v1/channels/{channel_id}/overwrites", {
          params: { path: { channel_id: channel.id } },
          body: {
            ...(target.kind === "role" ? { role_id: target.id } : { user_id: target.id }),
            allow,
            deny,
          },
        });
      }
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't update permissions.");
    }
  }

  function setState(target: Target, perm: PermName, state: State) {
    const o = overwriteFor(target);
    let allow = (o?.allow ?? 0) & ~Perm[perm];
    let deny = (o?.deny ?? 0) & ~Perm[perm];
    if (state === "allow") allow |= Perm[perm];
    if (state === "deny") deny |= Perm[perm];
    void save(target, allow, deny);
  }

  const addable: { value: string; label: string }[] = [
    ...roles
      .filter((r) => !r.is_default && !overwrites.some((o) => o.role_id === r.id))
      .map((r) => ({ value: `role:${r.id}`, label: `Role: ${r.name}` })),
    ...members
      .filter((m) => !overwrites.some((o) => o.user_id === m.user.id))
      .map((m) => ({ value: `member:${m.user.id}`, label: `Member: ${displayName(m)}` })),
  ];

  function add(value: string) {
    const [kind, id] = value.split(":");
    const name = addable.find((a) => a.value === value)?.label.split(": ")[1] ?? "";
    const target: Target = { kind: kind as "role" | "member", id, name };
    setSelected(target);
    setAdding("");
    // A private channel needs an explicit "view" for whoever should see it.
    if (isPrivate) void save(target, Perm.VIEW_CHANNEL, 0);
  }

  return (
    <div className="grid gap-4" data-testid="channel-permissions">
      <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
        <Label htmlFor="private-channel" className="grid gap-1">
          <span>Private channel</span>
          <span className="text-xs font-normal text-muted-foreground">
            Only the roles and members you add below (and admins) can see it.
          </span>
        </Label>
        <Switch
          id="private-channel"
          checked={isPrivate}
          disabled={!everyone}
          onCheckedChange={(on) => {
            if (!everyone) return;
            const target: Target = { kind: "role", id: everyone.id, name: "@everyone" };
            setState(target, "VIEW_CHANNEL", on ? "deny" : "inherit");
          }}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-[12rem_1fr]">
        <div className="grid content-start gap-1">
          <ul className="grid gap-1" aria-label="Roles and members with overrides">
            {targets.map((t) => (
              <li key={`${t.kind}-${t.id}`}>
                <button
                  type="button"
                  onClick={() => setSelected(t)}
                  aria-current={current?.id === t.id ? "true" : undefined}
                  className={cn(
                    "w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                    current?.id === t.id && "bg-accent font-medium",
                  )}
                >
                  {t.name}
                </button>
              </li>
            ))}
          </ul>
          {addable.length ? (
            <select
              aria-label="Add a role or member"
              value={adding}
              onChange={(e) => e.target.value && add(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">+ Add role or member</option>
              {addable.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        {current ? (
          <div className="grid gap-2">
            <h3 className="text-sm font-semibold">Permissions for {current.name}</h3>
            <ul className="grid gap-2">
              {CHANNEL_PERMS.map((perm) => (
                <li key={perm} className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm">{LABEL(perm)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {PERMISSION_DESCRIPTIONS[perm]}
                    </span>
                  </span>
                  <TriState
                    perm={perm}
                    value={stateOf(overwriteFor(current), perm)}
                    onChange={(state) => setState(current, perm, state)}
                  />
                </li>
              ))}
            </ul>
            {overwriteFor(current) && current.name !== "@everyone" ? (
              <Button
                variant="outline"
                size="sm"
                className="justify-self-start"
                onClick={() => {
                  void save(current, 0, 0);
                  setSelected(null);
                }}
              >
                Remove overrides for {current.name}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
