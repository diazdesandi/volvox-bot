/**
 * Audit Log API Routes
 * Paginated, filterable audit log retrieval and export for dashboard consumption.
 *
 * @see https://github.com/VolvoxLLC/volvox-bot/issues/136
 */

import { Router } from 'express';
import { error as logError } from '../../logger.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { parseLimit } from '../utils/pagination.js';
import { requireGuildAdmin, validateGuild } from './guilds.js';

const router = Router();

/** Rate limiter for audit log endpoints — 30 req/min per IP. */
const auditRateLimit = rateLimit({ windowMs: 60 * 1000, max: 30 });

/** Rate limiter for export endpoints — 10 req/min per IP (exports are heavier). */
const exportRateLimit = rateLimit({ windowMs: 60 * 1000, max: 10 });

const CATEGORY_ACTION_PATTERNS = {
  moderation: ['mod.%', 'moderation.%'],
  ai: ['ai_automod.%', 'triage.%'],
  config: ['config.%', 'guild.%'],
  members: ['members.%'],
  tickets: ['tickets.%'],
  temp_roles: ['temp-roles.%', 'tempRoles.%', 'temp_roles.%', 'temprole.%'],
  notifications: ['notifications.%'],
};
const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const AUDIT_USER_TAG_MAX_LENGTH = 128;
const AUDIT_USER_LOOKUP_CONCURRENCY = 5;

/**
 * Helper to get the database pool from app.locals.
 *
 * @param {import('express').Request} req
 * @returns {import('pg').Pool | null}
 */
function getDbPool(req) {
  return req.app.locals.dbPool || null;
}

function normalizeDisplayName(value) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) return null;

  return trimmed.slice(0, AUDIT_USER_TAG_MAX_LENGTH);
}

function getDiscordUserLabel(user) {
  if (!user || typeof user !== 'object') return null;

  return (
    normalizeDisplayName(user.globalName) ||
    normalizeDisplayName(user.global_name) ||
    normalizeDisplayName(user.tag) ||
    normalizeDisplayName(user.username)
  );
}

async function resolveDiscordUserLabel(client, userId) {
  const cachedUser = client?.users?.cache?.get?.(userId);
  const cachedLabel = getDiscordUserLabel(cachedUser);
  if (cachedLabel) return cachedLabel;

  if (typeof client?.users?.fetch !== 'function') return null;

  try {
    return getDiscordUserLabel(await client.users.fetch(userId));
  } catch {
    return null;
  }
}

async function hydrateMissingUserTags(client, rows) {
  const userIds = Array.from(
    new Set(
      rows
        .filter(
          (row) =>
            !normalizeDisplayName(row.user_tag) && DISCORD_SNOWFLAKE_PATTERN.test(row.user_id),
        )
        .map((row) => row.user_id),
    ),
  );

  if (userIds.length === 0) return rows;

  const resolvedLabels = new Map();
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < userIds.length) {
      const userId = userIds[nextIndex];
      nextIndex++;
      const label = await resolveDiscordUserLabel(client, userId);
      if (label) resolvedLabels.set(userId, label);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(AUDIT_USER_LOOKUP_CONCURRENCY, userIds.length) }, worker),
  );

  if (resolvedLabels.size === 0) return rows;

  return rows.map((row) => {
    const resolvedLabel = resolvedLabels.get(row.user_id);
    return resolvedLabel ? { ...row, user_tag: resolvedLabel } : row;
  });
}

/**
 * Normalize a query filter value to a non-empty string.
 * Express query params can be arrays/objects for repeated or nested keys.
 * We ignore non-string values to avoid passing invalid types to pg.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function toFilterString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Build WHERE conditions and params from query filters.
 *
 * @param {string} guildId
 * @param {import('express').Request['query']} query
 * @returns {{ conditions: string[], params: unknown[], paramIndex: number }}
 */
function buildFilters(guildId, query) {
  const conditions = ['guild_id = $1'];
  const params = [guildId];
  let paramIndex = 2;

  const actionFilter = toFilterString(query.action);
  if (actionFilter) {
    conditions.push(`action = $${paramIndex}`);
    params.push(actionFilter);
    paramIndex++;
  }

  const categoryFilter = actionFilter ? null : toFilterString(query.category);
  const actionPatterns = categoryFilter ? CATEGORY_ACTION_PATTERNS[categoryFilter] : null;
  if (actionPatterns) {
    conditions.push(`action LIKE ANY($${paramIndex}::text[])`);
    params.push(actionPatterns);
    paramIndex++;
  }

  const userIdFilter = toFilterString(query.userId);
  if (userIdFilter) {
    conditions.push(`user_id = $${paramIndex}`);
    params.push(userIdFilter);
    paramIndex++;
  }

  const targetIdFilter = toFilterString(query.targetId);
  if (targetIdFilter) {
    conditions.push(`target_id = $${paramIndex}`);
    params.push(targetIdFilter);
    paramIndex++;
  }

  const channelIdFilter = toFilterString(query.channelId);
  if (channelIdFilter) {
    conditions.push(`(
      details->>'channelId' = $${paramIndex}
      OR details->>'sourceChannelId' = $${paramIndex}
      OR details->>'logChannelId' = $${paramIndex}
    )`);
    params.push(channelIdFilter);
    paramIndex++;
  }

  // Guard against array query params — Express can pass string|string[]|undefined
  if (typeof query.startDate === 'string') {
    const start = new Date(query.startDate);
    if (!Number.isNaN(start.getTime())) {
      conditions.push(`created_at >= $${paramIndex}`);
      params.push(start.toISOString());
      paramIndex++;
    }
  }

  if (typeof query.endDate === 'string') {
    const end = new Date(query.endDate);
    if (!Number.isNaN(end.getTime())) {
      conditions.push(`created_at <= $${paramIndex}`);
      params.push(end.toISOString());
      paramIndex++;
    }
  }

  return { conditions, params, paramIndex };
}

