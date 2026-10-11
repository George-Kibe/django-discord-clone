import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the production Docker image (docs/DEPLOYMENT.md §4).
  output: "standalone",
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  telemetry: false,
  // Browser events go through our own origin so ad-blockers don't drop them.
  tunnelRoute: "/monitoring",
  // Source maps are uploaded only when a token is provided at build time (build.yml secret).
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
