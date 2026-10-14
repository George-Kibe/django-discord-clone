"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut, Monitor, Moon, Settings, Sun, UserRound } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { toast } from "sonner";

import { PRESENCE_LABEL, PresenceDot } from "@/components/presence-dot";
import { UserAvatar } from "@/components/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api/client";
import { meQueryKey, useLogout, type Me } from "@/lib/auth/session";

const STATUSES: Me["status"][] = ["online", "idle", "dnd", "invisible"];

function useSetStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (status: Me["status"]) =>
      (await api.PATCH("/api/v1/users/me", { body: { status } })).data,
    onMutate: (status) =>
      queryClient.setQueryData<Me>(meQueryKey, (old) => (old ? { ...old, status } : old)),
    onSuccess: (me) => me && queryClient.setQueryData(meQueryKey, me),
    onError: () => {
      toast.error("Couldn't change your status.");
      void queryClient.invalidateQueries({ queryKey: meQueryKey });
    },
  });
}

/** ``compact``: avatar only (the mobile top bar has no room for the name). */
export function UserPanel({ me, compact = false }: { me: Me; compact?: boolean }) {
  const logout = useLogout();
  const setStatus = useSetStatus();
  const { theme = "dark", setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2 rounded-md p-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label="Account menu"
        data-testid="user-menu"
      >
        <span className="relative shrink-0">
          <UserAvatar user={me} className="size-8" />
          <PresenceDot status={me.status} />
        </span>
        <span className={compact ? "sr-only" : "min-w-0 flex-1"}>
          <span className="block truncate text-sm font-semibold">
            {me.display_name || me.username}
          </span>
          <span className="block truncate text-xs text-muted-foreground" data-testid="my-status">
            {PRESENCE_LABEL[me.status]}
          </span>
        </span>
        {compact ? null : <Settings className="size-4 text-muted-foreground" aria-hidden />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="truncate">@{me.username}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid="status-menu">
            <span className="relative size-4" aria-hidden>
              <PresenceDot status={me.status} className="right-0.5 bottom-0.5 border-0" />
            </span>
            Set status
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={me.status}
              onValueChange={(value) => setStatus.mutate(value as Me["status"])}
            >
              {STATUSES.map((status) => (
                <DropdownMenuRadioItem key={status} value={status}>
                  {PRESENCE_LABEL[status]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid="theme-menu">
            {theme === "light" ? (
              <Sun aria-hidden />
            ) : theme === "system" ? (
              <Monitor aria-hidden />
            ) : (
              <Moon aria-hidden />
            )}
            Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">Match system</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
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
