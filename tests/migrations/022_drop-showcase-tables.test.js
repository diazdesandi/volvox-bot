import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const migration = require('../../migrations/022_drop-showcase-tables.cjs');

function createPgm() {
  return {
    dropTable: vi.fn(),
    sql: vi.fn(),
  };
}

describe('022_drop-showcase-tables migration', () => {
  it('drops showcase tables and removes showcase config on migrate up', () => {
    const pgm = createPgm();

    migration.up(pgm);

    expect(pgm.dropTable).toHaveBeenCalledWith('showcase_votes', {
      ifExists: true,
      cascade: true,
    });
    expect(pgm.dropTable).toHaveBeenCalledWith('showcases', { ifExists: true, cascade: true });
    expect(pgm.sql).toHaveBeenCalledWith("DELETE FROM config WHERE key = 'showcase'");
  });

  it('restores showcase tables and the default showcase config row on rollback', () => {
    const pgm = createPgm();

    migration.down(pgm);

    const sql = pgm.sql.mock.calls.map(([statement]) => statement).join('\n');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS showcases');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_showcases_guild');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_showcases_author');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS showcase_votes');
    expect(sql).toContain('INSERT INTO config (guild_id, key, value)');
    expect(sql).toContain("VALUES ('global', 'showcase', '{\"enabled\": false}'::jsonb)");
    expect(sql).toContain('ON CONFLICT (guild_id, key) DO NOTHING');
  });
});
