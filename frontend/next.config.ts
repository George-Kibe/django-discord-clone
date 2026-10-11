import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the production Docker image (docs/DEPLOYMENT.md §4).
  output: "standalone",
  poweredByHeader: false,
  // Django owns trailing slashes (/api/docs/, /admin/); don't let Next redirect them away.
  skipTrailingSlashRedirect: true,
  // Development only: make http://localhost:3000 a complete app by proxying backend paths to
  // Django. In every other environment Caddy routes these (ADR-005).
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const api = process.env.INTERNAL_API_URL ?? "http://api:8000";
    // The trailing-slash variant must come first: ":path*" alone drops the slash, which makes
    // Django redirect back to the slashed URL (an infinite loop).
    return ["api", "ws", "admin", "static"].flatMap((prefix) => [
      { source: `/${prefix}/:path*/`, destination: `${api}/${prefix}/:path*/` },
      { source: `/${prefix}/:path*`, destination: `${api}/${prefix}/:path*` },
    ]);
  },
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
