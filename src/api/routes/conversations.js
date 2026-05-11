/**
 * Conversation Routes
 * Endpoints for viewing, searching, and flagging AI conversations.
 *
 * Mounted at /api/v1/guilds/:id/conversations
 */

import { Router } from 'express';
import { info, error as logError } from '../../logger.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  estimateTokens,
  fetchConversationStats,
  fetchConversationWindowMessages,
  fetchFlagStatusesForMessages,
  fetchFlagTargets,
  findConversationMessage,
  groupMessagesIntoConversations,
  insertFlaggedMessage,
  isMessageInConversationSegment,
  listConversationSummaries,
  listFlaggedMessages,
  MAX_CONVERSATION_DETAIL_MESSAGES,
} from '../repositories/conversationRepository.js';
import { parsePagination, requireGuildAdmin, validateGuild } from './guilds.js';

const router = Router({ mergeParams: true });

function getSafeErrorMessage(err) {
  if (err === null) {
    return 'null';
  }

  if (err === undefined) {
    return 'undefined';
  }

  try {
    if (typeof err === 'object' && 'message' in err && err.message !== undefined) {
      return String(err.message);
    }

    return String(err);
  } catch {
    return 'Unknown error';
  }
}

/** Rate limiter: 60 requests / 1 min per IP */
const conversationsRateLimit = rateLimit({ windowMs: 60 * 1000, max: 60 });

export { groupMessagesIntoConversations };

// ─── GET / — List conversations (grouped) ─────────────────────────────────────

/**
 * @openapi
 * /guilds/{id}/conversations:
 *   get:
 *     tags:
 *       - Conversations
 *     summary: List AI conversations
 *     description: >
 *       Returns AI conversations grouped by channel and time proximity.
 *       Messages within 15 minutes in the same channel are grouped together.
 *       Defaults to the last 30 days. Date filters accept ISO date-time strings
 *       or date-only YYYY-MM-DD strings; date-only `to` values include the full
 *       UTC day via an exclusive next-day bound, while date-time `to` values
 *       are inclusive at the exact timestamp.
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Guild ID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 25
 *           maximum: 100
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Full-text search in message content
 *       - in: query
 *         name: user
 *         schema:
 *           type: string
 *         description: Filter by username
 *       - in: query
 *         name: channel
 *         schema:
 *           type: string
 *         description: Filter by channel ID
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start date filter. Accepts ISO date-time or date-only YYYY-MM-DD strings.
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End date filter. Accepts ISO date-time or date-only YYYY-MM-DD strings. Date-only values include the full UTC day (`created_at < nextDayStart`); date-time values are inclusive at the exact timestamp (`created_at <= timestamp`).
 *     responses:
 *       "200":
 *         description: Paginated conversation list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 conversations:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       channelId:
 *                         type: string
 *                       channelName:
 *                         type: string
 *                       participants:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             username:
 *                               type: string
 *                             role:
 *                               type: string
 *                       messageCount:
 *                         type: integer
 *                       firstMessageAt:
 *                         type: string
 *                         format: date-time
 *                       lastMessageAt:
 *                         type: string
 *                         format: date-time
 *                       preview:
 *                         type: string
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "403":
 *         $ref: "#/components/responses/Forbidden"
 *       "429":
 *         $ref: "#/components/responses/RateLimited"
 *       "500":
 *         $ref: "#/components/responses/ServerError"
 *       "503":
 *         $ref: "#/components/responses/ServiceUnavailable"
 */
