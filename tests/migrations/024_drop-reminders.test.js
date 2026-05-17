import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const migration = require('../../migrations/024_drop-reminders.cjs');

function createPgm() {
  return {
    dropTable: vi.fn(),
    sql: vi.fn(),
  };
}

describe('024_drop-reminders migration', () => {
  it('drops reminder state and removes reminder config on migrate up', () => {
    const pgm = createPgm();

    migration.up(pgm);

    expect(pgm.dropTable).toHaveBeenCalledWith('reminders', { ifExists: true, cascade: true });
    expect(pgm.sql).toHaveBeenCalledWith("DELETE FROM config WHERE key = 'reminders'");
  });

  it('restores reminder state and default config on rollback', () => {
    const pgm = createPgm();

    migration.down(pgm);

    const sql = pgm.sql.mock.calls.map(([statement]) => statement).join('\n');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS reminders');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_reminders_due');
    expect(sql).toContain('INSERT INTO config (guild_id, key, value)');
    expect(sql).toContain(
      "VALUES ('global', 'reminders', '{\"enabled\":false,\"maxPerUser\":25}'::jsonb)",
    );
    expect(sql).toContain('ON CONFLICT (guild_id, key) DO NOTHING');
  });
});
