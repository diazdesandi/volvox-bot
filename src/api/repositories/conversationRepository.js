import { escapeIlike } from '../../utils/escapeIlike.js';

export const CONVERSATION_GAP_MINUTES = 15;
export const MAX_CONVERSATION_DETAIL_MESSAGES = 1000;
export const MAX_CONVERSATION_MEMBERSHIP_HOPS = 1000;

/**
 * Estimate the approximate number of tokens in a text string.
 * @param {string} content - The text to estimate tokens for; may be falsy.
 * @returns {number} Estimated token count; `0` when `content` is falsy.
 */
export function estimateTokens(content) {
  if (!content) return 0;
  return Math.ceil(content.length / 4);
}

/**
 * Splits message rows into conversations per channel using a fixed time gap.
 * @param {Array<Object>} rows - Ordered message rows; each must include at least `id`, `channel_id`, and `created_at`.
 * @returns {Array<Object>} Array of conversation objects sorted by most recent activity. Each conversation has `id` (first message id), `channelId`, `messages` (array of rows), `firstTime` (ms since epoch of first message), and `lastTime` (ms since epoch of last message).
 */
export function groupMessagesIntoConversations(rows) {
  if (!rows || rows.length === 0) return [];

  const gapMs = CONVERSATION_GAP_MINUTES * 60 * 1000;
  const channelGroups = new Map();

  for (const row of rows) {
    const channelId = row.channel_id;
    if (!channelGroups.has(channelId)) {
      channelGroups.set(channelId, []);
    }
    channelGroups.get(channelId).push(row);
  }

  const conversations = [];

  for (const [channelId, messages] of channelGroups) {
    let currentConvo = null;

    for (const msg of messages) {
      const msgTime = new Date(msg.created_at).getTime();

      if (!currentConvo || msgTime - currentConvo.lastTime > gapMs) {
        if (currentConvo) {
          conversations.push(currentConvo);
        }
        currentConvo = {
          id: msg.id,
          channelId,
          messages: [msg],
          firstTime: msgTime,
          lastTime: msgTime,
        };
      } else {
        currentConvo.messages.push(msg);
        currentConvo.lastTime = msgTime;
      }
    }

    if (currentConvo) {
      conversations.push(currentConvo);
    }
  }

  conversations.sort((a, b) => b.lastTime - a.lastTime);

  return conversations;
}

/**
 * Checks whether a string matches the `YYYY-MM-DD` date-only format.
 * @param {string} value - The string to test.
 * @returns {boolean} `true` if `value` matches the `YYYY-MM-DD` pattern, `false` otherwise.
 */
function isDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Build SQL WHERE clause fragments and parameter values for listing conversations scoped to a guild.
 *
 * Supports optional filters on text search, username, channel, and a from/to date range. `search` is escaped and wrapped with `%` for an ILIKE match. If `from` is missing or invalid the function applies a default lower bound of 30 days ago. Date-only `to` strings (`YYYY-MM-DD`) include that full UTC day by using an exclusive next-day upper bound; date-time `to` strings use the exact timestamp as an inclusive upper bound.
 * @param {string} guildId - Guild identifier to be used as the first SQL parameter.
 * @param {Object} query - Filter set.
 * @param {string} [query.search] - Text to match against `content` using `ILIKE '%...%'` (escaped).
 * @param {string} [query.user] - Exact `username` to filter by.
 * @param {string} [query.channel] - Exact `channel_id` to filter by.
 * @param {string} [query.from] - Lower bound for `created_at`; accepts ISO date-time or date-only (`YYYY-MM-DD`) strings.
 * @param {string} [query.to] - Upper bound for `created_at`; accepts ISO date-time or date-only (`YYYY-MM-DD`) strings. Date-only values include the full UTC day via `< nextDayStart`; date-time values use `<= exactTimestamp`.
 * @returns {{whereClause: string, values: Array, paramIndex: number}} An object containing the combined `WHERE` clause (joined with `AND`), the ordered parameter values array, and the last parameter index used.
 */
