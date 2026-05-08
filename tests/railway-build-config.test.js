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
    expect(webDockerfile).not.toContain('pnpm install --lockfile-only');
    expect(webDockerfile).not.toContain('printf "packages:');
    expect(webRailwayConfig).toContain('dockerfilePath = "web/Dockerfile"');
  });
});
