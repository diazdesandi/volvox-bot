import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function readRepoFile(...pathSegments) {
  return readFileSync(join(repoRoot, ...pathSegments), 'utf8');
}

describe('Railway build config', () => {
  it('builds the web service from the workspace lockfile', () => {
    const workspaceConfig = readRepoFile('pnpm-workspace.yaml');
    const webDockerfile = readRepoFile('web', 'Dockerfile');
    const webRailwayConfig = readRepoFile('web', 'railway.toml');

    expect(workspaceConfig).toContain('  - "web"');
    expect(workspaceConfig).toContain('allowBuilds:');
    expect(webDockerfile).toContain('COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./');
    expect(webDockerfile).toContain('COPY web/package.json ./web/package.json');
    expect(webDockerfile).toContain('--filter volvox-bot-web');
    expect(webDockerfile).toContain('CMD ["node", "web/server.js"]');
    expect(webDockerfile).toContain('/app/web/.next/static ./web/.next/static');
    expect(webDockerfile).not.toContain('flattening');
    expect(webDockerfile).not.toContain('pnpm install --lockfile-only');
    expect(webDockerfile).not.toContain('printf "packages:');
    expect(webRailwayConfig).toContain('dockerfilePath = "web/Dockerfile"');
  });

  it('passes dashboard telemetry variables into the web Docker build', () => {
    const webDockerfile = readRepoFile('web', 'Dockerfile');
    const buildTimeEnvVars = [
      'NEXT_PUBLIC_DISCORD_CLIENT_ID',
      'NEXT_PUBLIC_SENTRY_DSN',
      'NEXT_PUBLIC_SENTRY_ENVIRONMENT',
      'NEXT_PUBLIC_SENTRY_RELEASE',
      'NEXT_PUBLIC_SENTRY_SEND_DEFAULT_PII',
      'NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE',
      'NEXT_PUBLIC_SENTRY_REPLAYS_SESSION_SAMPLE_RATE',
      'NEXT_PUBLIC_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE',
      'NEXT_PUBLIC_AMPLITUDE_API_KEY',
      'NEXT_PUBLIC_AMPLITUDE_AUTOCAPTURE',
      'SENTRY_DSN',
      'SENTRY_ENVIRONMENT',
      'SENTRY_RELEASE',
      'SENTRY_SEND_DEFAULT_PII',
      'SENTRY_TRACES_SAMPLE_RATE',
      'SENTRY_TRACES_RATE',
      'SENTRY_ORG',
      'SENTRY_PROJECT',
      'SENTRY_AUTH_TOKEN',
    ];

    for (const envVar of buildTimeEnvVars) {
      expect(webDockerfile).toContain(`ARG ${envVar}`);
    }

    const envSentryAuthTokenAssignment = /(^|\n)ENV\b[^\n]*(?:\\\n[^\n]*)*\bSENTRY_AUTH_TOKEN\s*=/;
    expect(webDockerfile).not.toMatch(envSentryAuthTokenAssignment);
  });
});
