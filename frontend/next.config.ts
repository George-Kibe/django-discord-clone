import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

/**
 * Content-Security-Policy (NFR-SEC-07, ADR-027). Scripts may only come from this origin;
 * 'unsafe-inline' is needed for Next's inline bootstrap without per-request nonces (which would
 * force dynamic rendering). Images and uploads may also use Cloudinary.
 */
export function contentSecurityPolicy(dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://res.cloudinary.com",
    "media-src 'self' https://res.cloudinary.com",
    "font-src 'self' data:",
    "connect-src 'self' https://api.cloudinary.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy(process.env.NODE_ENV === "development"),
          },
        ],
      },
    ];
  },
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
