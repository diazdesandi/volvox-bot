import path from "node:path";
import { fileURLToPath } from "node:url";
import { withSentryConfig } from "@sentry/nextjs";
import packageJson from "./package.json" with { type: "json" };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getSentryConnectSrcOrigin(dsn) {
  if (!dsn) {
    return null;
  }

  try {
    return new URL(dsn).origin;
  } catch {
    return null;
  }
}

function getAmplitudeConnectSrcOrigin() {
  return "https://api2.amplitude.com";
}

const connectSrc = ["'self'"];
const sentryConnectSrcOrigin = getSentryConnectSrcOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN);

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  if (sentryConnectSrcOrigin) {
    connectSrc.push(sentryConnectSrcOrigin);
  }

  connectSrc.push(
    "https://*.ingest.sentry.io",
    "https://*.ingest.us.sentry.io",
    "https://*.ingest.eu.sentry.io",
  );
}

if (process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY) {
  connectSrc.push(getAmplitudeConnectSrcOrigin());
}

const shouldUploadSentrySourcemaps = process.env.SENTRY_UPLOAD_SOURCEMAPS === "true";
const hasSentryUploadConfig = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);
const enableSentrySourcemapUploads = shouldUploadSentrySourcemaps && hasSentryUploadConfig;

const securityHeaders = [
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    // NOTE: 'unsafe-inline' for scripts is required for Next.js RSC streaming/hydration.
    // When Next.js adds stable nonce support for RSC, upgrade to nonce-based CSP
    // and remove 'unsafe-inline' from script-src.
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' cdn.discordapp.com data:",
      `connect-src ${connectSrc.join(" ")}`,
      "font-src 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1"],
  env: {
    NEXT_PUBLIC_WEB_APP_VERSION: packageJson.version,
  },
  ...(process.env.NODE_ENV !== "production" && {
    turbopack: {
      root: path.join(__dirname, ".."),
    },
  }),
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.discordapp.com",
        pathname: "/{avatars,icons,embed}/**",
      },
    ],
  },
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: enableSentrySourcemapUploads ? process.env.SENTRY_ORG : undefined,
  project: enableSentrySourcemapUploads ? process.env.SENTRY_PROJECT : undefined,
  authToken: enableSentrySourcemapUploads ? process.env.SENTRY_AUTH_TOKEN : undefined,
  silent: !process.env.CI,
  // Keep Railway/CI builds deterministic: source-map uploads require an explicit opt-in and complete upload config.
  sourcemaps: { disable: !enableSentrySourcemapUploads },
  release: { create: enableSentrySourcemapUploads },
  widenClientFileUpload: enableSentrySourcemapUploads,
});
