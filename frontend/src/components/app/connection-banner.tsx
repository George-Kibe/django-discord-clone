"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useRealtime } from "@/features/realtime/provider";

const SHOW_AFTER_MS = 1500; // don't flash for a quick reconnect

export function ConnectionBanner() {
  const { status } = useRealtime();
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (status !== "reconnecting") return;
    const timer = window.setTimeout(() => setWaited(true), SHOW_AFTER_MS);
    return () => {
      window.clearTimeout(timer);
      setWaited(false);
    };
  }, [status]);

  if (status !== "reconnecting" || !waited) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-sm font-medium text-black"
      data-testid="connection-banner"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      Connection lost. Reconnecting…
    </div>
  );
}
