import type { Metadata } from "next";
import { Suspense } from "react";

import { BrandLink } from "@/components/brand";

import { InviteLanding } from "./invite-landing";

export const metadata: Metadata = { title: "You've been invited" };

export default function InvitePage() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="px-4 py-4 sm:px-8">
        <BrandLink />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md">
          <Suspense>
            <InviteLanding />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
