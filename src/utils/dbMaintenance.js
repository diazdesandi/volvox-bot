/**
 * Database Maintenance Utilities
 *
 * Purges stale data to keep the database healthy:
 * - Closed tickets past the retention period
 * - Any other time-bounded cleanup tasks
 *
 * Hook: called from scheduler every 60th tick (once per hour).
 */

import { info, error as logError, warn } from '../logger.js';
import { purgeOldAuditLogs } from '../modules/auditLogger.js';
import { getConfig } from '../modules/config.js';

/**
 * Parse and validate TICKET_RETENTION_DAYS.
 * - Valid non-negative integers (including 0) are used as-is.
 * - NaN, non-finite, or negative values fall back to the default (30 days).
 *
 * @param {string | undefined} raw - Raw env var value
 * @returns {number} Validated retention period in days
 */
function parseRetentionDays(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 30;
}

/** Retention period for closed tickets in days (default: 30) */
const TICKET_RETENTION_DAYS = parseRetentionDays(process.env.TICKET_RETENTION_DAYS);

/**
 * Purge closed tickets older than the configured retention period.
 *
 * @param {import('pg').Pool} pool - Database connection pool
 * @returns {Promise<number>} Number of tickets purged
 */
async function purgeOldTickets(pool) {
  try {
    const result = await pool.query(
      `DELETE FROM tickets
       WHERE status = 'closed'
         AND closed_at < NOW() - make_interval(days => $1)`,
      [TICKET_RETENTION_DAYS],
    );
    const count = result.rowCount ?? 0;
    if (count > 0) {
      info('DB maintenance: purged old closed tickets', {
        count,
        retention_days: TICKET_RETENTION_DAYS,
        source: 'db_maintenance',
      });
    }
    return count;
  } catch (err) {
    // Table may not exist — warn and continue
    if (err.code === '42P01') {
      warn('DB maintenance: tickets table does not exist, skipping', { source: 'db_maintenance' });
      return 0;
    }
    throw err;
  }
}

/**
 * Run all maintenance tasks.
 *
 * @param {import('pg').Pool} pool - Database connection pool
 * @returns {Promise<void>}
 */
export async function runMaintenance(pool) {
  info('DB maintenance: starting routine cleanup', { source: 'db_maintenance' });

  // Audit log retention uses the global config default since purgeOldAuditLogs
  // operates across all guilds in one query. Per-guild overrides are respected
  // when guild-specific purge calls are made from guild config change handlers.
  const auditRetentionDays = getConfig()?.auditLog?.retentionDays ?? 90;

  try {
    await Promise.all([purgeOldTickets(pool), purgeOldAuditLogs(pool, auditRetentionDays)]);
    info('DB maintenance: cleanup complete', { source: 'db_maintenance' });
  } catch (err) {
    logError('DB maintenance: error during cleanup', {
      error: err.message,
      source: 'db_maintenance',
    });
  }
}
