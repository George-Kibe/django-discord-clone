import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthCard } from "@/features/auth/components/auth-card";
import { VerifyEmail } from "@/features/auth/components/verify-email";

export const metadata: Metadata = { title: "Verify email" };

export default function VerifyEmailPage() {
  return (
    <AuthCard title="Email verification">
      <Suspense>
        <VerifyEmail />
      </Suspense>
    </AuthCard>
  );
}
