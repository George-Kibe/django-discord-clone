"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hasPerm } from "@/lib/permissions";
import { useServer } from "@/features/servers/api";
import { AuditLogTab } from "@/features/servers/components/settings/audit-log-tab";
import { BansTab } from "@/features/servers/components/settings/bans-tab";
import { DangerTab } from "@/features/servers/components/settings/danger-tab";
import { InvitesTab } from "@/features/servers/components/settings/invites-tab";
import { MembersTab } from "@/features/servers/components/settings/members-tab";
import { OverviewTab } from "@/features/servers/components/settings/overview-tab";
import { RolesTab } from "@/features/servers/components/settings/roles-tab";

export function ServerSettings() {
  const { serverId } = useParams<{ serverId: string }>();
  const { data: server, isError } = useServer(serverId);
  if (isError) return <p className="m-auto text-destructive">Couldn&apos;t load this server.</p>;
  if (!server) return <div className="flex-1" role="status" aria-label="Loading" />;

  const perms = server.me.permissions;
  const tabs = [
    {
      id: "overview",
      label: "Overview",
      show: hasPerm(perms, "MANAGE_SERVER"),
      node: <OverviewTab server={server} />,
    },
    {
      id: "roles",
      label: "Roles",
      show: hasPerm(perms, "MANAGE_ROLES"),
      node: <RolesTab server={server} />,
    },
    { id: "members", label: "Members", show: true, node: <MembersTab server={server} /> },
    { id: "invites", label: "Invites", show: true, node: <InvitesTab server={server} /> },
    {
      id: "bans",
      label: "Bans",
      show: hasPerm(perms, "BAN_MEMBERS"),
      node: <BansTab server={server} />,
    },
    {
      id: "audit",
      label: "Audit log",
      show: hasPerm(perms, "VIEW_AUDIT_LOG"),
      node: <AuditLogTab server={server} />,
    },
    {
      id: "danger",
      label: "Ownership",
      show: server.me.is_owner,
      node: <DangerTab server={server} />,
    },
  ].filter((t) => t.show);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-4xl gap-6 px-4 py-6 sm:px-8">
        <div className="flex items-center gap-3">
          <Link
            href={`/channels/${server.id}`}
            className="flex size-9 items-center justify-center rounded-full border border-border hover:bg-accent"
            aria-label="Back to server"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
          <div>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Server settings
            </p>
            <h1 className="text-xl font-semibold" data-testid="settings-server-name">
              {server.name}
            </h1>
          </div>
        </div>
        <Tabs defaultValue={tabs[0]?.id}>
          <TabsList className="flex w-full flex-wrap justify-start">
            {tabs.map((t) => (
              <TabsTrigger key={t.id} value={t.id}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((t) => (
            <TabsContent key={t.id} value={t.id} className="pt-4">
              {t.node}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </main>
  );
}
