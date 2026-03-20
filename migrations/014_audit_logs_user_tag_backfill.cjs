/**
 * Repair migration for audit_logs schema drift.
 *
 * `001_initial-schema.cjs` created `audit_logs` without `user_tag`.
 * `013_audit_log.cjs` used `ifNotExists`, so existing databases never picked
 * up the new column. This migration makes the table shape match current code.
 */

'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE IF EXISTS audit_logs
    ADD COLUMN IF NOT EXISTS user_tag VARCHAR(100)
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_guild_user
    ON audit_logs(guild_id, user_id)
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE IF EXISTS audit_logs
    DROP COLUMN IF EXISTS user_tag
  `);
};
