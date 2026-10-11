"use client";

import { Home, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { BrandMark } from "@/components/brand";
import { ApiError } from "@/lib/api/errors";
import { useMe } from "@/lib/auth/session";
import { hasSessionHint } from "@/lib/cookies";
import { cn } from "@/lib/utils";

import { UserPanel } from "./user-panel";
import { VerifyBanner } from "./verify-banner";

/**
 * Signed-in chrome: server rail, sidebar with the user panel, main pane.
 * User data is fetched client-side (ADR-022) so expired access tokens refresh silently.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { data: me, error } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const signedOut =
    (error instanceof ApiError && error.status === 401) ||
    (typeof window !== "undefined" && !hasSessionHint());

  useEffect(() => {
    if (signedOut) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [signedOut, router, pathname]);

  if (!me) {
    return (
      <div className="flex min-h-svh items-center justify-center" role="status">
        {error && !signedOut ? (
          <p className="text-destructive">Couldn&apos;t load your account. Refresh to retry.</p>
        ) : (
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-col md:h-svh md:flex-row">
      <nav
        aria-label="Servers"
        className="flex shrink-0 items-center gap-2 bg-sidebar px-3 py-2 md:w-[72px] md:flex-col md:py-3"
      >
        <Link
          href="/channels/me"
          aria-label="Home"
          aria-current={pathname.startsWith("/channels/me") ? "page" : undefined}
          className="rounded-xl transition hover:opacity-90"
        >
          <BrandMark className="size-12 rounded-2xl" />
        </Link>
        <div className="mx-1 h-8 w-px bg-border md:mx-0 md:h-px md:w-8" aria-hidden />
        <button
          type="button"
          disabled
          title="Servers are coming soon"
          className="flex size-12 items-center justify-center rounded-3xl bg-card text-emerald-400 opacity-60"
        >
          <Plus aria-hidden />
          <span className="sr-only">Add a server (coming soon)</span>
        </button>
        <div className="ml-auto md:hidden">
          <UserPanel me={me} />
        </div>
      </nav>

      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card/40 md:flex">
        <div className="flex h-12 items-center border-b border-border px-4 font-semibold">
          Direct messages
        </div>
        <nav aria-label="Navigation" className="grid gap-1 p-2 text-sm">
          <SidebarLink href="/channels/me" icon={<Home className="size-4" aria-hidden />}>
            Home
          </SidebarLink>
        </nav>
        <div className="mt-auto border-t border-border p-2">
          <UserPanel me={me} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:overflow-y-auto">
        <VerifyBanner me={me} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}

function SidebarLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const active = usePathname().startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground",
        active && "bg-accent text-foreground",
      )}
    >
      {icon}
      {children}
    </Link>
  );
}
