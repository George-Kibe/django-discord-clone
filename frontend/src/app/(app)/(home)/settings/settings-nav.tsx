"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/account", label: "Account" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="flex gap-1 md:flex-col">
      <p className="hidden px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase md:block">
        User settings
      </p>
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={pathname === link.href ? "page" : undefined}
          className={cn(
            "rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
            pathname === link.href && "bg-accent text-foreground",
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
