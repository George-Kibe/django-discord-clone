"use client";

import { MailWarning } from "lucide-react";

import { ResendVerificationButton } from "@/features/auth/components/resend-verification";
import type { Me } from "@/lib/auth/session";

/** FR-AUTH-02: unverified users are reminded until they confirm their email. */
export function VerifyBanner({ me }: { me: Me }) {
  if (me.email_verified) return null;
  return (
    <div
      role="status"
      className="flex flex-col gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm sm:flex-row sm:items-center"
      data-testid="verify-banner"
    >
      <MailWarning className="size-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <p className="flex-1">
        Verify your email address (<strong>{me.email}</strong>) to start chatting. Check your inbox
        for the link.
      </p>
      <div className="sm:w-40">
        <ResendVerificationButton email={me.email} />
      </div>
    </div>
  );
}
