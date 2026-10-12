import { cn } from "@/lib/utils";

/** Red pill with a mention count, as on Discord's channel list and server icons. */
export function MentionBadge({ count, className }: { count: number; className?: string }) {
  const label = `${count} mention${count === 1 ? "" : "s"}`;
  return (
    <span
      className={cn(
        "ml-auto min-w-5 rounded-full bg-[#d83c3e] px-1.5 text-center text-xs leading-5 font-bold text-white",
        className,
      )}
      aria-label={label}
      title={label}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
