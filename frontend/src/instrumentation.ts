import * as Sentry from "@sentry/nextjs";

import { sentryPrivacyOptions } from "@/lib/sentry-options";

/** Server-side error tracking (NFR-OBS-02). A no-op unless NEXT_PUBLIC_SENTRY_DSN is set. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
      environment: process.env.ENVIRONMENT ?? "development",
      release: process.env.GIT_SHA,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
      ...sentryPrivacyOptions,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
