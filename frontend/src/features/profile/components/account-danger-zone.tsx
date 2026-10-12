"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { FormMessage } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { clearSessionHint } from "@/lib/cookies";

/** NFR-PRIV-02 / FR-AUTH-09: take your data with you, or delete the account. */
export function AccountDangerZone() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const router = useRouter();

  async function remove(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.POST("/api/v1/users/me/delete", { body: { password } });
      clearSessionHint();
      queryClient.clear();
      toast.success("Your account was deleted.");
      router.replace("/login");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't delete your account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-4" aria-labelledby="data-heading">
      <div>
        <h2 id="data-heading" className="text-lg font-semibold">
          Your data
        </h2>
        <p className="text-sm text-muted-foreground">
          Download your profile, servers and messages as JSON, or delete your account. Deleted
          accounts can&apos;t be restored; your messages stay, shown as &quot;Deleted User&quot;.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" asChild>
          <a href="/api/v1/users/me/export" download data-testid="download-data">
            <Download /> Download my data
          </a>
        </Button>
        <Button variant="destructive" onClick={() => setOpen(true)} data-testid="delete-account">
          Delete account
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={remove} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>
                This signs you out everywhere and can&apos;t be undone. Transfer or delete servers
                you own first.
              </DialogDescription>
            </DialogHeader>
            {error ? <FormMessage tone="error">{error}</FormMessage> : null}
            <div className="grid gap-1.5">
              <Label htmlFor="delete-password">Password</Label>
              <Input
                id="delete-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="submit" variant="destructive" disabled={busy || !password}>
                Delete my account
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
