'use strict';

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql("DELETE FROM welcome_publications WHERE panel_type = 'role_menu'");
  pgm.sql('ALTER TABLE welcome_publications DROP CONSTRAINT IF EXISTS welcome_publications_panel_type_check');
  pgm.sql(`
    ALTER TABLE welcome_publications
    ADD CONSTRAINT welcome_publications_panel_type_check
    CHECK (panel_type IN ('rules'))
  `);
  pgm.dropTable('role_menu_templates', { ifExists: true, cascade: true });
  pgm.sql(`
    UPDATE config
       SET value = value - 'roleMenuChannel' - 'roleMenu'
     WHERE key = 'welcome'
       AND (value ? 'roleMenuChannel' OR value ? 'roleMenu')
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql('ALTER TABLE welcome_publications DROP CONSTRAINT IF EXISTS welcome_publications_panel_type_check');
  pgm.sql(`
    ALTER TABLE welcome_publications
    ADD CONSTRAINT welcome_publications_panel_type_check
    CHECK (panel_type IN ('rules', 'role_menu'))
  `);
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS role_menu_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'custom',
      created_by_guild_id TEXT,
      is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
      is_shared BOOLEAN NOT NULL DEFAULT FALSE,
      options JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  pgm.sql("CREATE UNIQUE INDEX IF NOT EXISTS idx_rmt_name_guild ON role_menu_templates (LOWER(name), COALESCE(created_by_guild_id, '__builtin__'))");
  pgm.sql('CREATE INDEX IF NOT EXISTS idx_rmt_guild ON role_menu_templates(created_by_guild_id)');
  pgm.sql('CREATE INDEX IF NOT EXISTS idx_rmt_shared ON role_menu_templates(is_shared) WHERE is_shared = TRUE');
};
