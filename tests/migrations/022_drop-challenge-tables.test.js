import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const migration = require('../../migrations/022_drop-challenge-tables.cjs');

function createPgm() {
  return {
    dropTable: vi.fn(),
    sql: vi.fn(),
  };
}

describe('022_drop-challenge-tables migration', () => {
  it('drops challenge solve data and removes challenge config on migrate up', () => {
    const pgm = createPgm();

    migration.up(pgm);

    expect(pgm.dropTable).toHaveBeenCalledWith('challenge_solves', {
      ifExists: true,
      cascade: true,
    });
    expect(pgm.sql).toHaveBeenCalledWith("DELETE FROM config WHERE key = 'challenges'");
  });

  it('restores the challenge solve table and default config row on rollback', () => {
    const pgm = createPgm();

    migration.down(pgm);

    const sql = pgm.sql.mock.calls.map(([statement]) => statement).join('\n');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS challenge_solves');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_challenge_solves_guild');
    expect(sql).toContain('INSERT INTO config (guild_id, key, value)');
    expect(sql).toContain(
      'VALUES (\'global\', \'challenges\', \'{"enabled": false, "channelId": null, "postTime": "09:00", "timezone": "America/New_York"}\'::jsonb)',
    );
    expect(sql).toContain('ON CONFLICT (guild_id, key) DO NOTHING');
  });
});
