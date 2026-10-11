"use client";

import type { ReactNode } from "react";

import type { Me } from "@/lib/auth/session";

import { UserPanel } from "./user-panel";

/** Second column (channels / home navigation) with the user panel pinned at the bottom. */
export function SidebarShell({
  header,
  children,
  me,
  className = "",
}: {
  header: ReactNode;
  children: ReactNode;
  me: Me;
  className?: string;
}) {
  return (
    <aside
      className={`flex h-full w-60 shrink-0 flex-col border-r border-border bg-card/40 ${className}`}
    >
      <div className="flex h-12 shrink-0 items-center border-b border-border">{header}</div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      <div className="border-t border-border p-2">
        <UserPanel me={me} />
      </div>
    </aside>
  );
}
