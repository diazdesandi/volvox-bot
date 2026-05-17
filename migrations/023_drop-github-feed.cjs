'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.dropTable('github_feed_state', { ifExists: true, cascade: true });
  pgm.sql("DELETE FROM config WHERE key = 'github'");
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS github_feed_state (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      repo TEXT NOT NULL,
      last_event_id TEXT,
      last_poll_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(guild_id, repo)
    )
  `);
  pgm.sql('CREATE INDEX IF NOT EXISTS idx_github_feed_guild ON github_feed_state(guild_id)');
  pgm.sql(`
    INSERT INTO config (guild_id, key, value)
    VALUES ('global', 'github', '{"feed":{"enabled":false,"channelId":null,"repos":[],"events":["pr","issue","release","push"]}}'::jsonb)
    ON CONFLICT (guild_id, key) DO NOTHING
  `);
};
