'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.dropTable('memory_optouts', { ifExists: true, cascade: true });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS memory_optouts (
      user_id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
};
