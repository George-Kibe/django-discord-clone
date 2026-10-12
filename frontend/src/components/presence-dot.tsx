import { cn } from "@/lib/utils";

export type Presence = "online" | "idle" | "dnd" | "offline" | "invisible";

export const PRESENCE_LABEL: Record<Presence, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do not disturb",
  offline: "Offline",
  invisible: "Invisible",
};

const COLOR: Record<Presence, string> = {
  online: "bg-[#23a55a]",
  idle: "bg-[#f0b232]",
  dnd: "bg-[#f23f43]",
  offline: "bg-[#80848e]",
  invisible: "bg-[#80848e]",
};

/** Status dot drawn over the bottom-right corner of an avatar. */
export function PresenceDot({ status, className }: { status: Presence; className?: string }) {
  return (
    <span
      role="img"
      aria-label={PRESENCE_LABEL[status]}
      data-presence={status}
      className={cn(
        "absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-[3px] border-sidebar",
        COLOR[status],
        className,
      )}
    />
  );
}
