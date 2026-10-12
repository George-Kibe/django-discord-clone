"use client";

import { Home, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { MobileSidebar } from "@/components/app/mobile-sidebar";
import { SidebarShell } from "@/components/app/sidebar-shell";
import { DMList } from "@/features/dms/components/dm-list";
import { useMe } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

function NavLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const active = href === "/channels/me" ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
        active && "bg-accent text-foreground",
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

function HomeNav() {
  return (
    <nav aria-label="Home" className="grid gap-1 p-2">
      <NavLink href="/channels/me" icon={<Home className="size-4" aria-hidden />}>
        Home
      </NavLink>
      <NavLink href="/settings" icon={<Settings className="size-4" aria-hidden />}>
        Settings
      </NavLink>
    </nav>
  );
}

export function HomeSidebar() {
  const { data: me } = useMe();
  if (!me) return null;
  const header = <span className="px-4 font-semibold">Home</span>;
  return (
    <>
      <SidebarShell me={me} header={header} className="hidden md:flex">
        <HomeNav />
        <DMList />
      </SidebarShell>
      <div className="absolute top-14 left-2 z-10 md:hidden">
        <MobileSidebar label="navigation">
          <SidebarShell me={me} header={header} className="w-full border-r-0">
            <HomeNav />
            <DMList />
          </SidebarShell>
        </MobileSidebar>
      </div>
    </>
  );
}
