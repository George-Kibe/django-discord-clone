"use client";

import { LogOut, Settings, UserRound } from "lucide-react";
import Link from "next/link";

import { UserAvatar } from "@/components/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLogout, type Me } from "@/lib/auth/session";

const STATUS_LABEL: Record<Me["status"], string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do not disturb",
  invisible: "Invisible",
};

export function UserPanel({ me }: { me: Me }) {
  const logout = useLogout();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label="Account menu"
        data-testid="user-menu"
      >
        <UserAvatar user={me} className="size-8" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {me.display_name || me.username}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {STATUS_LABEL[me.status]}
          </span>
        </span>
        <Settings className="size-4 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="truncate">@{me.username}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/profile">
            <UserRound aria-hidden /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/account">
            <Settings aria-hidden /> Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => logout.mutate()}
          disabled={logout.isPending}
          data-testid="logout"
        >
          <LogOut aria-hidden /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