function buildConversationListFilters(guildId, query = {}) {
  const whereParts = ['guild_id = $1'];
  const values = [guildId];
  let paramIndex = 1;

  if (query.search && typeof query.search === 'string') {
    paramIndex++;
    whereParts.push(`content ILIKE $${paramIndex}`);
    values.push(`%${escapeIlike(query.search)}%`);
  }

  if (query.user && typeof query.user === 'string') {
    paramIndex++;
    whereParts.push(`username = $${paramIndex}`);
    values.push(query.user);
  }

  if (query.channel && typeof query.channel === 'string') {
    paramIndex++;
    whereParts.push(`channel_id = $${paramIndex}`);
    values.push(query.channel);
  }

  let fromFilterApplied = false;
  if (query.from && typeof query.from === 'string') {
    const from = new Date(query.from);
    if (!Number.isNaN(from.getTime())) {
      paramIndex++;
      whereParts.push(`created_at >= $${paramIndex}`);
      values.push(from.toISOString());
      fromFilterApplied = true;
    }
  }

  if (!fromFilterApplied) {
    paramIndex++;
    whereParts.push(`created_at >= $${paramIndex}`);
    values.push(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
  }

  if (query.to && typeof query.to === 'string') {
    const rawTo = query.to.trim();
    const to = new Date(rawTo);
    if (!Number.isNaN(to.getTime())) {
      paramIndex++;
      if (isDateOnly(rawTo)) {
        const nextDay = new Date(to);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        whereParts.push(`created_at < $${paramIndex}`);
        values.push(nextDay.toISOString());
      } else {
        whereParts.push(`created_at <= $${paramIndex}`);
        values.push(to.toISOString());
      }
    }
  }

  return { whereClause: whereParts.join(' AND '), values, paramIndex };
}

/**
 * Retrieve paginated conversation summaries for a guild, grouping messages into conversations by channel and time gaps.
 *
 * @param {Object} options - Query options.
 * @param {string|number} options.guildId - Guild identifier to filter conversations.
 * @param {Object} [options.query] - Optional filters (e.g., search, user, channel, from, to) applied when listing conversations.
 * @param {number} [options.limit=50] - Maximum number of conversation summaries to return.
 * @param {number} [options.offset=0] - Number of conversation summaries to skip.
 * @returns {{ rows: Array<{ id: number, channel_id: string, first_msg_time: string, last_msg_time: string, message_count: number, preview_content: string|null, participant_pairs: string[] }>, total: number }} An object containing the paginated conversation summary rows and the total number of conversations matching the filters.
 */
export async function listConversationSummaries(
  dbPool,
  { guildId, query = {}, limit = 50, offset = 0 },
) {
  const { whereClause, values, paramIndex } = buildConversationListFilters(guildId, query);
  const conversationGapSecondsParam = paramIndex + 1;
  const limitParam = paramIndex + 2;
  const offsetParam = paramIndex + 3;
  values.push(CONVERSATION_GAP_MINUTES * 60, limit, offset);

  const result = await dbPool.query(
    `WITH lag_step AS (
         SELECT
           id, channel_id, username, role, content, created_at, user_id,
           CASE
             WHEN LAG(created_at) OVER (PARTITION BY channel_id ORDER BY created_at, id) IS NULL
               OR EXTRACT(EPOCH FROM (
                    created_at
                    - LAG(created_at) OVER (PARTITION BY channel_id ORDER BY created_at, id)
                  )) > $${conversationGapSecondsParam}
             THEN 1 ELSE 0
           END AS is_conv_start
         FROM conversations
         WHERE ${whereClause}
       ),
       numbered AS (
         SELECT *,
           SUM(is_conv_start)
             OVER (PARTITION BY channel_id ORDER BY created_at, id) AS conv_num
         FROM lag_step
       ),
       summaries AS (
         SELECT
           channel_id,
           conv_num,
           (ARRAY_AGG(id ORDER BY created_at, id))[1]::int   AS id,
           MIN(created_at)                                      AS first_msg_time,
           MAX(created_at)                                      AS last_msg_time,
           COUNT(*)::int                                        AS message_count,
           (ARRAY_AGG(content ORDER BY created_at, id))[1]     AS preview_content,
           ARRAY_AGG(DISTINCT
             COALESCE(username, 'unknown') || ':::' || role || ':::' || COALESCE(user_id, 'unknown')
           )                                                    AS participant_pairs
         FROM numbered
         GROUP BY channel_id, conv_num
       ),
       total_count AS (
         SELECT COUNT(*)::int AS total_conversations
         FROM summaries
       ),
       paged_summaries AS (
         SELECT
           id, channel_id, first_msg_time, last_msg_time,
           message_count, preview_content, participant_pairs
         FROM summaries
         ORDER BY last_msg_time DESC
         LIMIT $${limitParam} OFFSET $${offsetParam}
       )
       SELECT
         paged_summaries.id,
         paged_summaries.channel_id,
         paged_summaries.first_msg_time,
         paged_summaries.last_msg_time,
         paged_summaries.message_count,
         paged_summaries.preview_content,
         paged_summaries.participant_pairs,
         total_count.total_conversations
       FROM total_count
       LEFT JOIN paged_summaries ON TRUE
       ORDER BY paged_summaries.last_msg_time DESC`,
    values,
  );

  const rows = result.rows.filter((row) => row.id !== null);

  return {
    rows,
    total: result.rows[0]?.total_conversations ?? 0,
  };
}

/**
 * Compute aggregated conversation statistics for a guild.
 * @param {string|number} guildId - Guild identifier to scope the statistics.
 * @returns {Object} An object containing conversation metrics for the guild.
 * @returns {number} returns.totalConversations - Total number of conversations detected using the conversation gap threshold.
 * @returns {number} returns.totalMessages - Total number of messages in the guild.
 * @returns {number} returns.avgMessagesPerConversation - Rounded average number of messages per conversation (0 when there are no conversations).
 * @returns {{username: string|null, messageCount: number}[]} returns.topUsers - Top 10 users by message count (username may be null).
 * @returns {{date: string, count: number}[]} returns.dailyActivity - Daily message counts for recent days (entries include `date` and `count`).
 * @returns {number} returns.estimatedTokens - Estimated total tokens derived from total characters (ceil(totalChars / 4)).
 */
export async function fetchConversationStats(dbPool, guildId) {
  const [totalResult, topUsersResult, dailyResult, tokenResult] = await Promise.all([
    dbPool.query('SELECT COUNT(*)::int AS total_messages FROM conversations WHERE guild_id = $1', [
      guildId,
    ]),
    dbPool.query(
      `SELECT username, COUNT(*)::int AS message_count
           FROM conversations
           WHERE guild_id = $1 AND username IS NOT NULL
           GROUP BY username
           ORDER BY message_count DESC
           LIMIT 10`,
      [guildId],
    ),
    dbPool.query(
      `SELECT DATE(created_at) AS date, COUNT(*)::int AS count
           FROM conversations
           WHERE guild_id = $1 AND created_at >= $2::date
           GROUP BY DATE(created_at)
           ORDER BY date DESC
           LIMIT 30`,
      [guildId, new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)],
    ),
    dbPool.query(
      'SELECT COALESCE(SUM(LENGTH(content)), 0)::bigint AS total_chars FROM conversations WHERE guild_id = $1',
      [guildId],
    ),
  ]);

  const totalMessages = totalResult.rows[0]?.total_messages || 0;
  const totalChars = Number(tokenResult.rows[0]?.total_chars || 0);

  const convoCountResult = await dbPool.query(
    `SELECT COUNT(*)::int AS total_conversations FROM (
         SELECT CASE
           WHEN created_at - LAG(created_at) OVER (
             PARTITION BY channel_id ORDER BY created_at
           ) > ($2 * interval '1 minute')
           OR LAG(created_at) OVER (
             PARTITION BY channel_id ORDER BY created_at
           ) IS NULL
           THEN 1 ELSE NULL END AS is_start
         FROM conversations
         WHERE guild_id = $1
       ) sub WHERE is_start = 1`,
    [guildId, CONVERSATION_GAP_MINUTES],
  );

  const totalConversations = convoCountResult.rows[0]?.total_conversations || 0;
  const avgMessagesPerConversation =
    totalConversations > 0 ? Math.round(totalMessages / totalConversations) : 0;

  return {
    totalConversations,
    totalMessages,
    avgMessagesPerConversation,
    topUsers: topUsersResult.rows.map((r) => ({
      username: r.username,
      messageCount: r.message_count,
    })),
    dailyActivity: dailyResult.rows.map((r) => ({
      date: r.date,
      count: r.count,
    })),
    estimatedTokens: Math.ceil(totalChars / 4),
  };
}

