# syntax=docker/dockerfile:1

# --- Dependencies ---
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/package.json
RUN pnpm config set store-dir /tmp/pnpm-store && \
    pnpm install --frozen-lockfile --prod=false --filter volvox-bot-web... && \
    rm -rf /tmp/pnpm-store

# --- Builder ---
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web ./web
WORKDIR /app/web

ARG NEXT_PUBLIC_DISCORD_CLIENT_ID
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT
ARG NEXT_PUBLIC_SENTRY_RELEASE
ARG NEXT_PUBLIC_SENTRY_SEND_DEFAULT_PII
ARG NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
ARG NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE
ARG NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE
ARG NEXT_PUBLIC_AMPLITUDE_API_KEY
ARG NEXT_PUBLIC_AMPLITUDE_AUTOCAPTURE
ARG SENTRY_DSN
ARG SENTRY_ENVIRONMENT
ARG SENTRY_RELEASE
ARG SENTRY_SEND_DEFAULT_PII
ARG SENTRY_TRACES_SAMPLE_RATE
ARG SENTRY_TRACES_RATE
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG SENTRY_UPLOAD_SOURCEMAPS
# Source map upload can read this during `pnpm build`, but it must not persist as image ENV.
ARG SENTRY_AUTH_TOKEN
ENV NEXT_PUBLIC_DISCORD_CLIENT_ID=$NEXT_PUBLIC_DISCORD_CLIENT_ID \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT \
    NEXT_PUBLIC_SENTRY_RELEASE=$NEXT_PUBLIC_SENTRY_RELEASE \
    NEXT_PUBLIC_SENTRY_SEND_DEFAULT_PII=$NEXT_PUBLIC_SENTRY_SEND_DEFAULT_PII \
    NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=$NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE \
    NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE=$NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE \
    NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE=$NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE \
    NEXT_PUBLIC_AMPLITUDE_API_KEY=$NEXT_PUBLIC_AMPLITUDE_API_KEY \
    NEXT_PUBLIC_AMPLITUDE_AUTOCAPTURE=$NEXT_PUBLIC_AMPLITUDE_AUTOCAPTURE \
    SENTRY_DSN=$SENTRY_DSN \
    SENTRY_ENVIRONMENT=$SENTRY_ENVIRONMENT \
    SENTRY_RELEASE=$SENTRY_RELEASE \
    SENTRY_SEND_DEFAULT_PII=$SENTRY_SEND_DEFAULT_PII \
    SENTRY_TRACES_SAMPLE_RATE=$SENTRY_TRACES_SAMPLE_RATE \
    SENTRY_TRACES_RATE=$SENTRY_TRACES_RATE \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN pnpm build
RUN test -f .next/standalone/web/server.js

# --- Runner ---
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/static ./web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/web/public ./web/public

# Runtime image serves static build output only; keep copied artifacts read-only.
RUN for path in package.json node_modules web/server.js web/package.json web/node_modules; do \
      if [ -e "$path" ]; then chmod -R a-w "$path"; fi; \
    done && \
    find web/.next -path web/.next/cache -prune -o -type d -exec chmod 0555 {} + && \
    find web/.next -path web/.next/cache -prune -o -type f -exec chmod 0444 {} + && \
    chmod u+w web/.next && \
    mkdir -p web/.next/cache && \
    chown -R nextjs:nodejs web/.next/cache && \
    chmod -R u+rwX,go-rwx web/.next/cache && \
    chmod 0555 web/.next && \
    find web/public -type d -exec chmod 0555 {} + && \
    find web/public -type f -exec chmod 0444 {} +

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider "http://localhost:${PORT:-3000}/api/health" || exit 1

CMD ["node", "web/server.js"]
