import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const migration = require('../../migrations/021_drop-afk-tables.cjs');

function createPgm() {
  return {
    dropTable: vi.fn(),
    sql: vi.fn(),
  };
}

describe('021_drop-afk-tables migration', () => {
  it('drops AFK tables and removes AFK config on migrate up', () => {
    const pgm = createPgm();

    migration.up(pgm);

    expect(pgm.dropTable).toHaveBeenCalledWith('afk_pings', { ifExists: true, cascade: true });
    expect(pgm.dropTable).toHaveBeenCalledWith('afk_status', { ifExists: true, cascade: true });
    expect(pgm.sql).toHaveBeenCalledWith("DELETE FROM config WHERE key = 'afk'");
  });

  it('restores AFK tables and the default AFK config row on rollback', () => {
    const pgm = createPgm();

    migration.down(pgm);

    const sql = pgm.sql.mock.calls.map(([statement]) => statement).join('\n');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS afk_status');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS afk_pings');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_afk_pings_user');
    expect(sql).toContain('INSERT INTO config (guild_id, key, value)');
    expect(sql).toContain("VALUES ('global', 'afk', '{\"enabled\": false}'::jsonb)");
    expect(sql).toContain('ON CONFLICT (guild_id, key) DO NOTHING');
  });
});
