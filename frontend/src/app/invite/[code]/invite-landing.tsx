"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ApiError } from "@/lib/api/errors";
import { api } from "@/lib/api/client";
import { hasSessionHint } from "@/lib/cookies";
import { useAcceptInvite } from "@/features/servers/api";
import { ServerIcon } from "@/features/servers/components/server-icon";

export function InviteLanding() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const accept = useAcceptInvite();
  const preview = useQuery({
    queryKey: ["invites", code],
    retry: false,
    queryFn: async () =>
      (await api.GET("/api/v1/invites/{code}", { params: { path: { code } } })).data,
  });
  const signedIn = typeof window !== "undefined" && hasSessionHint();

  async function join() {
    try {
      const server = await accept.mutateAsync(code);
      router.push(`/channels/${server.id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't join the server.");
    }
  }

  return (
    <Card>
      <CardContent className="grid justify-items-center gap-4 py-8 text-center">
        {preview.isPending ? (
          <p role="status" className="text-muted-foreground">
            Checking invite…
          </p>
        ) : !preview.data ? (
          <div className="grid gap-3" data-testid="invite-invalid">
            <h1 className="text-xl font-semibold">Invite invalid</h1>
            <p className="text-muted-foreground">
              This invite may be expired, or you might need a new link.
            </p>
            <Button asChild variant="outline">
              <Link href="/channels/me">Go home</Link>
            </Button>
          </div>
        ) : (
          <>
            <ServerIcon server={preview.data.server} className="size-20 text-xl" />
            <div className="grid gap-1">
              <p className="text-sm text-muted-foreground">
                {preview.data.inviter
                  ? `${preview.data.inviter.display_name || preview.data.inviter.username} invited you to join`
                  : "You've been invited to join"}
              </p>
              <h1 className="text-2xl font-bold" data-testid="invite-server-name">
                {preview.data.server.name}
              </h1>
              <p className="text-sm text-muted-foreground">
                {preview.data.server.member_count} member
                {preview.data.server.member_count === 1 ? "" : "s"}
              </p>
            </div>
            {signedIn ? (
              <Button className="w-full" onClick={join} disabled={accept.isPending}>
                {accept.isPending ? "Joining…" : "Accept invite"}
              </Button>
            ) : (
              <div className="grid w-full gap-2">
                <Button asChild>
                  <Link href={`/login?next=${encodeURIComponent(`/invite/${code}`)}`}>
                    Sign in to join
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/register">Create an account</Link>
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