/**
 * Retrieve paginated flagged messages and the total number of matching flags for a guild.
 *
 * @param {object} dbPool - Database pool/connection used to run queries.
 * @param {string} guildId - Guild identifier to filter flagged messages.
 * @param {('open'|'resolved'|'dismissed')|undefined} status - Optional flag status filter.
 * @param {number} limit - Maximum number of flag rows to return.
 * @param {number} offset - Number of flag rows to skip (for pagination).
 * @returns {{ flags: Array<{ id: number, guildId: string, conversationFirstId: number|null, messageId: number|null, flaggedBy: string|null, reason: string|null, notes: string|null, status: string, resolvedBy: string|null, resolvedAt: string|null, createdAt: string }>, total: number }} An object containing `flags` (mapped flagged-message rows with associated conversation message fields) and `total` (count of matching flagged messages).
 */
export async function listFlaggedMessages(dbPool, { guildId, status, limit, offset }) {
  const whereParts = ['fm.guild_id = $1'];
  const values = [guildId];
  let paramIndex = 1;

  const validStatuses = ['open', 'resolved', 'dismissed'];
  if (status && validStatuses.includes(status)) {
    paramIndex++;
    whereParts.push(`fm.status = $${paramIndex}`);
    values.push(status);
  }

  const whereClause = whereParts.join(' AND ');

  const [countResult, flagsResult] = await Promise.all([
    dbPool.query(
      `SELECT COUNT(*)::int AS count FROM flagged_messages fm WHERE ${whereClause}`,
      values,
    ),
    dbPool.query(
      `SELECT fm.id, fm.guild_id, fm.conversation_first_id, fm.message_id,
                  fm.flagged_by, fm.reason, fm.notes, fm.status,
                  fm.resolved_by, fm.resolved_at, fm.created_at,
                  c.content AS message_content, c.role AS message_role,
                  c.username AS message_username
           FROM flagged_messages fm
           LEFT JOIN conversations c ON c.id = fm.message_id
           WHERE ${whereClause}
           ORDER BY fm.created_at DESC, fm.id DESC
           LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}`,
      [...values, limit, offset],
    ),
  ]);

  return {
    flags: flagsResult.rows.map((r) => ({
      id: r.id,
      guildId: r.guild_id,
      conversationFirstId: r.conversation_first_id,
      messageId: r.message_id,
      flaggedBy: r.flagged_by,
      reason: r.reason,
      notes: r.notes,
      status: r.status,
      resolvedBy: r.resolved_by,
      resolvedAt: r.resolved_at,
      createdAt: r.created_at,
      messageContent: r.message_content,
      messageRole: r.message_role,
      messageUsername: r.message_username,
    })),
    total: countResult.rows[0]?.count || 0,
  };
}

