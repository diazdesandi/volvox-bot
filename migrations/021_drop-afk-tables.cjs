'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.dropTable('afk_pings', { ifExists: true, cascade: true });
  pgm.dropTable('afk_status', { ifExists: true, cascade: true });
  pgm.sql("DELETE FROM config WHERE key = 'afk'");
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS afk_status (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT 'AFK',
      set_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(guild_id, user_id)
    )
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS afk_pings (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      afk_user_id TEXT NOT NULL,
      pinger_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_preview TEXT,
      pinged_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  pgm.sql('CREATE INDEX IF NOT EXISTS idx_afk_pings_user ON afk_pings(guild_id, afk_user_id)');
  pgm.sql(`
    INSERT INTO config (guild_id, key, value)
    VALUES ('global', 'afk', '{"enabled": false}'::jsonb)
    ON CONFLICT (guild_id, key) DO NOTHING
  `);
};
