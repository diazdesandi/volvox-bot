import { createHash } from 'node:crypto';
import { warn } from '../../logger.js';

const UNKNOWN_ERROR_MESSAGE = 'Unknown error';

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
 * Produce a safe, human-readable error message from an unknown thrown value.
 * @param {unknown} err - The thrown value to derive a message from.
 * @returns {string} The extracted message: `err.message` for Error objects or objects with a string `message`; `'Unknown error'` for `null`/`undefined` or if string conversion fails; otherwise `String(err)`.
 */
function safeErrorMessage(err) {
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

/**
 * Builds a fixed SQL WHERE clause and its parameter values with a nullable channel predicate.
 * @param {string[]} baseParts - Static base WHERE clause parts (each a predicate fragment).
 * @param {any[]} baseValues - Parameter values corresponding to `baseParts`.
 * @param {string|number|null|undefined} channelFilter - Channel identifier to filter by; falsy values include all channels.
 * @param {'channel_id'} channelColumn - Fixed channel column name. Only `channel_id` is accepted.
 * @returns {{ where: string, values: any[] }} An object with a stable `where` clause and values array containing a nullable channel filter.
 */
export function buildFilteredQuery(baseParts, baseValues, channelFilter, channelColumn) {
  if (channelColumn !== 'channel_id') {
    throw new TypeError('Unsupported channel filter column');
  }

  const values = [...baseValues, channelFilter || null];
  const channelParam = `$${values.length}`;
  const parts = [...baseParts, `(${channelParam}::text IS NULL OR channel_id = ${channelParam})`];
  return { where: parts.join(' AND '), values };
}

/**
 * Parse a value into a valid Date, using the Unix epoch as a fallback.
 *
 * @param {*} value - A Date, timestamp, or other value accepted by the Date constructor.
 * @returns {Date} The parsed Date, or `new Date(0)` if the input could not be parsed.
 */
function normalizeEventDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

/**
 * Create a deterministic short identifier for a recent event row.
 *
 * @param {Object} row - Event row object; should include `type` and may include `actor` and `detail` for stability.
 * @param {Date} timestamp - Timestamp used as part of the stable input for the identifier.
 * @returns {string} A string in the form `<type>-<hex>` where `<hex>` is the first 16 hex characters of a SHA-256 digest of stable event fields.
 */
function buildRecentEventId(row, timestamp) {
  const stableFields = [row.type, timestamp.toISOString(), row.actor || '', row.detail || ''];
  const digest = createHash('sha256')
    .update(JSON.stringify(stableFields))
    .digest('hex')
    .slice(0, 16);
  return `${row.type}-${digest}`;
}

/**
 * Combine, normalize, sort, and format recent message and command rows into a unified feed.
 *
 * Each input row's `ts` is normalized to a Date and `detail` defaults to an empty string.
 * Messages have their detail truncated to 40 characters and formatted as "<actor>: <detail>".
 * Commands are formatted as "`actor` used /`detail`".
 *
 * @param {Array<Object>} messageRows - Rows representing message events; expected to include `type`, `actor`, `detail`, and `ts`.
 * @param {Array<Object>} commandRows - Rows representing command events; expected to include `type`, `actor`, `detail`, and `ts`.
 * @returns {Array<Object>} An array (max 10) of event objects sorted by descending timestamp; each object has `id` (deterministic short identifier), `text` (formatted display string), and `timestamp` (ISO string).
 */
export function formatRecentEvents(messageRows, commandRows) {
  return [...messageRows, ...commandRows]
    .map((row) => ({ ...row, ts: normalizeEventDate(row.ts), detail: row.detail || '' }))
    .sort((a, b) => b.ts.getTime() - a.ts.getTime())
    .slice(0, 10)
    .map((row) => {
      let text = '';
      if (row.type === 'message') {
        const detail = row.detail.length > 40 ? `${row.detail.slice(0, 40)}...` : row.detail;
        text = `${row.actor}: ${detail}`;
      } else {
        text = `${row.actor} used /${row.detail}`;
      }
      return {
        id: buildRecentEventId(row, row.ts),
        text,
        timestamp: row.ts.toISOString(),
      };
    });
}

/**
 * Fetches recent message and command activity for a guild, optionally restricted to a channel, and returns them formatted into a unified, timestamp-sorted feed.
 * @param {import('pg').Pool} dbPool - Database pool used to run the queries.
 * @param {string} guildId - Guild identifier to scope the queries.
 * @param {string|undefined|null} channelFilter - Optional channel id to filter results; pass falsy to include all channels.
 * @returns {Array<Object>} An array of formatted event objects (id, timestamp, text, type), up to 10 items sorted by descending timestamp.
 */
export async function fetchRecentEvents(dbPool, guildId, channelFilter) {
  const { values: activityConvValues } = buildFilteredQuery(
    ['guild_id = $1', "role = 'user'"],
    [guildId],
    channelFilter,
    'channel_id',
  );

  const { values: activityCmdValues } = buildFilteredQuery(
    ['guild_id = $1'],
    [guildId],
    channelFilter,
    'channel_id',
  );

  const [recentMessagesResult, recentCommandsResult] = await Promise.all([
    dbPool
      .query(
        `SELECT
           'message' as type,
           COALESCE(NULLIF(username, ''), '<@' || NULLIF(user_id, '') || '>', 'Unknown user') as actor,
           SUBSTR(content, 1, 41) as detail,
           created_at as ts
         FROM conversations
         WHERE guild_id = $1
           AND role = 'user'
           AND ($2::text IS NULL OR channel_id = $2)
         ORDER BY created_at DESC LIMIT 10`,
        activityConvValues,
      )
      .catch((err) => {
        warn('Recent messages query failed; returning empty recent messages dataset', {
          guild: guildId,
          error: safeErrorMessage(err),
        });
        return { rows: [] };
      }),
    dbPool
      .query(
        `SELECT
           'command' as type,
           COALESCE(command_actor.username, '<@' || NULLIF(command_usage.user_id, '') || '>', 'Unknown user') as actor,
           command_name as detail,
           used_at as ts
         FROM command_usage
         LEFT JOIN LATERAL (
           SELECT username
           FROM conversations
           WHERE conversations.guild_id = command_usage.guild_id
             AND conversations.user_id = command_usage.user_id
             AND conversations.username IS NOT NULL
             AND conversations.username <> ''
           ORDER BY conversations.created_at DESC
           LIMIT 1
         ) command_actor ON TRUE
         WHERE guild_id = $1
           AND ($2::text IS NULL OR channel_id = $2)
         ORDER BY used_at DESC LIMIT 10`,
        activityCmdValues,
      )
      .catch((err) => {
        warn('Recent commands query failed; returning empty recent commands dataset', {
          guild: guildId,
          error: safeErrorMessage(err),
        });
        return { rows: [] };
      }),
  ]);

  return formatRecentEvents(recentMessagesResult.rows, recentCommandsResult.rows);
}

/**
 * Format a Date bucket into a UTC label appropriate for the given interval.
 * @param {Date} bucket - The date to format (treated as UTC).
 * @param {'hour'|'day'|string} interval - If `'hour'`, include the hour in the label; otherwise include only month and day.
 * @returns {string} A localized UTC label (month and day, plus hour when interval is `'hour'`).
 */
export function formatBucketLabel(bucket, interval) {
  if (interval === 'hour') {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
    }).format(bucket);
  }

  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(bucket);
}