/**
 * Escape a value for CSV output.
 * Wraps in double quotes and escapes internal double quotes.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeCsvValue(value) {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // RFC 4180: also check for \r (CRLF) to properly handle Windows line endings
  if (str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialize audit log rows into an RFC 4180-compatible CSV string using a fixed header order.
 *
 * The CSV header and per-row columns are: id, guild_id, user_id, user_tag, action, target_type,
 * target_id, target_tag, details, ip_address, created_at.
 *
 * @param {Object[]} rows - Array of audit log row objects containing the header keys above.
 * @returns {string} CSV text with a header row followed by one line per input row; values are escaped as needed.
 */
export function rowsToCsv(rows) {
  const headers = [
    'id',
    'guild_id',
    'user_id',
    'user_tag',
    'action',
    'target_type',
    'target_id',
    'target_tag',
    'details',
    'ip_address',
    'created_at',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvValue(row[h])).join(','));
  }
  return lines.join('\n');
}

// ─── GET /:id/audit-log ──────────────────────────────────────────────────────

/**
 * GET /:id/audit-log — Paginated audit log with filters.
 *
 * Query params:
 *   action    — Filter by action type (e.g. 'config.update')
 *   userId    — Filter by admin user ID
 *   startDate — ISO timestamp lower bound
 *   endDate   — ISO timestamp upper bound
 *   limit     — Items per page (default 25, max 100)
 *   offset    — Offset for pagination (default 0)
 */
router.get('/:id/audit-log', auditRateLimit, requireGuildAdmin, validateGuild, async (req, res) => {
  const { id: guildId } = req.params;
  const pool = getDbPool(req);
  if (!pool) return res.status(503).json({ error: 'Database not available' });

  const limit = parseLimit(req.query.limit);
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);

  try {
    const { conditions, params, paramIndex } = buildFilters(guildId, req.query);
    const whereClause = conditions.join(' AND ');

    const [countResult, entriesResult] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM audit_logs WHERE ${whereClause}`, params),
      pool.query(
        `SELECT id, guild_id, user_id, user_tag, action, target_type, target_id, target_tag, details, ip_address, created_at
           FROM audit_logs
           WHERE ${whereClause}
           ORDER BY created_at DESC
           LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, limit, offset],
      ),
    ]);

    const entries = await hydrateMissingUserTags(req.app.locals.client, entriesResult.rows);

    res.json({
      entries,
      total: countResult.rows[0].total,
      limit,
      offset,
    });
  } catch (err) {
    logError('Failed to fetch audit log', { guildId, error: err.message });
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// ─── GET /:id/audit-log/export ───────────────────────────────────────────────

/**
 * GET /:id/audit-log/export — Export full filtered audit log as CSV or JSON.
 *
 * Query params:
 *   format    — 'csv' or 'json' (default 'json')
 *   action    — Filter by action type
 *   userId    — Filter by admin user ID
 *   startDate — ISO timestamp lower bound
 *   endDate   — ISO timestamp upper bound
 *   limit     — Max rows to export (default 1000, max 10000)
 */
router.get(
  '/:id/audit-log/export',
  exportRateLimit,
  requireGuildAdmin,
  validateGuild,
  async (req, res) => {
    const { id: guildId } = req.params;
    const pool = getDbPool(req);
    if (!pool) return res.status(503).json({ error: 'Database not available' });

    const format = toFilterString(req.query.format) || 'json';
    if (format !== 'csv' && format !== 'json') {
      return res.status(400).json({ error: 'Invalid format. Use "csv" or "json".' });
    }

    // Allow larger exports — up to 10k rows
    const limit = parseLimit(req.query.limit, 1000, 10000);

    try {
      const { conditions, params, paramIndex } = buildFilters(guildId, req.query);
      const whereClause = conditions.join(' AND ');

      const result = await pool.query(
        `SELECT id, guild_id, user_id, user_tag, action, target_type, target_id, target_tag, details, ip_address, created_at
           FROM audit_logs
           WHERE ${whereClause}
           ORDER BY created_at DESC
           LIMIT $${paramIndex}`,
        [...params, limit],
      );

      const rows = result.rows;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `audit-log-${guildId}-${timestamp}`;

      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        res.send(rowsToCsv(rows));
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
        res.json({
          guildId,
          exportedAt: new Date().toISOString(),
          count: rows.length,
          entries: rows,
        });
      }
    } catch (err) {
      logError('Failed to export audit log', { guildId, error: err.message });
      res.status(500).json({ error: 'Failed to export audit log' });
    }
  },
);

export default router;
