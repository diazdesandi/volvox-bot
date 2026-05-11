import { warn } from '../../logger.js';
import { cacheGetOrSet, TTL } from '../../utils/cache.js';
import {
  fetchActiveAiConversations,
  fetchAnalyticsDataset,
  fetchRecentEvents,
} from '../repositories/analyticsRepository.js';

export const MAX_ANALYTICS_RANGE_DAYS = 90;
export const ACTIVE_CONVERSATION_WINDOW_MINUTES = 15;
export const AI_USAGE_UNAVAILABLE_SOURCE = 'unavailable';
export const ANALYTICS_CACHE_SCHEMA_VERSION = 'v3';

export class AnalyticsRangeValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AnalyticsRangeValidationError';
  }
}

/** Stable fallback used when an arbitrary thrown value cannot be stringified safely. */
export const UNKNOWN_ERROR_MESSAGE = 'Unknown error';

function readStringMessage(err) {
  if (err === null || (typeof err !== 'object' && typeof err !== 'function')) {
    return null;
  }

  try {
    if ('message' in err) {
      const { message } = err;
      if (typeof message === 'string') {
        return message;
      }
    }
  } catch {
    // Ignore hostile accessors and fall back to safe stringification below.
  }

  return null;
}

/**
 * Normalize an error-like value into a human-readable message.
 * @param {*} err - An Error instance or any value to derive a message from.
 * @returns {string} The extracted message for Error instances or objects with a string `message`, otherwise `String(err)` or a stable fallback.
 */
export function getErrorMessage(err) {
  const message = readStringMessage(err);
  if (message !== null) return message;

  if (err == null) {
    return UNKNOWN_ERROR_MESSAGE;
  }

  try {
    return String(err);
  } catch {
    return UNKNOWN_ERROR_MESSAGE;
  }
}

function tryAttachAnalyticsContext(err, context) {
  try {
    err.analyticsContext = context;
    return err.analyticsContext === context;
  } catch {
    return false;
  }
}

/**
 * Attach an analytics context to an error-like value and return an error object with that context.
 * @param {*} err - The value to annotate; if it's an object or function it is annotated in-place when possible, otherwise it is wrapped in a new `Error`.
 * @param {object} context - Analytics context to attach as the `analyticsContext` property.
 * @returns {Error|object} The original error object (annotated) or a new `Error` that wraps the original value, both containing `analyticsContext`.
 */
function attachAnalyticsContext(err, context) {
  if (err !== null && (typeof err === 'object' || typeof err === 'function')) {
    if (tryAttachAnalyticsContext(err, context)) {
      return err;
    }
  }

  const wrapped = new Error(getErrorMessage(err), { cause: err });
  tryAttachAnalyticsContext(wrapped, context);
  return wrapped;
}

/**
 * Parse a string into a Date, returning null for empty, non-string, or invalid inputs.
 * @param {any} value - The input value expected to be a date string.
 * @returns {Date|null} The parsed Date when valid, or `null` when the input is not a non-empty string or does not produce a valid date.
 */
