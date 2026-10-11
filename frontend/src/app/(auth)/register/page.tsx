import type { Metadata } from "next";
import Link from "next/link";

import { AuthCard } from "@/features/auth/components/auth-card";
import { RegisterForm } from "@/features/auth/components/register-form";

export const metadata: Metadata = { title: "Create an account" };

export default function RegisterPage() {
  return (
    <AuthCard
      title="Create an account"
      description="Join servers and chat in real time."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-brand underline underline-offset-4 hover:no-underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthCard>
  );
}
