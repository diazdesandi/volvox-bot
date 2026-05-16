exports.up = (pgm) => {
  pgm.dropTable('challenge_solves', { ifExists: true, cascade: true });
  pgm.sql("DELETE FROM config WHERE key = 'challenges'");
};

exports.down = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS challenge_solves (
      guild_id TEXT NOT NULL,
      challenge_date DATE NOT NULL,
      challenge_index INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      solved_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (guild_id, challenge_date, user_id)
    )
  `);
  pgm.sql('CREATE INDEX IF NOT EXISTS idx_challenge_solves_guild ON challenge_solves(guild_id)');
  pgm.sql(`
    INSERT INTO config (guild_id, key, value)
    VALUES ('global', 'challenges', '{"enabled": false, "channelId": null, "postTime": "09:00", "timezone": "America/New_York"}'::jsonb)
    ON CONFLICT (guild_id, key) DO NOTHING
  `);
};