/**
 * Retrieve a conversation message by its id within the specified guild.
 * @param {import('pg').Pool} dbPool - Database pool/connection for executing the query.
 * @param {{ guildId: string|number, messageId: string|number }} options - Lookup parameters.
 * @param {string|number} options.guildId - Guild identifier to scope the lookup.
 * @param {string|number} options.messageId - Message identifier to find.
 * @returns {{ id: number, channel_id: string, created_at: string } | null} The found conversation row containing `id`, `channel_id`, and `created_at`, or `null` if no matching row exists.
 */
export async function findConversationMessage(dbPool, { guildId, messageId }) {
  const result = await dbPool.query(
    `SELECT id, channel_id, created_at
         FROM conversations
         WHERE id = $1 AND guild_id = $2`,
    [messageId, guildId],
  );
  return result.rows[0] || null;
}

/**
 * Fetches all messages belonging to the conversation that contains the given anchor message in a channel.
 *
 * @param {import('pg').Pool} dbPool - Database pool/connection for executing the query.
 * @param {Object} options - Conversation window lookup options.
 * @param {string|number} options.guildId - Guild identifier to scope the lookup.
 * @param {string|number} options.channelId - Channel identifier to search for the conversation.
 * @param {string|number} options.anchorId - Message id used as the anchor to locate which conversation to return.
 * @returns {Promise<Array<Object>>} An array of message rows for the conversation. Each row contains: `id`, `channel_id`, `role`, `content`, `username`, `created_at`, `discord_message_id`, and `user_id`. The query returns at most `MAX_CONVERSATION_DETAIL_MESSAGES + 1` rows so callers can detect oversized conversations without silently truncating normal responses.
 */
