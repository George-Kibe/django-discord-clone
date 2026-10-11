import { cn } from "@/lib/utils";

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 3).map((w) => w[0]) : [name.slice(0, 2)])
    .join("")
    .toUpperCase();
}

export function ServerIcon({
  server,
  className,
}: {
  server: { name: string; icon_url?: string | null };
  className?: string;
}) {
  return server.icon_url ? (
    // eslint-disable-next-line @next/next/no-img-element -- Cloudinary already serves sized, optimised images
    <img
      src={server.icon_url}
      alt=""
      className={cn("size-12 rounded-2xl object-cover", className)}
    />
  ) : (
    <span
      className={cn(
        "flex size-12 items-center justify-center rounded-2xl bg-card text-sm font-semibold",
        className,
      )}
      aria-hidden
    >
      {initials(server.name)}
    </span>
  );
}
