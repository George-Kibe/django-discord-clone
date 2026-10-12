"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  FolderPlus,
  Hash,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  Trash2,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { SidebarShell } from "@/components/app/sidebar-shell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MentionBadge } from "@/components/mention-badge";
import { useUnread } from "@/features/realtime/read-states";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { useMe } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { cn } from "@/lib/utils";

import {
  keys,
  useCategories,
  useChannels,
  useLeaveServer,
  type Category,
  type Channel,
  type ServerDetail,
} from "../api";
import { ChannelSettingsDialog } from "./channel-settings-dialog";
import { InviteDialog } from "./invite-dialog";
import { NameDialog } from "./name-dialog";

type Group = { category: Category | null; channels: Channel[] };

export function groupChannels(categories: Category[], channels: Channel[]): Group[] {
  const byCategory = new Map<string | null, Channel[]>();
  for (const channel of [...channels].sort((a, b) => a.position - b.position)) {
    const key = channel.category_id ?? null;
    byCategory.set(key, [...(byCategory.get(key) ?? []), channel]);
  }
  const groups: Group[] = [];
  if (byCategory.has(null)) groups.push({ category: null, channels: byCategory.get(null)! });
  for (const category of [...categories].sort((a, b) => a.position - b.position)) {
    groups.push({ category, channels: byCategory.get(category.id) ?? [] });
  }
  return groups;
}

function ChannelLink({
  channel,
  canManage,
  unread,
  mentions,
}: {
  channel: Channel;
  canManage: boolean;
  unread: boolean;
  mentions: number;
}) {
  const { channelId } = useParams<{ channelId?: string }>();
  const [editing, setEditing] = useState(false);
  const active = channelId === channel.id;
  const showUnread = unread && !active;
  return (
    <li className="group relative">
      <Link
        href={`/channels/${channel.server_id}/${channel.id}`}
        aria-current={active ? "page" : undefined}
        data-unread={showUnread}
        className={cn(
          "relative flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
          active && "bg-accent text-foreground",
          showUnread && "font-semibold text-foreground",
        )}
      >
        {showUnread ? (
          <span
            className="absolute top-1/2 -left-2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-foreground"
            aria-hidden
          />
        ) : null}
        <Hash className="size-4 shrink-0 opacity-70" aria-hidden />
        <span className="truncate">{channel.name}</span>
        {showUnread ? <span className="sr-only">(unread)</span> : null}
        {mentions > 0 && !active ? <MentionBadge count={mentions} /> : null}
      </Link>
      {canManage ? (
        <>
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Edit #${channel.name}`}
            className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
          >
            <Settings className="size-3.5" aria-hidden />
          </button>
          {editing ? (
            <ChannelSettingsDialog channel={channel} open={editing} onOpenChange={setEditing} />
          ) : null}
        </>
      ) : null}
    </li>
  );
}

type DialogName = null | "invite" | "channel" | "category";

function ServerMenu({
  server,
  onOpen,
  onLeave,
}: {
  server: ServerDetail;
  onOpen: (dialog: DialogName) => void;
  onLeave: () => void;
}) {
  const perms = server.me.permissions;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-full w-full items-center justify-between px-4 text-left font-semibold hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        data-testid="server-menu"
      >
        <span className="truncate">{server.name}</span>
        <ChevronDown className="size-4 shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="start">
        {hasPerm(perms, "CREATE_INVITE") ? (
          <DropdownMenuItem onSelect={() => onOpen("invite")}>
            <UserPlus aria-hidden /> Invite people
          </DropdownMenuItem>
        ) : null}
        {server.me.is_owner ||
        (
          [
            "MANAGE_SERVER",
            "MANAGE_ROLES",
            "KICK_MEMBERS",
            "BAN_MEMBERS",
            "VIEW_AUDIT_LOG",
          ] as const
        ).some((p) => hasPerm(perms, p)) ? (
          <DropdownMenuItem asChild>
            <Link href={`/servers/${server.id}/settings`}>
              <Settings aria-hidden /> Server settings
            </Link>
          </DropdownMenuItem>
        ) : null}
        {hasPerm(perms, "MANAGE_CHANNELS") ? (
          <>
            <DropdownMenuItem onSelect={() => onOpen("channel")}>
              <Plus aria-hidden /> Create channel
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onOpen("category")}>
              <FolderPlus aria-hidden /> Create category
            </DropdownMenuItem>
          </>
        ) : null}
        {!server.me.is_owner ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onLeave}>
              <LogOut aria-hidden /> Leave server
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CategoryMenu({ category, serverId }: { category: Category; serverId: string }) {
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.categories(serverId) }),
      queryClient.invalidateQueries({ queryKey: keys.channels(serverId) }),
    ]);

  async function remove() {
    if (!window.confirm(`Delete the ${category.name} category? Its channels are kept.`)) return;
    try {
      await api.DELETE("/api/v1/categories/{category_id}", {
        params: { path: { category_id: category.id } },
      });
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't delete the category.");
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          aria-label={`${category.name} options`}
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <Pencil aria-hidden /> Rename category
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={remove}>
            <Trash2 aria-hidden /> Delete category
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title={`Rename ${category.name}`}
        label="Category name"
        submitLabel="Rename"
        onSubmit={async (name) => {
          await api.PATCH("/api/v1/categories/{category_id}", {
            params: { path: { category_id: category.id } },
            body: { name },
          });
          await refresh();
        }}
      />
    </>
  );
}