/**
 * Builds and returns a comprehensive analytics dataset for a guild over a specified time range.
 *
 * @param {Object} options - Function options.
 * @param {import('pg').Pool} options.dbPool - Database pool used to run queries.
 * @param {Object} options.guild - Guild object (used to resolve channel names).
 * @param {string} options.guildId - Guild identifier.
 * @param {Date} options.from - Start of the primary time range (inclusive).
 * @param {Date} options.to - End of the primary time range (inclusive).
 * @param {'today'|'week'|'month'|'custom'} options.range - Normalized identifier for the selected range.
 * @param {'hour'|'day'} options.interval - Bucket interval for time series buckets.
 * @param {boolean} options.compareMode - If true, include comparison KPIs for the comparison range.
 * @param {Date|null} options.comparisonFrom - Start of the comparison range (required when compareMode is true).
 * @param {Date|null} options.comparisonTo - End of the comparison range (required when compareMode is true).
 * @param {string|null} options.channelFilter - Optional channel ID to scope queries to a single channel.
 * @param {string} options.aiUsageUnavailableSource - Fallback source label when AI usage data is unavailable.
 * @returns {Object} Analytics dataset containing:
 *   - guildId: the requested guild id.
 *   - range: metadata about the requested range (type, from, to, interval, channelId, compare).
 *   - kpis: top-level totals (totalMessages, aiRequests, aiCostUsd, activeUsers).
 *   - messageVolume: time-bucketed message and AI request counts with labels.
 *   - aiUsage: { source, byModel, tokens } where tokens may be null when absent.
 *   - channelActivity: list of channels with message counts.
 *   - topChannels: alias of channelActivity.
 *   - commandUsage: { source, items } with top commands or 'unavailable' source.
 *   - comparison: optional previousRange and kpis when compareMode is enabled.
 *   - heatmap: weekday/hour message counts.
 *   - userEngagement: optional engagement summary (trackedUsers, avgMessagesPerUser, aiResponseRate, peakHour, lifetime reactions) or null when not applicable.
 *   - xpEconomy: optional reputation aggregates (totalUsers, totalXp, avgLevel, maxLevel) or null when not available.
 */
