import { cn } from "@/lib/utils";

type State = "ok" | "error" | "pending";

const dotColor: Record<State, string> = {
  ok: "bg-emerald-500",
  error: "bg-red-500",
  pending: "bg-amber-400 animate-pulse",
};

export function StatusPill({
  label,
  state,
  detail,
}: {
  label: string;
  state: State;
  detail: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm"
      data-testid={`status-${label.toLowerCase()}`}
      data-state={state}
    >
      <span className={cn("size-2 rounded-full", dotColor[state])} aria-hidden />
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground">{detail}</span>
    </span>
  );
}