export async function fetchConversationWindowMessages(dbPool, { guildId, channelId, anchorId }) {
  const messagesResult = await dbPool.query(
    `WITH RECURSIVE anchor AS (
       SELECT id, channel_id, role, content, username, created_at, discord_message_id, user_id
       FROM conversations
       WHERE guild_id = $1 AND channel_id = $2 AND id = $3
     ),
     previous_messages AS (
       SELECT id, channel_id, role, content, username, created_at, discord_message_id, user_id, 1 AS depth
       FROM anchor
       UNION ALL
       SELECT prev_message.id, prev_message.channel_id, prev_message.role, prev_message.content,
              prev_message.username, prev_message.created_at, prev_message.discord_message_id,
              prev_message.user_id, current_message.depth + 1 AS depth
       FROM previous_messages current_message
       JOIN LATERAL (
         SELECT id, channel_id, role, content, username, created_at, discord_message_id, user_id
         FROM conversations
         WHERE guild_id = $1
           AND channel_id = $2
           AND (created_at < current_message.created_at
             OR (created_at = current_message.created_at AND id < current_message.id))
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       ) prev_message ON EXTRACT(EPOCH FROM (current_message.created_at - prev_message.created_at)) <= $4
       WHERE current_message.depth < $5
     ),
     next_messages AS (
       SELECT id, channel_id, role, content, username, created_at, discord_message_id, user_id, 1 AS depth
       FROM anchor
       UNION ALL
       SELECT next_message.id, next_message.channel_id, next_message.role, next_message.content,
              next_message.username, next_message.created_at, next_message.discord_message_id,
              next_message.user_id, current_message.depth + 1 AS depth
       FROM next_messages current_message
       JOIN LATERAL (
         SELECT id, channel_id, role, content, username, created_at, discord_message_id, user_id
         FROM conversations
         WHERE guild_id = $1
           AND channel_id = $2
           AND (created_at > current_message.created_at
             OR (created_at = current_message.created_at AND id > current_message.id))
         ORDER BY created_at ASC, id ASC
         LIMIT 1
       ) next_message ON EXTRACT(EPOCH FROM (next_message.created_at - current_message.created_at)) <= $4
       WHERE current_message.depth < $5
     ),
     conversation_messages AS (
       SELECT id, channel_id, role, content, username, created_at, discord_message_id, user_id FROM previous_messages
       UNION
       SELECT id, channel_id, role, content, username, created_at, discord_message_id, user_id FROM next_messages
     )
     SELECT id, channel_id, role, content, username, created_at, discord_message_id, user_id
     FROM conversation_messages
     ORDER BY created_at ASC, id ASC
     LIMIT $5`,
    [
      guildId,
      channelId,
      anchorId,
      CONVERSATION_GAP_MINUTES * 60,
      MAX_CONVERSATION_DETAIL_MESSAGES + 1,
    ],
  );

  return messagesResult.rows;
}