export async function fetchAnalyticsDataset({
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
  aiUsageUnavailableSource,
}) {
  const convBase = ['guild_id = $1', 'created_at >= $2', 'created_at <= $3'];
  const { values: conversationValues } = buildFilteredQuery(
    convBase,
    [guildId, from.toISOString(), to.toISOString()],
    channelFilter,
    'channel_id',
  );

  const hasComparisonRange = compareMode && comparisonFrom && comparisonTo;
  const comparisonConv = hasComparisonRange
    ? buildFilteredQuery(
        convBase,
        [guildId, comparisonFrom.toISOString(), comparisonTo.toISOString()],
        channelFilter,
        'channel_id',
      )
    : null;
  const comparisonConversationValues = comparisonConv?.values ?? null;

  const queryVolume = () =>
    interval === 'hour'
      ? dbPool.query(
          `SELECT
             date_trunc('hour', created_at) AS bucket,
             COUNT(*)::int AS messages,
             COUNT(*) FILTER (WHERE role = 'assistant')::int AS ai_requests
           FROM conversations
           WHERE guild_id = $1
             AND created_at >= $2
             AND created_at <= $3
             AND ($4::text IS NULL OR channel_id = $4)
           GROUP BY 1
           ORDER BY 1 ASC`,
          conversationValues,
        )
      : dbPool.query(
          `SELECT
             date_trunc('day', created_at) AS bucket,
             COUNT(*)::int AS messages,
             COUNT(*) FILTER (WHERE role = 'assistant')::int AS ai_requests
           FROM conversations
           WHERE guild_id = $1
             AND created_at >= $2
             AND created_at <= $3
             AND ($4::text IS NULL OR channel_id = $4)
           GROUP BY 1
           ORDER BY 1 ASC`,
          conversationValues,
        );

  const { values: commandUsageValues } = buildFilteredQuery(
    ['guild_id = $1', 'used_at >= $2', 'used_at <= $3'],
    [guildId, from.toISOString(), to.toISOString()],
    channelFilter,
    'channel_id',
  );

  const { values: aiUsageValues } = buildFilteredQuery(
    ['guild_id = $1', 'created_at >= $2', 'created_at <= $3'],
    [guildId, from.toISOString(), to.toISOString()],
    channelFilter,
    'channel_id',
  );

  const { values: engagementValues } = buildFilteredQuery(
    ['guild_id = $1', 'created_at >= $2', 'created_at <= $3'],
    [guildId, from.toISOString(), to.toISOString()],
    channelFilter,
    'channel_id',
  );

  const [
    kpiResult,
    comparisonKpiResult,
    volumeResult,
    channelResult,
    heatmapResult,
    commandUsageResult,
    userEngagementResult,
    peakHourResult,
    xpEconomyResult,
    aiUsageResult,
  ] = await Promise.all([
    dbPool.query(
      `SELECT
             COUNT(*)::int AS total_messages,
             COUNT(*) FILTER (WHERE role = 'assistant')::int AS ai_requests,
             COUNT(DISTINCT CASE
               WHEN role = 'user' THEN COALESCE('id:' || NULLIF(user_id, ''), 'name:' || NULLIF(username, ''))
             END)::int AS active_users
           FROM conversations
           WHERE guild_id = $1
             AND created_at >= $2
             AND created_at <= $3
             AND ($4::text IS NULL OR channel_id = $4)`,
      conversationValues,
    ),
    comparisonConversationValues
      ? dbPool.query(
          `SELECT
                 COUNT(*)::int AS total_messages,
                 COUNT(*) FILTER (WHERE role = 'assistant')::int AS ai_requests,
                 COUNT(DISTINCT CASE
                   WHEN role = 'user' THEN COALESCE('id:' || NULLIF(user_id, ''), 'name:' || NULLIF(username, ''))
                 END)::int AS active_users
               FROM conversations
               WHERE guild_id = $1
                 AND created_at >= $2
                 AND created_at <= $3
                 AND ($4::text IS NULL OR channel_id = $4)`,
          comparisonConversationValues,
        )
      : Promise.resolve({ rows: [] }),
    queryVolume(),
    dbPool.query(
      `SELECT channel_id, COUNT(*)::int AS messages
           FROM conversations
           WHERE guild_id = $1
             AND created_at >= $2
             AND created_at <= $3
             AND ($4::text IS NULL OR channel_id = $4)
           GROUP BY channel_id
           ORDER BY messages DESC
           LIMIT 10`,
      conversationValues,
    ),
    dbPool.query(
      `SELECT
             EXTRACT(DOW FROM created_at)::int AS day_of_week,
             EXTRACT(HOUR FROM created_at)::int AS hour_of_day,
             COUNT(*)::int AS messages
           FROM conversations
           WHERE guild_id = $1
             AND created_at >= $2
             AND created_at <= $3
             AND ($4::text IS NULL OR channel_id = $4)
             GROUP BY 1, 2
             ORDER BY 1 ASC, 2 ASC`,
      conversationValues,
    ),
    dbPool
      .query(
        `SELECT
               command_name,
               COUNT(*)::int AS uses
             FROM command_usage
             WHERE guild_id = $1
               AND used_at >= $2
               AND used_at <= $3
               AND ($4::text IS NULL OR channel_id = $4)
             GROUP BY command_name
             ORDER BY uses DESC, command_name ASC
             LIMIT 15`,
        commandUsageValues,
      )
      .then((result) => ({ rows: result.rows, available: true }))
      .catch((err) => {
        warn('Command usage query failed; returning empty command usage dataset', {
          guild: guildId,
          error: safeErrorMessage(err),
        });
        return { rows: [], available: false };
      }),
    dbPool
      .query(
        `WITH range_engagement AS (
                 SELECT
                   COUNT(DISTINCT CASE
                     WHEN role = 'user' THEN COALESCE('id:' || NULLIF(user_id, ''), 'name:' || NULLIF(username, ''))
                   END)::int AS tracked_users,
                   COUNT(*) FILTER (WHERE role = 'user')::int AS user_messages
                 FROM conversations
                 WHERE guild_id = $1
                   AND created_at >= $2
                   AND created_at <= $3
                   AND ($4::text IS NULL OR channel_id = $4)
               ),
               lifetime_reactions AS (
                 SELECT
                   COALESCE(SUM(reactions_given), 0)::bigint AS lifetime_reactions_given,
                   COALESCE(SUM(reactions_received), 0)::bigint AS lifetime_reactions_received
                 FROM user_stats
                 WHERE guild_id = $1
               )
               SELECT
                 range_engagement.tracked_users,
                 range_engagement.user_messages,
                 lifetime_reactions.lifetime_reactions_given,
                 lifetime_reactions.lifetime_reactions_received
               FROM range_engagement
               CROSS JOIN lifetime_reactions`,
        engagementValues,
      )
      .then((result) => ({ rows: result.rows, available: true }))
      .catch((err) => {
        warn('Engagement query failed; returning empty engagement dataset', {
          guild: guildId,
          error: safeErrorMessage(err),
        });
        return { rows: [], available: false };
      }),
    dbPool
      .query(
        `SELECT
               EXTRACT(HOUR FROM created_at)::int AS peak_hour,
               COUNT(*)::int as count
             FROM conversations
             WHERE guild_id = $1
               AND created_at >= $2
               AND created_at <= $3
               AND ($4::text IS NULL OR channel_id = $4)
               AND role = 'user'
             GROUP BY 1
             ORDER BY 2 DESC
             LIMIT 1`,
        engagementValues,
      )
      .catch((err) => {
        warn('Peak hour query failed; returning empty peak hour dataset', {
          guild: guildId,
          error: safeErrorMessage(err),
        });
        return { rows: [] };
      }),
    dbPool
      .query(
        `SELECT
               COUNT(*)::int AS total_users,
               COALESCE(SUM(xp), 0)::bigint AS total_xp,
               COALESCE(AVG(level), 0)::float AS avg_level,
               COALESCE(MAX(level), 0)::int AS max_level
             FROM reputation
             WHERE guild_id = $1`,
        [guildId],
      )
      .catch((err) => {
        warn('XP economy query failed; returning empty XP dataset', {
          guild: guildId,
          error: safeErrorMessage(err),
        });
        return { rows: [] };
      }),
    dbPool
      .query(
        `SELECT
               model,
               COUNT(*)::int AS requests,
               COALESCE(SUM(input_tokens), 0)::bigint AS prompt_tokens,
               COALESCE(SUM(output_tokens), 0)::bigint AS completion_tokens,
               COALESCE(SUM(cost_usd), 0)::float AS cost_usd
             FROM ai_usage
             WHERE guild_id = $1
               AND created_at >= $2
               AND created_at <= $3
               AND ($4::text IS NULL OR channel_id = $4)
             GROUP BY model
             ORDER BY requests DESC`,
        aiUsageValues,
      )
      .then((result) => ({ rows: result.rows, available: true }))
      .catch((err) => {
        warn('AI usage query failed; returning empty dataset', {
          guild: guildId,
          error: safeErrorMessage(err),
        });
        return { rows: [], available: false };
      }),
  ]);

  const kpiRow = kpiResult.rows[0] || {
    total_messages: 0,
    ai_requests: 0,
    active_users: 0,
  };

  const engagementRow = userEngagementResult.rows[0] || {
    tracked_users: 0,
    user_messages: 0,
    lifetime_reactions_given: 0,
    lifetime_reactions_received: 0,
  };

  const peakHourRow = peakHourResult.rows[0] || {
    peak_hour: null,
  };

  const comparisonKpiRow = comparisonKpiResult.rows[0] || {
    total_messages: 0,
    ai_requests: 0,
    active_users: 0,
  };

  const volume = volumeResult.rows.map((row) => {
    const bucketDate = new Date(row.bucket);
    return {
      bucket: bucketDate.toISOString(),
      label: formatBucketLabel(bucketDate, interval),
      messages: Number(row.messages || 0),
      aiRequests: Number(row.ai_requests || 0),
    };
  });

  const channelActivity = channelResult.rows.map((row) => {
    const channelName = guild.channels.cache.get(row.channel_id)?.name || row.channel_id;
    return {
      channelId: row.channel_id,
      name: channelName,
      messages: Number(row.messages || 0),
    };
  });

  const heatmap = heatmapResult.rows.map((row) => ({
    dayOfWeek: Number(row.day_of_week || 0),
    hour: Number(row.hour_of_day || 0),
    messages: Number(row.messages || 0),
  }));

  const usageByModel = aiUsageResult.rows.map((row) => ({
    model: row.model,
    requests: Number(row.requests || 0),
    promptTokens: Number(row.prompt_tokens ?? 0),
    completionTokens: Number(row.completion_tokens ?? 0),
    costUsd: Number(row.cost_usd ?? 0),
  }));

  const aiUsageTokens =
    usageByModel.length > 0
      ? {
          prompt: usageByModel.reduce((sum, m) => sum + m.promptTokens, 0),
          completion: usageByModel.reduce((sum, m) => sum + m.completionTokens, 0),
        }
      : { prompt: null, completion: null };

  const aiCostUsd =
    usageByModel.length > 0 ? usageByModel.reduce((sum, m) => sum + m.costUsd, 0) : null;

  const aiUsageSource = aiUsageResult.available === false ? aiUsageUnavailableSource : 'ai_usage';
  const comparisonAiCostUsd = null;

  const commandUsage = commandUsageResult.rows.map((row) => ({
    command: row.command_name,
    uses: Number(row.uses || 0),
  }));
  const engagementAvailable = userEngagementResult.available !== false;
  const trackedUsers = Number(engagementRow.tracked_users || 0);
  const userMessages = Number(engagementRow.user_messages || 0);
  const lifetimeReactionsGiven = Number(engagementRow.lifetime_reactions_given || 0);
  const lifetimeReactionsReceived = Number(engagementRow.lifetime_reactions_received || 0);
  const hasLifetimeReactions = lifetimeReactionsGiven > 0 || lifetimeReactionsReceived > 0;

  return {
    guildId,
    range: {
      type: range,
      from: from.toISOString(),
      to: to.toISOString(),
      interval,
      channelId: channelFilter,
      compare: compareMode,
    },
    kpis: {
      totalMessages: Number(kpiRow.total_messages || 0),
      aiRequests: Number(kpiRow.ai_requests || 0),
      aiCostUsd,
      activeUsers: Number(kpiRow.active_users || 0),
    },
    messageVolume: volume,
    aiUsage: {
      source: aiUsageSource,
      byModel: usageByModel,
      tokens: aiUsageTokens,
    },
    channelActivity,
    topChannels: channelActivity,
    commandUsage: {
      source: commandUsageResult.available ? 'command_usage' : 'unavailable',
      items: commandUsage,
    },
    comparison: hasComparisonRange
      ? {
          previousRange: {
            from: comparisonFrom.toISOString(),
            to: comparisonTo.toISOString(),
          },
          kpis: {
            totalMessages: Number(comparisonKpiRow.total_messages || 0),
            aiRequests: Number(comparisonKpiRow.ai_requests || 0),
            aiCostUsd: comparisonAiCostUsd,
            activeUsers: Number(comparisonKpiRow.active_users || 0),
          },
        }
      : null,
    heatmap,
    userEngagement:
      engagementAvailable && (trackedUsers > 0 || hasLifetimeReactions)
        ? {
            trackedUsers,
            avgMessagesPerUser:
              trackedUsers > 0 ? Number((userMessages / trackedUsers).toFixed(1)) : 0,
            aiResponseRate:
              userMessages > 0 ? Number(((kpiRow.ai_requests / userMessages) * 100).toFixed(1)) : 0,
            peakHour: peakHourRow.peak_hour,
            lifetimeReactionsGiven,
            lifetimeReactionsReceived,
          }
        : null,
    xpEconomy: xpEconomyResult.rows[0]
      ? {
          totalUsers: Number(xpEconomyResult.rows[0].total_users || 0),
          totalXp: Number(xpEconomyResult.rows[0].total_xp || 0),
          avgLevel: Number(Number(xpEconomyResult.rows[0].avg_level || 0).toFixed(1)),
          maxLevel: Number(xpEconomyResult.rows[0].max_level || 0),
        }
      : null,
  };
}

/**
 * Count distinct channels that have assistant (AI) messages within the recent time window.
 * @param {string} guildId - Guild identifier to scope the query.
 * @param {string|null} channelFilter - Optional channel identifier to limit the count to a single channel.
 * @param {number} windowMinutes - Lookback window in minutes used to filter recent assistant activity.
 * @returns {number} The number of distinct channels with assistant activity in the past `windowMinutes` minutes (0 if none).
 */
export async function fetchActiveAiConversations(dbPool, guildId, channelFilter, windowMinutes) {
  const activeAiConversationsResult = await dbPool.query(
    `SELECT COUNT(DISTINCT channel_id)::int AS count
       FROM conversations
       WHERE guild_id = $1
         AND ($2::text IS NULL OR channel_id = $2)
         AND role = 'assistant'
         AND created_at >= NOW() - make_interval(mins => $3)`,
    [guildId, channelFilter || null, windowMinutes],
  );

  return Number(activeAiConversationsResult.rows[0]?.count || 0);
}
