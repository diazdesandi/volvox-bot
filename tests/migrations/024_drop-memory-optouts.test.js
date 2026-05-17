import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const migration = require('../../migrations/024_drop-memory-optouts.cjs');

function createPgm() {
  return {
    dropTable: vi.fn(),
    sql: vi.fn(),
  };
}

describe('024_drop-memory-optouts migration', () => {
  it('drops memory opt-out data on migrate up', () => {
    const pgm = createPgm();

    migration.up(pgm);

    expect(pgm.dropTable).toHaveBeenCalledWith('memory_optouts', {
      ifExists: true,
      cascade: true,
    });
  });

  it('restores the memory opt-out table on rollback', () => {
    const pgm = createPgm();

    migration.down(pgm);

    const sql = pgm.sql.mock.calls.map(([statement]) => statement).join('\n');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS memory_optouts');
    expect(sql).toContain('user_id TEXT PRIMARY KEY');
    expect(sql).toContain('created_at TIMESTAMPTZ DEFAULT NOW()');
  });
});
