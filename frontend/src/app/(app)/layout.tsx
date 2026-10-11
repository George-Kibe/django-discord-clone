import { Loader2 } from "lucide-react";
import { Suspense } from "react";

import { AppShell } from "@/components/app/app-shell";

/**
 * The signed-in app is client-rendered (ADR-022) and reads URL data (pathname, params).
 * With Cache Components that must sit inside a Suspense boundary; the fallback is the
 * prerendered static shell.
 */
export default function SignedInLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-svh items-center justify-center" role="status">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
        </div>
      }
    >
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