router.get('/', conversationsRateLimit, requireGuildAdmin, validateGuild, async (req, res) => {
  const { dbPool } = req.app.locals;
  if (!dbPool) {
    return res.status(503).json({ error: 'Database not available' });
  }

  const { page, limit, offset } = parsePagination(req.query);
  const guildId = req.params.id;

  try {
    const { rows, total } = await listConversationSummaries(dbPool, {
      guildId,
      query: req.query,
      limit,
      offset,
    });

    const conversations = rows.map((row) => {
      const content = row.preview_content || '';
      const preview = content.slice(0, 100) + (content.length > 100 ? '\u2026' : '');
      const channelName = req.guild?.channels?.cache?.get(row.channel_id)?.name || null;

      const participants = (row.participant_pairs || []).map((p) => {
        const parts = p.split(':::');
        const userId = parts.pop();
        const role = parts.pop();
        const username = parts.join(':::');

        const resolvedUserId = userId === 'unknown' ? null : userId;
        const member = resolvedUserId ? req.guild?.members.cache.get(resolvedUserId) : null;

        return {
          username: username || 'unknown',
          role: role || 'unknown',
          userId: resolvedUserId,
          avatar: member?.user.displayAvatarURL() || null,
        };
      });

      return {
        id: row.id,
        channelId: row.channel_id,
        channelName,
        participants,
        messageCount: row.message_count,
        firstMessageAt: new Date(row.first_msg_time).toISOString(),
        lastMessageAt: new Date(row.last_msg_time).toISOString(),
        preview,
      };
    });

    res.json({ conversations, total, page });
  } catch (err) {
    logError('Failed to fetch conversations', { error: err.message, guild: guildId });
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// ─── GET /stats — Conversation analytics ──────────────────────────────────────

/**
 * @openapi
 * /guilds/{id}/conversations/stats:
 *   get:
 *     tags:
 *       - Conversations
 *     summary: Conversation analytics
 *     description: Returns aggregate statistics about AI conversations for the guild.
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Guild ID
 *     responses:
 *       "200":
 *         description: Conversation analytics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalConversations:
 *                   type: integer
 *                 totalMessages:
 *                   type: integer
 *                 avgMessagesPerConversation:
 *                   type: integer
 *                 topUsers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       username:
 *                         type: string
 *                       messageCount:
 *                         type: integer
 *                 dailyActivity:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                         format: date
 *                       count:
 *                         type: integer
 *                 estimatedTokens:
 *                   type: integer
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "403":
 *         $ref: "#/components/responses/Forbidden"
 *       "429":
 *         $ref: "#/components/responses/RateLimited"
 *       "500":
 *         $ref: "#/components/responses/ServerError"
 *       "503":
 *         $ref: "#/components/responses/ServiceUnavailable"
 */
router.get('/stats', conversationsRateLimit, requireGuildAdmin, validateGuild, async (req, res) => {
  const { dbPool } = req.app.locals;
  if (!dbPool) {
    return res.status(503).json({ error: 'Database not available' });
  }

  const guildId = req.params.id;

  try {
    const stats = await fetchConversationStats(dbPool, guildId);
    res.json(stats);
  } catch (err) {
    logError('Failed to fetch conversation stats', {
      error: getSafeErrorMessage(err),
      guild: guildId,
    });
    res.status(500).json({ error: 'Failed to fetch conversation stats' });
  }
});

// ─── GET /flags — List flagged messages ───────────────────────────────────────

/**
 * @openapi
 * /guilds/{id}/conversations/flags:
 *   get:
 *     tags:
 *       - Conversations
 *     summary: List flagged messages
 *     description: Returns flagged AI messages with optional status filter.
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Guild ID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 25
 *           maximum: 100
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, resolved, dismissed]
 *     responses:
 *       "200":
 *         description: Flagged messages
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 flags:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       guildId:
 *                         type: string
 *                       conversationFirstId:
 *                         type: integer
 *                       messageId:
 *                         type: integer
 *                       flaggedBy:
 *                         type: string
 *                       reason:
 *                         type: string
 *                       notes:
 *                         type: string
 *                         nullable: true
 *                       status:
 *                         type: string
 *                         enum: [open, resolved, dismissed]
 *                       resolvedBy:
 *                         type: string
 *                         nullable: true
 *                       resolvedAt:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       messageContent:
 *                         type: string
 *                         nullable: true
 *                       messageRole:
 *                         type: string
 *                         nullable: true
 *                       messageUsername:
 *                         type: string
 *                         nullable: true
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "403":
 *         $ref: "#/components/responses/Forbidden"
 *       "429":
 *         $ref: "#/components/responses/RateLimited"
 *       "500":
 *         $ref: "#/components/responses/ServerError"
 *       "503":
 *         $ref: "#/components/responses/ServiceUnavailable"
 */
router.get('/flags', conversationsRateLimit, requireGuildAdmin, validateGuild, async (req, res) => {
  const { dbPool } = req.app.locals;
  if (!dbPool) {
    return res.status(503).json({ error: 'Database not available' });
  }

  const { page, limit, offset } = parsePagination(req.query);
  const guildId = req.params.id;

  try {
    const { flags, total } = await listFlaggedMessages(dbPool, {
      guildId,
      status: req.query.status,
      limit,
      offset,
    });

    res.json({ flags, total, page });
  } catch (err) {
    logError('Failed to fetch flagged messages', {
      error: getSafeErrorMessage(err),
      guild: guildId,
    });
    res.status(500).json({ error: 'Failed to fetch flagged messages' });
  }
});

// ─── GET /:conversationId — Single conversation detail ────────────────────────

/**
 * @openapi
 * /guilds/{id}/conversations/{conversationId}:
 *   get:
 *     tags:
 *       - Conversations
 *     summary: Get conversation detail
 *     description: Returns all messages in a conversation for replay, including flag status and token estimates.
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Guild ID
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID of the first message in the conversation
 *     responses:
 *       "200":
 *         description: Conversation detail with messages
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 messages:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       role:
 *                         type: string
 *                       content:
 *                         type: string
 *                       username:
 *                         type: string
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       flagStatus:
 *                         type: string
 *                         nullable: true
 *                         enum: [open, resolved, dismissed]
 *                       discordMessageId:
 *                         type: string
 *                         nullable: true
 *                         description: Native Discord message ID for constructing jump URLs
 *                       messageUrl:
 *                         type: string
 *                         nullable: true
 *                         description: Full Discord jump URL for the message (null if no discord_message_id)
 *                 channelId:
 *                   type: string
 *                 channelName:
 *                   type: string
 *                   nullable: true
 *                   description: Human-readable channel name from the Discord guild cache
 *                 duration:
 *                   type: integer
 *                   description: Duration in seconds
 *                 tokenEstimate:
 *                   type: integer
 *       "400":
 *         description: Invalid conversation ID
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Error"
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "403":
 *         $ref: "#/components/responses/Forbidden"
 *       "404":
 *         $ref: "#/components/responses/NotFound"
 *       "413":
 *         description: Conversation too large to return
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Error"
 *       "429":
 *         $ref: "#/components/responses/RateLimited"
 *       "500":
 *         $ref: "#/components/responses/ServerError"
 *       "503":
 *         $ref: "#/components/responses/ServiceUnavailable"
 */
router.get(
  '/:conversationId',
  conversationsRateLimit,
  requireGuildAdmin,
  validateGuild,
  async (req, res) => {
    const { dbPool } = req.app.locals;
    if (!dbPool) {
      return res.status(503).json({ error: 'Database not available' });
    }

    const guildId = req.params.id;
    const conversationId = Number.parseInt(req.params.conversationId, 10);

    if (Number.isNaN(conversationId)) {
      return res.status(400).json({ error: 'Invalid conversation ID' });
    }

    try {
      const anchor = await findConversationMessage(dbPool, { guildId, messageId: conversationId });

      if (!anchor) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const messageRows = await fetchConversationWindowMessages(dbPool, {
        guildId,
        channelId: anchor.channel_id,
        anchorId: anchor.id,
      });

      if (messageRows.length > MAX_CONVERSATION_DETAIL_MESSAGES) {
        return res.status(413).json({ error: 'Conversation too large to return' });
      }

      const allConvos = groupMessagesIntoConversations(messageRows);
      const targetConvo = allConvos.find((c) => c.id === conversationId);

      if (!targetConvo) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const messages = targetConvo.messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        username: msg.username,
        userId: msg.user_id || null,
        createdAt: msg.created_at,
        discordMessageId: msg.discord_message_id || null,
      }));

      const durationMs = targetConvo.lastTime - targetConvo.firstTime;
      const messageIds = messages.map((m) => m.id);
      const flaggedMessageIds = await fetchFlagStatusesForMessages(dbPool, { guildId, messageIds });
      const channelName = req.guild?.channels?.cache?.get(anchor.channel_id)?.name || null;

      const enrichedMessages = messages.map((m) => {
        const member = m.userId ? req.guild?.members.cache.get(m.userId) : null;
        return {
          ...m,
          avatarUrl: member?.user.displayAvatarURL() || null,
          flagStatus: flaggedMessageIds.get(m.id) || null,
          messageUrl:
            m.discordMessageId && guildId
              ? `https://discord.com/channels/${guildId}/${anchor.channel_id}/${m.discordMessageId}`
              : null,
        };
      });

      const mentionIds = new Set();
      for (const msg of messages) {
        const matches = msg.content?.matchAll(/<@!?(\d+)>/g) || [];
        for (const match of matches) {
          mentionIds.add(match[1]);
        }
      }

      const mentionMap = {};
      for (const id of mentionIds) {
        const member = req.guild?.members.cache.get(id);
        if (member) {
          mentionMap[id] = member.user.username;
        }
      }

      res.json({
        messages: enrichedMessages,
        channelId: anchor.channel_id,
        channelName,
        duration: Math.round(durationMs / 1000),
        tokenEstimate: estimateTokens(messages.map((m) => m.content || '').join('')),
        mentionMap,
      });
    } catch (err) {
      logError('Failed to fetch conversation detail', {
        error: err.message,
        guild: guildId,
        conversationId,
      });
      res.status(500).json({ error: 'Failed to fetch conversation detail' });
    }
  },
);

