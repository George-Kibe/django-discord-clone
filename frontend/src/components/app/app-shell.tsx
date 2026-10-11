"use client";

import { Loader2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ServerRail } from "@/features/servers/components/server-rail";
import { ApiError } from "@/lib/api/errors";
import { useMe } from "@/lib/auth/session";
import { hasSessionHint } from "@/lib/cookies";

import { UserPanel } from "./user-panel";
import { VerifyBanner } from "./verify-banner";

/**
 * Signed-in chrome: the server rail plus whatever the route renders (sidebar + main).
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
    <TooltipProvider delayDuration={200}>
      <div className="flex h-svh flex-col md:flex-row">
        <nav
          aria-label="Servers"
          className="flex shrink-0 items-center gap-2 overflow-x-auto bg-sidebar px-3 py-2 md:w-[72px] md:flex-col md:overflow-x-visible md:overflow-y-auto md:py-3"
        >
          <ServerRail />
          <div className="ml-auto md:hidden">
            <UserPanel me={me} />
          </div>
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <VerifyBanner me={me} />
          <div className="flex min-h-0 flex-1">{children}</div>
        </div>
      </div>
    </TooltipProvider>
  );
}
