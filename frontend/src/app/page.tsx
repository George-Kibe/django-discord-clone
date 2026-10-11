import { MessagesSquare } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { ApiStatus } from "@/components/api-status";
import { RealtimePing } from "@/components/realtime-ping";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-8 px-4 py-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
        <MessagesSquare className="size-8" aria-hidden />
      </div>
      <div className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Discord Clone</h1>
        <p className="text-lg text-muted-foreground">
          Servers, channels, roles and direct messages, all in real time.
        </p>
      </div>

      <section aria-label="System status" className="flex flex-wrap justify-center gap-3">
        <Suspense fallback={<StatusPill label="API" state="pending" detail="checking" />}>
          <ApiStatus />
        </Suspense>
        <RealtimePing />
      </section>

      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/register">Create an account</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    </main>
  );
}