// ─── POST /:conversationId/flag — Flag a message ─────────────────────────────

/**
 * @openapi
 * /guilds/{id}/conversations/{conversationId}/flag:
 *   post:
 *     tags:
 *       - Conversations
 *     summary: Flag a message
 *     description: Flag a problematic AI response in a conversation for review.
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Guild ID
 *       - in: path
 *         name: conversationId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Conversation ID (first message ID)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - messageId
 *               - reason
 *             properties:
 *               messageId:
 *                 type: integer
 *                 description: ID of the message to flag
 *               reason:
 *                 type: string
 *                 maxLength: 500
 *               notes:
 *                 type: string
 *                 maxLength: 2000
 *     responses:
 *       "201":
 *         description: Message flagged successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 flagId:
 *                   type: integer
 *                 status:
 *                   type: string
 *                   enum: [open]
 *       "400":
 *         description: Invalid input
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Error"
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "403":
 *         $ref: "#/components/responses/Forbidden"
 *       "404":
 *         $ref: "#/components/responses/NotFound"
 *       "413":
 *         description: Conversation too large to validate
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Error"
 *       "429":
 *         $ref: "#/components/responses/RateLimited"
 *       "500":
 *         $ref: "#/components/responses/ServerError"
 *       "503":
 *         $ref: "#/components/responses/ServiceUnavailable"
 */
