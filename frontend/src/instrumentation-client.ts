import * as Sentry from "@sentry/nextjs";

import { sentryPrivacyOptions } from "@/lib/sentry-options";

// Browser error tracking (NFR-OBS-02). The DSN is inlined at build time; empty = disabled.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  environment: process.env.NEXT_PUBLIC_ENVIRONMENT ?? "development",
  tracesSampleRate: 0,
  ...sentryPrivacyOptions,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
