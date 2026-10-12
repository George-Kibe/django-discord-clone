"use client";

import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";

import { isMuted, useMuteSettings, useSetMuted, type MuteTarget } from "../api";

const NOUN: Record<MuteTarget["type"], string> = {
  server: "server",
  channel: "channel",
  dm: "conversation",
};

/** Toggles a mute (FR-PRES-04): no unread markers or broad notifications; direct @mentions
 * and replies still notify. */
export function MuteButton({ target }: { target: MuteTarget }) {
  const { data: settings } = useMuteSettings();
  const setMuted = useSetMuted();
  const muted = isMuted(settings, target);
  const noun = NOUN[target.type];
  return (
    <button
      type="button"
      onClick={() =>
        setMuted.mutate(
          { target, muted: !muted },
          {
            onSuccess: () => toast.success(muted ? `Unmuted this ${noun}.` : `Muted this ${noun}.`),
            onError: () => toast.error("Couldn't change the mute setting."),
          },
        )
      }
      aria-pressed={muted}
      aria-label={muted ? `Unmute ${noun}` : `Mute ${noun}`}
      className="flex size-8 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
      data-testid="mute-button"
    >
      {muted ? <BellOff className="size-4" aria-hidden /> : <Bell className="size-4" aria-hidden />}
    </button>
  );
}
