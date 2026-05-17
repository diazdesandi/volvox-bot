import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const migration = require('../../migrations/023_drop-github-feed.cjs');

function createPgm() {
  return {
    dropTable: vi.fn(),
    sql: vi.fn(),
  };
}

describe('023_drop-github-feed migration', () => {
  it('drops GitHub feed state and removes GitHub config on migrate up', () => {
    const pgm = createPgm();

    migration.up(pgm);

    expect(pgm.dropTable).toHaveBeenCalledWith('github_feed_state', {
      ifExists: true,
      cascade: true,
    });
    expect(pgm.sql).toHaveBeenCalledWith("DELETE FROM config WHERE key = 'github'");
  });

  it('restores GitHub feed state and default config on rollback', () => {
    const pgm = createPgm();

    migration.down(pgm);

    const sql = pgm.sql.mock.calls.map(([statement]) => statement).join('\n');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS github_feed_state');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_github_feed_guild');
    expect(sql).toContain('INSERT INTO config (guild_id, key, value)');
    expect(sql).toContain(
      'VALUES (\'global\', \'github\', \'{"feed":{"enabled":false,"channelId":null,"repos":[],"events":["pr","issue","release","push"]}}\'::jsonb)',
    );
    expect(sql).toContain('ON CONFLICT (guild_id, key) DO NOTHING');
  });
});
