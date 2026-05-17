'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.dropTable('webhook_delivery_log', { ifExists: true, cascade: true });
  pgm.sql("DELETE FROM config WHERE key = 'notifications'");
  pgm.sql(`
    UPDATE config
    SET value = jsonb_set(
      jsonb_set(
        value,
        '{defaultActions}',
        COALESCE(
          (
            SELECT jsonb_agg(action)
            FROM jsonb_array_elements(COALESCE(value->'defaultActions', '[]'::jsonb)) AS action
            WHERE action->>'type' <> 'webhook'
          ),
          '[]'::jsonb
        ),
        true
      ),
      '{levelActions}',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_set(
              level_entry,
              '{actions}',
              COALESCE(
                (
                  SELECT jsonb_agg(action)
                  FROM jsonb_array_elements(COALESCE(level_entry->'actions', '[]'::jsonb)) AS action
                  WHERE action->>'type' <> 'webhook'
                ),
                '[]'::jsonb
              ),
              true
            )
          )
          FROM jsonb_array_elements(COALESCE(value->'levelActions', '[]'::jsonb)) AS level_entry
        ),
        '[]'::jsonb
      ),
      true
    )
    WHERE key = 'xp'
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS webhook_delivery_log (
      id SERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      endpoint_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'pending')),
      response_code INTEGER,
      response_body TEXT,
      attempt INTEGER NOT NULL DEFAULT 1,
      delivered_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  pgm.sql(
    'CREATE INDEX IF NOT EXISTS idx_webhook_delivery_log_guild ON webhook_delivery_log(guild_id, delivered_at DESC)',
  );
  pgm.sql(
    'CREATE INDEX IF NOT EXISTS idx_webhook_delivery_log_endpoint ON webhook_delivery_log(endpoint_id, delivered_at DESC)',
  );
  pgm.sql(`
    INSERT INTO config (guild_id, key, value)
    VALUES ('global', 'notifications', '{"webhooks":[]}'::jsonb)
    ON CONFLICT (guild_id, key) DO NOTHING
  `);
};
