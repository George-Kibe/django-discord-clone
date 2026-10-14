"use client";

import { BadgeCheck, MailWarning } from "lucide-react";

import { Separator } from "@/components/ui/separator";
import { ResendVerificationButton } from "@/features/auth/components/resend-verification";
import { AccountDangerZone } from "@/features/profile/components/account-danger-zone";
import { EmailChangeForm } from "@/features/profile/components/email-change-form";
import { PasswordChangeForm } from "@/features/profile/components/password-change-form";
import { useMe } from "@/lib/auth/session";

export function AccountSettings() {
  const { data: me } = useMe();
  if (!me) return null;
  return (
    <div className="grid gap-8">
      <section className="grid gap-4" aria-labelledby="email-heading">
        <div>
          <h1 id="email-heading" className="text-xl font-semibold">
            Email
          </h1>
          <p
            className="flex items-center gap-2 text-sm text-muted-foreground"
            data-testid="current-email"
          >
            {me.email}
            {me.email_verified ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                <BadgeCheck className="size-4" aria-hidden /> Verified
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <MailWarning className="size-4" aria-hidden /> Not verified
              </span>
            )}
          </p>
        </div>
        {!me.email_verified ? (
          <div className="sm:w-56">
            <ResendVerificationButton email={me.email} />
          </div>
        ) : null}
        <EmailChangeForm />
      </section>
      <Separator />
      <section className="grid gap-4" aria-labelledby="password-heading">
        <div>
          <h2 id="password-heading" className="text-xl font-semibold">
            Password
          </h2>
          <p className="text-sm text-muted-foreground">
            Changing your password signs you out everywhere else.
          </p>
        </div>
        <PasswordChangeForm />
      </section>
      <Separator />
      <AccountDangerZone />
    </div>
  );
}
