import { MessagesSquare } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground",
        className,
      )}
    >
      <MessagesSquare className="size-5" aria-hidden />
    </span>
  );
}

export function BrandLink() {
  return (
    <Link href="/" className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <BrandMark className="size-8 rounded-lg" />
      <span>Discord Clone</span>
    </Link>
  );
}