export function parseDateParam(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Parse and validate analytics time range from request query parameters.
 *
 * @param {Object} query - Request query object; may include `range`, `from`, and `to`.
 *   - `range` (string): One of `"today"`, `"week"`, `"month"`, or `"custom"` (case-insensitive). Defaults to `"week"` for missing/unknown values.
 *   - `from` (string): ISO date string required when `range` is `"custom"`.
 *   - `to` (string): ISO date string required when `range` is `"custom"`.
 * @returns {{ from: Date, to: Date, range: 'today'|'week'|'month'|'custom' }} An object with UTC `from` and `to` Date boundaries and the resolved `range` label. For non-custom ranges `to` is the current time and `from` is computed at UTC day precision or offset.
 * @throws {AnalyticsRangeValidationError} If `range` is `"custom"` and `from`/`to` are missing or invalid, if `from` is after `to`, or if the custom range duration exceeds MAX_ANALYTICS_RANGE_DAYS.
 */
function parseAnalyticsRangeUnchecked(query) {
  const now = new Date();
  const rawRange = typeof query.range === 'string' ? query.range.toLowerCase() : 'week';
  const range = ['today', 'week', 'month', 'custom'].includes(rawRange) ? rawRange : 'week';

  if (range === 'custom') {
    const from = parseDateParam(query.from);
    const to = parseDateParam(query.to);

    if (!from || !to) {
      throw new AnalyticsRangeValidationError(
        'Custom range requires valid "from" and "to" query params',
      );
    }
    if (from > to) {
      throw new AnalyticsRangeValidationError('"from" must be before "to"');
    }

    const maxRangeMs = MAX_ANALYTICS_RANGE_DAYS * 24 * 60 * 60 * 1000;
    if (to.getTime() - from.getTime() > maxRangeMs) {
      throw new AnalyticsRangeValidationError(
        `Custom range cannot exceed ${MAX_ANALYTICS_RANGE_DAYS} days`,
      );
    }

    return { from, to, range: 'custom' };
  }

  const from = new Date(now);
  if (range === 'today') {
    from.setUTCHours(0, 0, 0, 0);
  } else if (range === 'month') {
    const utcTime = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() - 30);
    from.setTime(utcTime);
  } else {
    const utcTime = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() - 7);
    from.setTime(utcTime);
  }

  return { from, to: now, range };
}

/**
 * Parse and validate analytics date range parameters from a query object.
 *
 * @param {object} query - Request query parameters; supports `range` (`today`, `week`, `month`, or `custom`) and, for `custom`, `from` and `to` date strings.
 * @returns {{from: Date, to: Date, range: 'today'|'week'|'month'|'custom'}} Parsed date window (`from` and `to` as UTC Dates) and the normalized `range` identifier.
 * @throws {AnalyticsRangeValidationError} When the range or custom `from`/`to` parameters are missing, invalid, or violate allowed constraints.
 */
export function parseAnalyticsRange(query) {
  try {
    return parseAnalyticsRangeUnchecked(query);
  } catch (err) {
    if (err instanceof AnalyticsRangeValidationError) {
      throw err;
    }
    throw new AnalyticsRangeValidationError('Invalid range parameter');
  }
}

/**
 * Selects an aggregation interval ("hour" or "day") for the given time window.
 *
 * If `query.interval` is explicitly "hour" or "day", that value is returned.
 * Otherwise the function returns "hour" when the duration between `from` and `to` is 48 hours or less, and "day" when it is greater than 48 hours.
 *
 * @param {Object} query - Request query object that may contain an `interval` field.
 * @param {Date} from - Start of the time window.
 * @param {Date} to - End of the time window.
 * @returns {'hour'|'day'} `'hour'` when the explicit query interval is "hour" or the window is ≤ 48 hours, `'day'` otherwise.
 */
export function parseAnalyticsInterval(query, from, to) {
  if (query.interval === 'hour' || query.interval === 'day') {
    return query.interval;
  }

  const diffMs = to.getTime() - from.getTime();
  return diffMs <= 48 * 60 * 60 * 1000 ? 'hour' : 'day';
}

/**
 * Determines whether comparison mode is enabled from the request query's `compare` parameter.
 * @param {Object} query - Object containing request query parameters.
 * @returns {boolean} `true` if `query.compare` (trimmed, case-insensitive) is one of: `'1'`, `'true'`, `'yes'`, or `'on'`; `false` otherwise.
 */
