'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.dropTable('reminders', { ifExists: true, cascade: true });
  pgm.sql("DELETE FROM config WHERE key = 'reminders'");
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS reminders (
      id SERIAL PRIMARY KEY,
      guild_id VARCHAR NOT NULL,
      user_id VARCHAR NOT NULL,
      channel_id VARCHAR NOT NULL,
      message TEXT NOT NULL,
      remind_at TIMESTAMPTZ NOT NULL,
      recurring_cron VARCHAR,
      snoozed_count INT NOT NULL DEFAULT 0,
      failed_delivery_count INT NOT NULL DEFAULT 0,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  pgm.sql('CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(remind_at) WHERE completed = false');
  pgm.sql('CREATE INDEX IF NOT EXISTS idx_reminders_user_active ON reminders(guild_id, user_id) WHERE completed = false');
  pgm.sql('CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(guild_id, user_id, completed)');
  pgm.sql(`
    INSERT INTO config (guild_id, key, value)
    VALUES ('global', 'reminders', '{"enabled":false,"maxPerUser":25}'::jsonb)
    ON CONFLICT (guild_id, key) DO NOTHING
  `);
};