function ChannelGroups({
  groups,
  canManage,
  serverId,
  onAddChannel,
}: {
  groups: Group[];
  canManage: boolean;
  serverId: string;
  onAddChannel: (categoryId: string | null) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const { channels: unread, mentions } = useUnread();
  return (
    <nav aria-label="Channels" className="p-2">
      {groups.map(({ category, channels }) => {
        const id = category?.id ?? "uncategorized";
        const isCollapsed = collapsed[id];
        return (
          <section key={id} className="mb-3">
            {category ? (
              <div className="flex items-center pr-1">
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [id]: !c[id] }))}
                  aria-expanded={!isCollapsed}
                  className="flex flex-1 items-center gap-1 px-1 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
                >
                  <ChevronDown
                    className={cn("size-3 transition-transform", isCollapsed && "-rotate-90")}
                    aria-hidden
                  />
                  {category.name}
                </button>
                {canManage ? <CategoryMenu category={category} serverId={serverId} /> : null}
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => onAddChannel(category.id)}
                    aria-label={`Create channel in ${category.name}`}
                    className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="size-4" aria-hidden />
                  </button>
                ) : null}
              </div>
            ) : null}
            {!isCollapsed ? (
              <ul className="grid gap-0.5">
                {channels.map((channel) => (
                  <ChannelLink
                    key={channel.id}
                    channel={channel}
                    canManage={canManage}
                    unread={unread.has(channel.id)}
                    mentions={mentions.get(channel.id) ?? 0}
                  />
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </nav>
  );
}

export function ChannelSidebar({
  server,
  className,
}: {
  server: ServerDetail;
  className?: string;
}) {
  const { data: me } = useMe();
  const { data: channels = [] } = useChannels(server.id);
  const { data: categories = [] } = useCategories(server.id);
  const queryClient = useQueryClient();
  const router = useRouter();
  const leave = useLeaveServer();
  const [dialog, setDialog] = useState<DialogName>(null);
  const [channelCategory, setChannelCategory] = useState<string | null>(null);
  const groups = useMemo(() => groupChannels(categories, channels), [categories, channels]);
  if (!me) return null;

  async function createChannel(name: string) {
    const { data } = await api.POST("/api/v1/servers/{server_id}/channels", {
      params: { path: { server_id: server.id } },
      body: { name, category_id: channelCategory },
    });
    await queryClient.invalidateQueries({ queryKey: keys.channels(server.id) });
    if (data) router.push(`/channels/${server.id}/${data.id}`);
  }

  async function createCategory(name: string) {
    await api.POST("/api/v1/servers/{server_id}/categories", {
      params: { path: { server_id: server.id } },
      body: { name },
    });
    await queryClient.invalidateQueries({ queryKey: keys.categories(server.id) });
  }

  async function leaveServer() {
    if (!window.confirm(`Leave ${server.name}? You'll need a new invite to come back.`)) return;
    try {
      await leave.mutateAsync(server.id);
      router.push("/channels/me");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't leave the server.");
    }
  }

  const open = (name: DialogName) => (o: boolean) => setDialog(o ? name : null);
  return (
    <>
      <SidebarShell
        me={me}
        className={className}
        header={
          <ServerMenu
            server={server}
            onLeave={leaveServer}
            onOpen={(name) => {
              if (name === "channel") setChannelCategory(null);
              setDialog(name);
            }}
          />
        }
      >
        <ChannelGroups
          groups={groups}
          canManage={hasPerm(server.me.permissions, "MANAGE_CHANNELS")}
          serverId={server.id}
          onAddChannel={(categoryId) => {
            setChannelCategory(categoryId);
            setDialog("channel");
          }}
        />
      </SidebarShell>
      <InviteDialog
        serverId={server.id}
        serverName={server.name}
        open={dialog === "invite"}
        onOpenChange={open("invite")}
      />
      <NameDialog
        open={dialog === "channel"}
        onOpenChange={open("channel")}
        title="Create channel"
        label="Channel name"
        prefix="#"
        submitLabel="Create channel"
        onSubmit={createChannel}
      />
      <NameDialog
        open={dialog === "category"}
        onOpenChange={open("category")}
        title="Create category"
        label="Category name"
        submitLabel="Create category"
        onSubmit={createCategory}
      />
    </>
  );
}