/**
 * Determine whether a target message belongs to the same gap-bounded conversation as an anchor.
 *
 * Uses a directional recursive walk toward the known target row and selects only ids/timestamps. This
 * avoids loading full message content for flag validation and avoids channel-wide window functions or
 * arbitrary response caps that could falsely reject long but valid conversations.
 * @param {import('pg').Pool} dbPool - Database pool/connection for executing the query.
 * @param {Object} options - Membership check options.
 * @param {string|number} options.guildId - Guild identifier to scope the lookup.
 * @param {string|number} options.channelId - Channel identifier shared by the anchor and target.
 * @param {string|number} options.anchorId - Anchor conversation message id.
 * @param {string|number} options.messageId - Target message id to validate.
 * @returns {Promise<{belongs: boolean, limitExceeded: boolean}>} `belongs` is true when the target is connected to the anchor by adjacent messages no more than the conversation gap apart. `limitExceeded` is true when validation hit the hop cutoff before proving membership.
 */
export async function isMessageInConversationSegment(
  dbPool,
  { guildId, channelId, anchorId, messageId },
) {
  const result = await dbPool.query(
    `WITH RECURSIVE endpoints AS (
       SELECT
         anchor.id AS anchor_id,
         anchor.created_at AS anchor_created_at,
         target.id AS target_id,
         target.created_at AS target_created_at,
         CASE
           WHEN target.created_at > anchor.created_at
             OR (target.created_at = anchor.created_at AND target.id > anchor.id)
           THEN 1
           WHEN target.created_at < anchor.created_at
             OR (target.created_at = anchor.created_at AND target.id < anchor.id)
           THEN -1
           ELSE 0
         END AS direction
       FROM conversations anchor
       JOIN conversations target
         ON target.guild_id = $1
        AND target.channel_id = $2
        AND target.id = $4
       WHERE anchor.guild_id = $1
         AND anchor.channel_id = $2
         AND anchor.id = $3
     ),
     walk AS (
       SELECT
         anchor_id AS id,
         anchor_created_at AS created_at,
         target_id,
         target_created_at,
         direction,
         direction = 0 AS found,
         0 AS hops
       FROM endpoints
       UNION ALL
       SELECT
         next_message.id,
         next_message.created_at,
         walk.target_id,
         walk.target_created_at,
         walk.direction,
         next_message.id = walk.target_id AS found,
         walk.hops + 1 AS hops
       FROM walk
       JOIN LATERAL (
         SELECT id, created_at
         FROM conversations
         WHERE guild_id = $1
           AND channel_id = $2
           AND (
             (
               walk.direction = 1
               AND (created_at > walk.created_at
                 OR (created_at = walk.created_at AND id > walk.id))
               AND (created_at < walk.target_created_at
                 OR (created_at = walk.target_created_at AND id <= walk.target_id))
             )
             OR (
               walk.direction = -1
               AND (created_at < walk.created_at
                 OR (created_at = walk.created_at AND id < walk.id))
               AND (created_at > walk.target_created_at
                 OR (created_at = walk.target_created_at AND id >= walk.target_id))
             )
           )
         ORDER BY
           CASE WHEN walk.direction = 1 THEN created_at END ASC,
           CASE WHEN walk.direction = 1 THEN id END ASC,
           CASE WHEN walk.direction = -1 THEN created_at END DESC,
           CASE WHEN walk.direction = -1 THEN id END DESC
         LIMIT 1
       ) next_message ON walk.direction != 0
        AND (
          (walk.direction = 1 AND EXTRACT(EPOCH FROM (next_message.created_at - walk.created_at)) <= $5)
          OR (walk.direction = -1 AND EXTRACT(EPOCH FROM (walk.created_at - next_message.created_at)) <= $5)
        )
       WHERE NOT walk.found
         AND walk.hops <= $6
     )
     SELECT
       COALESCE(BOOL_OR(found AND hops <= $6), FALSE) AS belongs,
       COALESCE(BOOL_OR(hops > $6), FALSE) AS limit_exceeded
     FROM walk`,
    [
      guildId,
      channelId,
      anchorId,
      messageId,
      CONVERSATION_GAP_MINUTES * 60,
      MAX_CONVERSATION_MEMBERSHIP_HOPS,
    ],
  );

  return {
    belongs: result.rows[0]?.belongs === true,
    limitExceeded: result.rows[0]?.limit_exceeded === true,
  };
}

