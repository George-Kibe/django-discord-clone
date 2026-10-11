"use client";

import { Compass, UsersRound } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useMe } from "@/lib/auth/session";

export function Welcome() {
  const { data: me } = useMe();
  if (!me) return null;
  return (
    <div className="mx-auto grid max-w-2xl gap-8 px-4 py-12 text-center sm:px-8">
      <div className="grid gap-2">
        <h1 className="text-3xl font-bold tracking-tight" data-testid="welcome">
          Welcome, {me.display_name || me.username}!
        </h1>
        <p className="text-muted-foreground">
          Servers, channels and direct messages are on their way. Meanwhile, make your profile
          yours.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-3 rounded-lg border border-border bg-card p-6 text-left">
          <UsersRound className="size-6 text-brand" aria-hidden />
          <h2 className="font-semibold">Set up your profile</h2>
          <p className="text-sm text-muted-foreground">Pick an avatar, a display name and a bio.</p>
          <Button asChild variant="outline" className="mt-auto">
            <Link href="/settings/profile">Edit profile</Link>
          </Button>
        </div>
        <div className="grid gap-3 rounded-lg border border-dashed border-border bg-card p-6 text-left">
          <Compass className="size-6 text-brand" aria-hidden />
          <h2 className="font-semibold">Discover servers</h2>
          <p className="text-sm text-muted-foreground">Browse public communities by topic.</p>
          <Button variant="outline" className="mt-auto" disabled>
            Coming soon
          </Button>
        </div>
      </div>
    </div>
  );
}
