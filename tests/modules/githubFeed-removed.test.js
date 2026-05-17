import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('removed GitHub feed module', () => {
  it('does not ship the GitHub feed runtime module', () => {
    expect(existsSync(resolve(process.cwd(), 'src/modules/githubFeed.js'))).toBe(false);
  });

  it('does not start or stop GitHub feed polling from the bot entrypoint', () => {
    const indexSource = readFileSync(resolve(process.cwd(), 'src/index.js'), 'utf8');

    expect(indexSource).not.toContain('githubFeed');
    expect(indexSource).not.toContain('startGithubFeed');
    expect(indexSource).not.toContain('stopGithubFeed');
  });
});
