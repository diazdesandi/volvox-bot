import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const migrationPath = resolve(process.cwd(), 'migrations/024_drop-webhook-notifications.cjs');

function createPgm() {
  return {
    dropTable: vi.fn(),
    sql: vi.fn(),
  };
}

describe('024_drop-webhook-notifications migration', () => {
  it('removes webhook notification tables from the consolidated initial schema', () => {
    const initialSchema = readFileSync(
      resolve(process.cwd(), 'migrations/001_initial-schema.cjs'),
      'utf8',
    );

    expect(initialSchema).not.toContain('webhook_delivery_log');
  });

  it('drops webhook delivery state and notification config on migrate up', () => {
    expect(existsSync(migrationPath)).toBe(true);

    const migration = require(migrationPath);
    const pgm = createPgm();

    migration.up(pgm);

    expect(pgm.dropTable).toHaveBeenCalledWith('webhook_delivery_log', {
      ifExists: true,
      cascade: true,
    });
    expect(pgm.sql).toHaveBeenCalledWith("DELETE FROM config WHERE key = 'notifications'");

    const sql = pgm.sql.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain("WHERE key = 'xp'");
    expect(sql).toContain("action->>'type' <> 'webhook'");
  });

  it('restores delivery state and disabled notification config on rollback', () => {
    expect(existsSync(migrationPath)).toBe(true);

    const migration = require(migrationPath);
    const pgm = createPgm();

    migration.down(pgm);

    const sql = pgm.sql.mock.calls.map(([statement]) => statement).join('\n');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS webhook_delivery_log');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_webhook_delivery_log_guild');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_webhook_delivery_log_endpoint');
    expect(sql).toContain('INSERT INTO config (guild_id, key, value)');
    expect(sql).toContain("VALUES ('global', 'notifications', '{\"webhooks\":[]}'::jsonb)");
    expect(sql).toContain('ON CONFLICT (guild_id, key) DO NOTHING');
  });
});