export function parseComparisonMode(query) {
  if (typeof query.compare !== 'string') return false;
  const value = query.compare.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

/**
 * Parses and validates a channelId filter from a query object.
 *
 * @param {Object} query - The request query object containing optional filter parameters.
 * @returns {string|null} The trimmed `channelId` if it consists of 1–20 digits, `null` otherwise.
 */
export function parseChannelFilter(query) {
  const channelId = typeof query.channelId === 'string' ? query.channelId.trim() : '';
  return channelId.length > 0 && /^\d{1,20}$/.test(channelId) ? channelId : null;
}

/**
 * Count non-bot members whose join timestamp falls within the inclusive range.
 * @param {Map|Object} membersCache - A collection-like object with a `values()` method that yields member objects.
 * @param {number} fromMs - Start of the range (inclusive) as milliseconds since Unix epoch.
 * @param {number} toMs - End of the range (inclusive) as milliseconds since Unix epoch.
 * @returns {number} The number of non-bot members whose `joinedTimestamp` is between `fromMs` and `toMs`, inclusive.
 */
export function countNewMembersInRange(membersCache, fromMs, toMs) {
  let count = 0;

  for (const member of membersCache.values()) {
    if (member.user?.bot) continue;
    const joinedAt = member.joinedTimestamp;
    if (!joinedAt) continue;
    if (joinedAt >= fromMs && joinedAt <= toMs) count += 1;
  }

  return count;
}

/**
 * Calculate online-member statistics from a members cache.
 * @param {object} membersCache - Iterable collection with a .values() iterator that yields member objects which may include `presence.status`.
 * @returns {{onlineMembers: number|null, membersWithPresence: number}} `onlineMembers` is the count of non-bot members whose `presence.status` is not `'offline'`, or `null` when no non-bot members have presence data; `membersWithPresence` is the count of non-bot members that have any `presence.status`.
 */
export function countOnlineMembers(membersCache) {
  let onlineMemberCount = 0;
  let membersWithPresence = 0;

  for (const member of membersCache.values()) {
    if (member.user?.bot) continue;
    const status = member.presence?.status;
    if (!status) continue;
    membersWithPresence++;
    if (status !== 'offline') onlineMemberCount++;
  }

  return {
    onlineMembers: membersWithPresence > 0 ? onlineMemberCount : null,
    membersWithPresence,
  };
}

/**
 * Construct a deterministic cache key for analytics queries.
 *
 * Builds a string key that encodes schema version, guild, range, interval,
 * whether comparison mode is enabled, an optional channel filter, and a
 * time bucket. For `range === 'custom'` the bucket uses the `from`/`to`
 * ISO timestamps; otherwise the bucket uses the current hour (UTC) from `now`.
 *
 * @param {Object} params
 * @param {string} params.guildId - Guild identifier included in the key.
 * @param {string} params.range - Range identifier (`'today'|'week'|'month'|'custom'`).
 * @param {string} params.interval - Aggregation interval (`'hour'|'day'`).
 * @param {boolean} params.compareMode - When true, key marks comparison mode as enabled.
 * @param {string|null} params.channelFilter - Channel ID filter included in the key, or null/empty for none.
 * @param {Date} params.from - Start of the range; used in the bucket when `range === 'custom'`.
 * @param {Date} params.to - End of the range; used in the bucket when `range === 'custom'`.
 * @param {Date} [params.now=new Date()] - Reference time used to compute the non-custom hour bucket.
 * @returns {string} The composed analytics cache key.
 */
export function buildAnalyticsCacheKey({
  guildId,
  range,
  interval,
  compareMode,
  channelFilter,
  from,
  to,
  now = new Date(),
}) {
  const hourBucket =
    range === 'custom'
      ? `${from.toISOString()}_${to.toISOString()}`
      : now.toISOString().slice(0, 13);

  return `analytics:${ANALYTICS_CACHE_SCHEMA_VERSION}:${guildId}:${range}:${interval}:${
    compareMode ? '1' : '0'
  }:${channelFilter || ''}:${hourBucket}`;
}

/**
 * Fetches and assembles analytics, recent events, and realtime KPIs for a guild based on query parameters.
 *
 * @param {Object} params - Function parameters.
 * @param {Object} params.dbPool - Database pool used to fetch datasets and recent events.
 * @param {Object} params.guild - Guild object (used for member cache and logging context).
 * @param {string} params.guildId - ID of the guild to fetch analytics for.
 * @param {Object} params.query - Query parameters that may include range, from, to, interval, compare, and channelId.
 * @returns {Object} Combined analytics response containing:
 *   - the fetched analytics dataset spread at the top level,
 *   - `recentEvents`: array of recent event records,
 *   - `kpis`: metrics with `newMembers` for the requested window,
 *   - `comparison`: comparison dataset or `null` (when enabled, its `kpis.newMembers` is populated),
 *   - `realtime`: object with `onlineMembers` (number or `null`) and `activeAiConversations` (number or `null`).
 * @throws {AnalyticsRangeValidationError} When the provided range or custom `from`/`to` parameters are invalid.
 * @throws {Error} Errors thrown while fetching or caching analytics or recent events are rethrown with analytics context attached.
 */
export async function getGuildAnalytics({ dbPool, guild, guildId, query }) {
  const { from, to, range } = parseAnalyticsRange(query);
  const interval = parseAnalyticsInterval(query, from, to);
  const compareMode = parseComparisonMode(query);

  const rangeDurationMs = to.getTime() - from.getTime();
  const comparisonTo = compareMode ? new Date(from.getTime() - 1) : null;
  const comparisonFrom = compareMode ? new Date(comparisonTo.getTime() - rangeDurationMs) : null;
  const channelFilter = parseChannelFilter(query);
  const analyticsContext = {
    range,
    from: from.toISOString(),
    to: to.toISOString(),
    interval,
    channelId: channelFilter,
  };

  const analyticsCacheKey = buildAnalyticsCacheKey({
    guildId,
    range,
    interval,
    compareMode,
    channelFilter,
    from,
    to,
  });
  const analyticsTtl = range === 'today' ? TTL.LEADERBOARD : TTL.ANALYTICS;

  let analyticsData;
  try {
    analyticsData = await cacheGetOrSet(
      analyticsCacheKey,
      () =>
        fetchAnalyticsDataset({
          dbPool,
          guild,
          guildId,
          from,
          to,
          range,
          interval,
          compareMode,
          comparisonFrom,
          comparisonTo,
          channelFilter,
          aiUsageUnavailableSource: AI_USAGE_UNAVAILABLE_SOURCE,
        }),
      analyticsTtl,
    );
  } catch (err) {
    throw attachAnalyticsContext(err, analyticsContext);
  }

  const currentNewMembers = countNewMembersInRange(
    guild.members.cache,
    from.getTime(),
    to.getTime(),
  );
  const currentComparisonNewMembers =
    comparisonFrom && comparisonTo
      ? countNewMembersInRange(
          guild.members.cache,
          comparisonFrom.getTime(),
          comparisonTo.getTime(),
        )
      : 0;

  const { onlineMembers } = countOnlineMembers(guild.members.cache);

  const recentEventsCacheKey = `analytics:recent-events:${guildId}:${channelFilter || ''}`;
  let recentEvents;
  try {
    recentEvents = await cacheGetOrSet(
      recentEventsCacheKey,
      () => fetchRecentEvents(dbPool, guildId, channelFilter),
      TTL.CONFIG,
    );
  } catch (err) {
    throw attachAnalyticsContext(err, analyticsContext);
  }

  let activeAiConversations;
  try {
    activeAiConversations = await fetchActiveAiConversations(
      dbPool,
      guildId,
      channelFilter,
      ACTIVE_CONVERSATION_WINDOW_MINUTES,
    );
  } catch (err) {
    warn('Failed to fetch active AI conversations', {
      error: getErrorMessage(err),
      guild: guildId,
    });
    activeAiConversations = null;
  }

  return {
    ...analyticsData,
    recentEvents,
    kpis: {
      ...analyticsData.kpis,
      newMembers: currentNewMembers,
    },
    comparison: analyticsData.comparison
      ? {
          ...analyticsData.comparison,
          kpis: {
            ...analyticsData.comparison.kpis,
            newMembers: currentComparisonNewMembers,
          },
        }
      : null,
    realtime: {
      onlineMembers,
      activeAiConversations,
    },
  };
}
