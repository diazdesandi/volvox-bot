import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const migration = require('../../migrations/025_drop-help-topics.cjs');

function createPgm() {
  return {
    dropTable: vi.fn(),
    sql: vi.fn(),
  };
}

describe('025_drop-help-topics migration', () => {
  it('drops help topics and removes help config on migrate up', () => {
    const pgm = createPgm();

    migration.up(pgm);

    expect(pgm.dropTable).toHaveBeenCalledWith('help_topics', {
      ifExists: true,
      cascade: true,
    });
    expect(pgm.sql).toHaveBeenCalledWith("DELETE FROM config WHERE key = 'help'");
  });

  it('restores help topics and default help config on rollback', () => {
    const pgm = createPgm();

    migration.down(pgm);

    const sql = pgm.sql.mock.calls.map(([statement]) => statement).join('\n');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS help_topics');
    expect(sql).toContain('author_id TEXT NOT NULL');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_help_topics_guild');
    expect(sql).toContain('INSERT INTO config (guild_id, key, value)');
    expect(sql).toContain("VALUES ('global', 'help', '{\"enabled\":false}'::jsonb)");
    expect(sql).toContain('ON CONFLICT (guild_id, key) DO NOTHING');
  });
});