/**
 * Retrieve the most recent flag status for each specified message in a guild.
 *
 * @param {string} guildId - ID of the guild to filter flags by.
 * @param {Array<string>} messageIds - Array of message IDs to fetch flag statuses for.
 * @returns {Map<string, string>} A Map where each key is a message ID present in `messageIds` that has at least one flag, and the value is the most recent flag `status` for that message.
 */
export async function fetchFlagStatusesForMessages(dbPool, { guildId, messageIds }) {
  const flagsResult = await dbPool.query(
    `SELECT message_id, status FROM flagged_messages
         WHERE guild_id = $1 AND message_id = ANY($2)
         ORDER BY created_at DESC, id DESC`,
    [guildId, messageIds],
  );

  const flaggedMessageIds = new Map();
  for (const r of flagsResult.rows) {
    if (!flaggedMessageIds.has(r.message_id)) {
      flaggedMessageIds.set(r.message_id, r.status);
    }
  }

  return flaggedMessageIds;
}

/**
 * Resolves the conversation rows for a target message and an anchor message.
 *
 * Finds the conversation row matching `messageId` and the conversation row matching `conversationId` (used as an anchor) for the given guild.
 * @param {Pool} dbPool - Database pool/connection (injected service).
 * @param {Object} params
 * @param {string|number} params.guildId - Guild identifier to scope the lookup.
 * @param {string|number} params.messageId - Message id to resolve; may return `null` if not found.
 * @param {string|number} params.conversationId - Anchor message id to resolve; may return `null` if not found.
 * @returns {{ message: Object|null, anchor: Object|null }} An object with `message` and `anchor` set to the found conversation rows or `null` when absent.
 */
export async function fetchFlagTargets(dbPool, { guildId, messageId, conversationId }) {
  const [msgCheck, anchorCheck] = await Promise.all([
    findConversationMessage(dbPool, { guildId, messageId }),
    findConversationMessage(dbPool, { guildId, messageId: conversationId }),
  ]);

  return { message: msgCheck, anchor: anchorCheck };
}

/**
 * Insert a flagged message record for a guild conversation and return the new record's id and status.
 *
 * @param {Object} params - Flag details.
 * @param {string|number} params.guildId - Guild identifier for the flag.
 * @param {string|number} params.conversationId - Conversation first-message id that the flagged message belongs to.
 * @param {string|number} params.messageId - The id of the flagged conversation message.
 * @param {string|number} params.flaggedBy - Identifier of the user who flagged the message.
 * @param {string} params.reason - Reason for flagging; whitespace is trimmed before storage.
 * @param {string} [params.notes] - Optional additional notes; whitespace is trimmed and stored as `null` when not provided.
 * @returns {{id: number, status: string}} The inserted flagged message's `id` and current `status`.
 */
export async function insertFlaggedMessage(
  dbPool,
  { guildId, conversationId, messageId, flaggedBy, reason, notes },
) {
  const insertResult = await dbPool.query(
    `INSERT INTO flagged_messages (guild_id, conversation_first_id, message_id, flagged_by, reason, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, status`,
    [guildId, conversationId, messageId, flaggedBy, reason.trim(), notes?.trim() || null],
  );

  return insertResult.rows[0];
}
