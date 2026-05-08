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
ENV NEXT_PUBLIC_DISCORD_CLIENT_ID=$NEXT_PUBLIC_DISCORD_CLIENT_ID
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN pnpm build

# Flatten standalone output if nested
RUN if [ -f .next/standalone/server.js ]; then \
      echo "server.js at root"; \
    elif [ -f .next/standalone/web/server.js ]; then \
      echo "server.js nested under web/, flattening..."; \
      cp -a .next/standalone/web/* .next/standalone/; \
      rm -rf .next/standalone/web; \
    else \
      echo "ERROR: server.js not found in standalone output"; \
      find .next/standalone -name server.js; \
      exit 1; \
    fi

# --- Runner ---
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/web/public ./public

# Runtime image serves static build output only; keep copied artifacts read-only.
RUN for path in server.js package.json node_modules; do \
      if [ -e "$path" ]; then chmod -R a-w "$path"; fi; \
    done && \
    find .next -path .next/cache -prune -o -type d -exec chmod 0555 {} + && \
    find .next -path .next/cache -prune -o -type f -exec chmod 0444 {} + && \
    chmod u+w .next && \
    mkdir -p .next/cache && \
    chown -R nextjs:nodejs .next/cache && \
    chmod -R u+rwX,go-rwx .next/cache && \
    chmod 0555 .next && \
    find public -type d -exec chmod 0555 {} + && \
    find public -type f -exec chmod 0444 {} +

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider "http://localhost:${PORT:-3000}/api/health" || exit 1

CMD ["node", "server.js"]
