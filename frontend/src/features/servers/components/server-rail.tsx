"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

import { BrandMark } from "@/components/brand";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useServers } from "../api";
import { AddServerDialog } from "./add-server-dialog";
import { ServerIcon } from "./server-icon";

function RailItem({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          className="group relative flex items-center focus-visible:outline-none"
        >
          <span
            className={cn(
              "absolute -left-3 w-1 rounded-r-full bg-foreground transition-all",
              active ? "h-10" : "h-0 group-hover:h-5",
            )}
            aria-hidden
          />
          <span
            className={cn(
              "overflow-hidden transition-all group-focus-visible:ring-2 group-focus-visible:ring-ring",
              active ? "rounded-2xl" : "rounded-3xl group-hover:rounded-2xl",
            )}
          >
            {children}
          </span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ServerRail() {
  const { data: servers } = useServers();
  const params = useParams<{ serverId?: string }>();
  const pathname = usePathname();
  const home = pathname.startsWith("/channels/me") || pathname.startsWith("/settings");
  return (
    <>
      <RailItem href="/channels/me" label="Home" active={home}>
        <BrandMark className="size-12 rounded-none" />
      </RailItem>
      <div className="mx-1 h-8 w-px bg-border md:mx-0 md:h-px md:w-8" aria-hidden />
      <ul
        className="flex items-center gap-2 md:flex-col"
        aria-label="Your servers"
        data-testid="server-list"
      >
        {servers?.map((server) => (
          <li key={server.id}>
            <RailItem
              href={`/channels/${server.id}`}
              label={server.name}
              active={params.serverId === server.id || pathname.startsWith(`/servers/${server.id}`)}
            >
              <ServerIcon server={server} className="rounded-none" />
            </RailItem>
          </li>
        ))}
      </ul>
      <AddServerDialog />
    </>
  );
}