router.post(
  '/:conversationId/flag',
  conversationsRateLimit,
  requireGuildAdmin,
  validateGuild,
  async (req, res) => {
    const { dbPool } = req.app.locals;
    if (!dbPool) {
      return res.status(503).json({ error: 'Database not available' });
    }

    const guildId = req.params.id;
    const conversationId = Number.parseInt(req.params.conversationId, 10);

    if (Number.isNaN(conversationId)) {
      return res.status(400).json({ error: 'Invalid conversation ID' });
    }

    const { messageId, reason, notes } = req.body || {};

    if (!messageId || typeof messageId !== 'number') {
      return res.status(400).json({ error: 'messageId is required and must be a number' });
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return res.status(400).json({ error: 'reason is required and must be a non-empty string' });
    }

    if (reason.length > 500) {
      return res.status(400).json({ error: 'reason must not exceed 500 characters' });
    }

    if (notes && typeof notes !== 'string') {
      return res.status(400).json({ error: 'notes must be a string' });
    }

    if (notes && notes.length > 2000) {
      return res.status(400).json({ error: 'notes must not exceed 2000 characters' });
    }

    try {
      const { message, anchor } = await fetchFlagTargets(dbPool, {
        guildId,
        messageId,
        conversationId,
      });

      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }

      if (!anchor) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      if (message.channel_id !== anchor.channel_id) {
        return res.status(400).json({ error: 'Message does not belong to this conversation' });
      }

      const membership = await isMessageInConversationSegment(dbPool, {
        guildId,
        channelId: anchor.channel_id,
        anchorId: anchor.id,
        messageId,
      });

      if (membership.limitExceeded) {
        return res.status(413).json({ error: 'Conversation too large to validate' });
      }

      if (!membership.belongs) {
        return res.status(400).json({ error: 'Message does not belong to this conversation' });
      }

      const flaggedBy = req.user?.userId || 'api-secret';
      const flag = await insertFlaggedMessage(dbPool, {
        guildId,
        conversationId,
        messageId,
        flaggedBy,
        reason,
        notes,
      });

      info('Message flagged', {
        guildId,
        conversationId,
        messageId,
        flagId: flag.id,
        flaggedBy,
      });

      res.status(201).json({ flagId: flag.id, status: flag.status });
    } catch (err) {
      logError('Failed to flag message', {
        error: err.message,
        guildId,
        conversationId,
        messageId,
      });
      res.status(500).json({ error: 'Failed to flag message' });
    }
  },
);

export default router;
