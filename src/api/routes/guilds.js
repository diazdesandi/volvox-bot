/**
 * Guild Routes
 * Endpoints for guild info, config, stats, members, moderation, and actions
 */

import { Router } from 'express';
import { error, info, warn } from '../../logger.js';
import { getConfig, setConfigValue, setMultipleConfigValues } from '../../modules/config.js';
import { cacheGetOrSet, TTL } from '../../utils/cache.js';
import { getBotOwnerIds, isAdmin, isModerator } from '../../utils/permissions.js';
import { safeSend } from '../../utils/safeSend.js';
import {
  AnalyticsRangeValidationError,
  getErrorMessage,
  getGuildAnalytics,
} from '../services/analyticsService.js';
import {
  maskSensitiveFields,
  READABLE_CONFIG_KEYS,
  SAFE_CONFIG_KEYS,
} from '../utils/configAllowlist.js';
import { fetchUserGuilds } from '../utils/discordApi.js';
import { parseLimit, parsePage } from '../utils/pagination.js';
import { getSessionToken } from '../utils/sessionStore.js';
import { validateConfigPatchBody } from '../utils/validateConfigPatch.js';

const router = Router();

/** Discord ADMINISTRATOR permission flag */
const ADMINISTRATOR_FLAG = 0x8;
/** Discord MANAGE_GUILD permission flag */
const MANAGE_GUILD_FLAG = 0x20;
const ACCESS_LOOKUP_CONCURRENCY = 10;
const MAX_ACCESS_LOOKUP_GUILDS = 100;

/**
 * Upper bound on content length for abuse prevention.
 * safeSend handles the actual Discord 2000-char message splitting.
 */
const MAX_CONTENT_LENGTH = 10000;

/**
 * Normalize pagination parameters from a query object.
 *
 * @param {Object} query - Query object (e.g., Express `req.query`) that may include `page` and `limit`.
 * @returns {{page: number, limit: number, offset: number}} Normalized pagination where `page` is at least 1, `limit` is between 1 and 100, and `offset` equals `(page - 1) * limit`.
 */
export function parsePagination(query) {
  const page = parsePage(query.page);
  const limit = parseLimit(query.limit);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/**
 * Determine whether an OAuth2 user has any of the specified permission flags for a guild.
 *
 * @param {Object} user - Decoded JWT user payload containing at minimum `userId`.
 * @param {string} guildId - Discord guild ID to check.
 * @param {number} anyOfFlags - Bitmask of Discord permission flags; returns `true` if any bit in this mask is present on the user's guild permissions.
 * @returns {boolean} `true` if the user has any of the specified permission flags on the guild, `false` otherwise.
 */
async function hasOAuthGuildPermission(user, guildId, anyOfFlags) {
  try {
    const accessToken = await getSessionToken(user?.userId);
    if (!accessToken) return false;
    const guilds = await fetchUserGuilds(user.userId, accessToken);
    const guild = guilds.find((g) => g.id === guildId);
    if (!guild) return false;
    if (guild.owner === true) return true;
    const permissions = Number(guild.permissions);
    if (Number.isNaN(permissions)) return false;
    return (permissions & anyOfFlags) !== 0;
  } catch (err) {
    error('Error in hasOAuthGuildPermission (session lookup or guild fetch)', {
      error: err.message,
      userId: user?.userId,
      guildId,
    });
    throw err;
  }
}

/**
 * Determine if the authenticated OAuth2 user is configured as a bot owner.
 *
 * @param {Object} user - Decoded JWT user payload; expected to include `userId`.
 * @returns {boolean} `true` if `user.userId` is listed in the application bot owner IDs, `false` otherwise.
 */
function isOAuthBotOwner(user) {
  const botOwners = getBotOwnerIds(getConfig());
  return botOwners.includes(user?.userId);
}

/**
 * Check if an OAuth2 user has admin permissions on a guild.
 * Admin = ADMINISTRATOR only, aligning with the slash-command isAdmin check.
 *
 * @param {Object} user - Decoded JWT user payload
 * @param {string} guildId - Guild ID to check
 * @returns {Promise<boolean>} True if user has admin-level permission
 */
function isOAuthGuildAdmin(user, guildId) {
  return hasOAuthGuildPermission(user, guildId, ADMINISTRATOR_FLAG);
}

/**
 * Check if an OAuth2 user has moderator permissions on a guild.
 * Moderator = ADMINISTRATOR or MANAGE_GUILD, aligning with the slash-command isModerator check.
 *
 * @param {Object} user - Decoded JWT user payload
 * @param {string} guildId - Guild ID to check
 * @returns {Promise<boolean>} True if user has moderator-level permission
 */
function isOAuthGuildModerator(user, guildId) {
  return hasOAuthGuildPermission(user, guildId, ADMINISTRATOR_FLAG | MANAGE_GUILD_FLAG);
}

function accessSatisfiesRequirement(access, requiredAccess) {
  if (requiredAccess === 'admin') return access === 'admin' || access === 'owner';
  return access === 'admin' || access === 'owner' || access === 'moderator';
}

function hasPermissionFlag(permissions, flag) {
  try {
    return (BigInt(permissions) & BigInt(flag)) === BigInt(flag);
  } catch {
    return false;
  }
}

function getOAuthDerivedAccessLevel(owner, permissions) {
  if (owner) return 'owner';
  if (hasPermissionFlag(permissions, ADMINISTRATOR_FLAG)) return 'admin';
  if (hasPermissionFlag(permissions, MANAGE_GUILD_FLAG)) return 'moderator';
  return null;
}

function getGuildIconUrl(guild) {
  if (typeof guild.iconURL === 'function') {
    return guild.iconURL({ size: 128 });
  }
  if (guild.icon) {
    const ext = guild.icon.startsWith('a_') ? 'gif' : 'webp';
    return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${ext}?size=128`;
  }
  return null;
}

function getGuildIconHash(guild) {
  return guild.icon || null;
}

function getGuildListConfig(guildId) {
  const config = getConfig(guildId);
  return {
    communityHubs: {
      enabled: config?.communityHubs?.enabled === true,
    },
  };
}

function getGuildListItem(guild, extra = {}) {
  return {
    id: guild.id,
    name: guild.name,
    icon: getGuildIconUrl(guild),
    iconHash: getGuildIconHash(guild),
    memberCount: guild.memberCount,
    botPresent: true,
    config: getGuildListConfig(guild.id),
    ...extra,
  };
}

function isUnknownMemberError(err) {
  return err?.code === 10007 || err?.message?.includes('Unknown Member');
}

async function mapWithConcurrency(items, concurrency, iteratee) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Determine the dashboard access level for a guild member according to the bot's configured role rules.
 *
 * @param {import('discord.js').Guild} guild - Target guild.
 * @param {string} userId - Discord user ID to evaluate.
 * @returns {Promise<'admin'|'moderator'|'viewer'>} `'admin'` if the member is an administrator, `'moderator'` if they have moderator privileges, `'viewer'` otherwise.
 */
async function getGuildAccessLevel(guild, userId) {
  return (await resolveGuildAccessLevel(guild, userId)).access;
}

/**
 * Resolve dashboard access and membership presence for a guild member.
 *
 * @param {import('discord.js').Guild} guild - Discord guild to check.
 * @param {string} userId - User ID to resolve access for.
 * @returns {Promise<{access: 'admin'|'moderator'|'viewer', present: boolean}>} `present: true`
 * means the bot confirmed the user is a guild member; `present: false` means the user is not a
 * member, with conservative viewer access returned for response-shape consistency.
 */
async function resolveGuildAccessLevel(guild, userId) {
  const config = getConfig(guild.id);

  let member = guild.members.cache.get(userId) || null;
  if (!member && typeof guild.members?.fetch === 'function') {
    try {
      member = await guild.members.fetch(userId);
    } catch (err) {
      if (isUnknownMemberError(err)) {
        member = null;
      } else {
        throw err;
      }
    }
  }

  if (!member) {
    return { access: 'viewer', present: false };
  }

  if (isAdmin(member, config)) {
    return { access: 'admin', present: true };
  }

  if (isModerator(member, config)) {
    return { access: 'moderator', present: true };
  }

  return { access: 'viewer', present: true };
}

/**
 * Return Express middleware that enforces a guild-level permission for OAuth users.
 *
 * The middleware bypasses checks for API-secret requests and for configured bot owners.
 * For cached bot guilds it resolves dashboard access via `getGuildAccessLevel(...)`,
 * then falls back to the OAuth owner/permission check when cached access is insufficient.
 * Otherwise it uses `permissionCheck(user, guildId)`. The resolved access
 * level must satisfy `requiredAccess`.
 * - responds 403 with `errorMessage` when the resolved access is insufficient,
 * - responds 502 when the permission verification throws,
 * - otherwise allows the request to continue.
 * Unknown or missing auth methods receive a 401 response.
 *
 * @param {(user: Object, guildId: string) => Promise<boolean>} permissionCheck - Function that returns `true` if the provided user has the required permission in the specified guild, `false` otherwise.
 * @param {string} errorMessage - Message to include in the 403 response when permission is denied.
 * @param {'moderator'|'admin'} requiredAccess - Minimum dashboard access level required for the route.
 * @returns {import('express').RequestHandler} Express middleware enforcing the permission.
 */
function requireGuildPermission(permissionCheck, errorMessage, requiredAccess) {
  return async (req, res, next) => {
    if (req.authMethod === 'api-secret') return next();

    if (req.authMethod === 'oauth') {
      if (isOAuthBotOwner(req.user)) return next();

      try {
        const guild = req.app.locals.client?.guilds?.cache?.get(req.params.id);
        if (guild) {
          const access = await getGuildAccessLevel(guild, req.user.userId);
          if (accessSatisfiesRequirement(access, requiredAccess)) {
            return next();
          }

          if (!(await permissionCheck(req.user, req.params.id))) {
            return res.status(403).json({ error: errorMessage });
          }
          return next();
        }

        if (!(await permissionCheck(req.user, req.params.id))) {
          return res.status(403).json({ error: errorMessage });
        }
        return next();
      } catch (err) {
        error('Failed to verify guild permission', {
          error: err.message,
          guild: req.params.id,
          userId: req.user?.userId,
        });
        return res.status(502).json({ error: 'Failed to verify guild permissions with Discord' });
      }
    }

    warn('Unknown authMethod in guild permission check', {
      authMethod: req.authMethod,
      path: req.path,
    });
    return res.status(401).json({ error: 'Unauthorized' });
  };
}

/** Middleware: verify OAuth2 users are guild admins. API-secret users pass through. */
export const requireGuildAdmin = requireGuildPermission(
  isOAuthGuildAdmin,
  'You do not have admin access to this guild',
  'admin',
);

/** Middleware: verify OAuth2 users are guild moderators. API-secret users pass through. */
export const requireGuildModerator = requireGuildPermission(
  isOAuthGuildModerator,
  'You do not have moderator access to this guild',
  'moderator',
);

/**
 * Validate that the requested guild exists and attach it to req.guild.
 *
 * If the bot is not present in the guild identified by req.params.id, sends a 404
 * response with `{ error: 'Guild not found' }` and does not call `next()`. Otherwise
 * sets `req.guild` to the Guild instance and calls `next()`.
 */
export function validateGuild(req, res, next) {
  const { client } = req.app.locals;
  const guild = client.guilds.cache.get(req.params.id);

  if (!guild) {
    return res.status(404).json({ error: 'Guild not found' });
  }

  req.guild = guild;
  next();
}

/**
 * @openapi
 * /guilds:
 *   get:
 *     tags:
 *       - Guilds
 *     summary: List guilds
 *     description: >
 *       For OAuth users: returns bot-present guilds from the user's Discord guild list,
 *       including viewer, moderator, and admin access metadata. Global admins
 *       (configured via BOT_OWNER_IDS) see all bot guilds. For API-secret users: returns all bot guilds.
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     responses:
 *       "200":
 *         description: Guild list
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   name:
 *                     type: string
 *                   icon:
 *                     type: string
 *                     nullable: true
 *                     description: Renderable Discord CDN URL for the guild icon.
 *                   iconHash:
 *                     type: string
 *                     nullable: true
 *                     description: Raw Discord icon hash, when available.
 *                   memberCount:
 *                     type: integer
 *                   botPresent:
 *                     type: boolean
 *                   owner:
 *                     type: boolean
 *                     description: Whether the OAuth user owns the guild. OAuth responses only.
 *                   permissions:
 *                     type: string
 *                     description: Discord permissions bitset from the OAuth guild object. OAuth responses only.
 *                   features:
 *                     type: array
 *                     items:
 *                       type: string
 *                     description: Discord guild features. OAuth responses only.
 *                   access:
 *                     type: string
 *                     enum: [owner, admin, moderator, viewer]
 *                   config:
 *                     type: object
 *                     description: Minimal guild config needed by dashboard navigation gates.
 *                     properties:
 *                       communityHubs:
 *                         type: object
 *                         properties:
 *                           enabled:
 *                             type: boolean
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "502":
 *         description: Failed to fetch guilds from Discord
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Error"
 *       "503":
 *         $ref: "#/components/responses/ServiceUnavailable"
 *       "500":
 *         $ref: "#/components/responses/ServerError"
 */
router.get('/', async (req, res) => {
  const { client } = req.app.locals;
  const botGuilds = client.guilds.cache;

  if (req.authMethod === 'oauth') {
    if (isOAuthBotOwner(req.user)) {
      const ownerGuilds = Array.from(botGuilds.values()).map((g) =>
        getGuildListItem(g, { access: 'admin' }),
      );
      return res.json(ownerGuilds);
    }

    let accessToken;
    try {
      accessToken = await getSessionToken(req.user?.userId);
    } catch (err) {
      error('Redis error fetching session token in GET /guilds', {
        error: err.message,
        userId: req.user?.userId,
      });
      return res.status(503).json({ error: 'Session store unavailable' });
    }
    if (!accessToken) {
      return res.status(401).json({ error: 'Missing access token' });
    }

    try {
      const userGuilds = await fetchUserGuilds(req.user.userId, accessToken);
      const resolvedGuilds = await mapWithConcurrency(
        userGuilds,
        ACCESS_LOOKUP_CONCURRENCY,
        async (ug) => {
          const botGuild = botGuilds.get(ug.id);
          if (!botGuild) return null;

          const access =
            getOAuthDerivedAccessLevel(ug.owner, ug.permissions) ??
            (await getGuildAccessLevel(botGuild, req.user.userId));

          return getGuildListItem(botGuild, {
            owner: ug.owner,
            permissions: ug.permissions,
            features: botGuild.features || [],
            access,
          });
        },
      );

      return res.json(resolvedGuilds.filter(Boolean));
    } catch (err) {
      error('Failed to fetch user guilds from Discord', {
        error: err.message,
        userId: req.user?.userId,
      });
      return res.status(502).json({ error: 'Failed to fetch guilds from Discord' });
    }
  }

  if (req.authMethod === 'api-secret') {
    const guilds = Array.from(botGuilds.values()).map((g) => getGuildListItem(g));
    return res.json(guilds);
  }

  // Unknown auth method — reject
  warn('Unknown authMethod in guild list', { authMethod: req.authMethod, path: req.path });
  return res.status(401).json({ error: 'Unauthorized' });
});

router.get('/access', async (req, res) => {
  if (req.authMethod !== 'api-secret') {
    return res
      .status(401)
      .json({ error: 'Guild access endpoint requires API secret authentication' });
  }

  const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
  const guildIdsRaw = typeof req.query.guildIds === 'string' ? req.query.guildIds : '';

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId query parameter' });
  }

  const guildIds = [
    ...new Set(
      guildIdsRaw
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  if (guildIds.length === 0) {
    return res.json([]);
  }
  if (guildIds.length > MAX_ACCESS_LOOKUP_GUILDS) {
    return res.status(400).json({
      error: `guildIds may include at most ${MAX_ACCESS_LOOKUP_GUILDS} entries`,
    });
  }

  const { client } = req.app.locals;

  try {
    const accessEntries = await mapWithConcurrency(
      guildIds,
      ACCESS_LOOKUP_CONCURRENCY,
      async (guildId) => {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return null;

        const { access, present } = await resolveGuildAccessLevel(guild, userId);
        return { id: guildId, access, present };
      },
    );

    return res.json(accessEntries.filter(Boolean));
  } catch (err) {
    error('Failed to resolve guild access entries', {
      error: err.message,
      userId,
      guildCount: guildIds.length,
    });
    return res.status(502).json({ error: 'Failed to verify guild permissions with Discord' });
  }
});

/** Maximum number of channels to return to avoid oversized payloads. */
const MAX_CHANNELS = 500;

/** Maximum number of roles to return to avoid oversized payloads. */
const MAX_ROLES = 250;

/**
 * Return a capped list of channels for a guild.
 *
 * @param {import('discord.js').Guild} guild
 * @returns {{ id: string, name: string, type: number }[]}
 */
function getGuildChannels(guild) {
  // type is discord.js ChannelType enum: 0=GuildText, 2=GuildVoice, 4=GuildCategory,
  // 5=GuildAnnouncement, 13=GuildStageVoice, 15=GuildForum, 16=GuildMedia
  const channels = [];
  for (const ch of guild.channels.cache.values()) {
    if (channels.length >= MAX_CHANNELS) break;
    channels.push({
      id: ch.id,
      name: ch.name,
      type: ch.type,
      parentId: ch.parentId ?? null,
      position: ch.position ?? 0,
    });
  }
  return channels;
}

/**
 * @openapi
 * /guilds/{id}:
 *   get:
 *     tags:
 *       - Guilds
 *     summary: Get guild info
 *     description: Returns detailed information about a specific guild.
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
 *         description: Guild details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 icon:
 *                   type: string
 *                   nullable: true
 *                 iconHash:
 *                   type: string
 *                   nullable: true
 *                 memberCount:
 *                   type: integer
 *                 channels:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       type:
 *                         type: integer
 *                         description: "Discord channel type enum (0=Text, 2=Voice, 4=Category, 5=Announcement, 13=Stage, 15=Forum, 16=Media)"
 *                 channelCount:
 *                   type: integer
 *                   description: Total number of channels in the guild
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "403":
 *         $ref: "#/components/responses/Forbidden"
 *       "404":
 *         $ref: "#/components/responses/NotFound"
 */
router.get('/:id', requireGuildAdmin, validateGuild, (req, res) => {
  const guild = req.guild;
  res.json({
    id: guild.id,
    name: guild.name,
    icon: getGuildIconUrl(guild),
    iconHash: getGuildIconHash(guild),
    memberCount: guild.memberCount,
    channelCount: guild.channels.cache.size,
    channels: getGuildChannels(guild),
  });
});

/**
 * @openapi
 * /guilds/{id}/channels:
 *   get:
 *     tags:
 *       - Guilds
 *     summary: List guild channels
 *     description: Returns all channels in the guild (capped at 500).
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Channel list
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   name:
 *                     type: string
 *                   type:
 *                     type: integer
 *                     description: "Discord channel type enum (0=Text, 2=Voice, 4=Category, 5=Announcement, 13=Stage, 15=Forum, 16=Media)"
 *                   parentId:
 *                     type: string
 *                     nullable: true
 *                     description: "ID of the parent category channel, or null if uncategorized"
 *                   position:
 *                     type: integer
 *                     description: "Sorted position of the channel within its category"
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "403":
 *         $ref: "#/components/responses/Forbidden"
 *       "404":
 *         $ref: "#/components/responses/NotFound"
 */
router.get('/:id/channels', requireGuildAdmin, validateGuild, (req, res) => {
  res.json(getGuildChannels(req.guild));
});

/**
 * @openapi
 * /guilds/{id}/roles:
 *   get:
 *     tags:
 *       - Guilds
 *     summary: List guild roles
 *     description: Returns all roles in the guild (capped at 250).
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Role list
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   name:
 *                     type: string
 *                   color:
 *                     type: integer
 *                     description: Role color as decimal integer (for example 16711680)
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "403":
 *         $ref: "#/components/responses/Forbidden"
 *       "404":
 *         $ref: "#/components/responses/NotFound"
 */
router.get('/:id/roles', requireGuildAdmin, validateGuild, (req, res) => {
  const guild = req.guild;
  const roles = Array.from(guild.roles.cache.values())
    .filter((r) => r.id !== guild.id) // exclude @everyone
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.color }))
    .slice(0, MAX_ROLES);
  res.json(roles);
});

/**
 * @openapi
 * /guilds/{id}/config:
 *   get:
 *     tags:
 *       - Guilds
 *     summary: Get guild config
 *     description: Returns per-guild configuration (global defaults merged with guild overrides). Sensitive fields are masked.
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Guild config
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "403":
 *         $ref: "#/components/responses/Forbidden"
 *       "404":
 *         $ref: "#/components/responses/NotFound"
 */
router.get('/:id/config', requireGuildAdmin, validateGuild, (req, res) => {
  const config = getConfig(req.params.id);
  const safeConfig = {};
  for (const key of READABLE_CONFIG_KEYS) {
    if (key in config) {
      safeConfig[key] = config[key];
    }
  }
  res.json({
    guildId: req.params.id,
    ...maskSensitiveFields(safeConfig),
  });
});

/**
 * @openapi
 * /guilds/{id}/config:
 *   patch:
 *     tags:
 *       - Guilds
 *     summary: Update guild config
 *     description: Updates per-guild configuration overrides. Only writable sections are accepted.
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       "200":
 *         description: Updated guild config section
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       "400":
 *         description: Invalid config
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ValidationError"
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "403":
 *         $ref: "#/components/responses/Forbidden"
 *       "404":
 *         $ref: "#/components/responses/NotFound"
 *       "500":
 *         $ref: "#/components/responses/ServerError"
 */
router.patch('/:id/config', requireGuildAdmin, validateGuild, async (req, res) => {
  if (!req.body) {
    return res.status(400).json({ error: 'Request body is required' });
  }

  const result = validateConfigPatchBody(req.body, SAFE_CONFIG_KEYS);
  if (result.error) {
    const path = typeof req.body?.path === 'string' ? req.body.path : undefined;
    const topLevelKey = path?.split('.')[0];
    warn('Config validation failed', {
      path,
      topLevelKey,
      error: result.error,
      details: result.details,
    });
    const response = { error: result.error };
    if (result.details) response.details = result.details;
    return res.status(result.status).json(response);
  }

  const { path, value, topLevelKey } = result;
  // botStatus is global (not per-guild) — only bot owners may write to it.
  const isGlobalBotStatusWrite = topLevelKey === 'botStatus';
  if (isGlobalBotStatusWrite && req.authMethod === 'oauth' && !isOAuthBotOwner(req.user)) {
    return res.status(403).json({ error: 'Only bot owners can update global bot status' });
  }
  const writeScope = isGlobalBotStatusWrite ? 'global' : req.params.id;

  try {
    await setConfigValue(path, value, writeScope === 'global' ? undefined : req.params.id);
    const effectiveConfig = writeScope === 'global' ? getConfig() : getConfig(req.params.id);
    const effectiveSection = effectiveConfig[topLevelKey] || {};
    const sensitivePattern = /key|secret|token|password/i;
    const logValue = sensitivePattern.test(path) ? '[REDACTED]' : value;
    info('Config updated via API', {
      path,
      value: logValue,
      guild: req.params.id,
      scope: writeScope,
    });
    res.json(effectiveSection);
  } catch (err) {
    error('Failed to update config via API', { path, error: err.message });
    res.status(500).json({ error: 'Failed to update config' });
  }
});

/**
 * @openapi
 * /guilds/{id}/config:
 *   put:
 *     summary: Bulk update guild configuration
 *     description: Apply multiple patch operations to a guild's configuration in a single transaction.
 *     tags: [Guilds]
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: object
 *               properties:
 *                 path:
 *                   type: string
 *                 value:
 *                   type: object
 *     responses:
 *       "200":
 *         $ref: "#/components/responses/ConfigResponse"
 *       "400":
 *         $ref: "#/components/responses/BadRequest"
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "403":
 *         $ref: "#/components/responses/Forbidden"
 *       "500":
 *         $ref: "#/components/responses/ServerError"
 */
router.put('/:id/config', requireGuildAdmin, validateGuild, async (req, res) => {
  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Request body must be an array of patches' });
  }

  const patches = req.body;
  const validatedPatches = [];

  for (const patch of patches) {
    const result = validateConfigPatchBody(patch, SAFE_CONFIG_KEYS);
    if (result.error) {
      const path = typeof patch?.path === 'string' ? patch.path : undefined;
      const topLevelKey = path?.split('.')[0];
      warn('Bulk config validation failed', {
        path,
        topLevelKey,
        error: result.error,
        details: result.details,
      });
      const response = { error: result.error };
      if (result.details) response.details = result.details;
      return res.status(result.status || 400).json(response);
    }

    // botStatus is global
    const isGlobalBotStatusWrite = result.topLevelKey === 'botStatus';
    if (isGlobalBotStatusWrite && req.authMethod === 'oauth' && !isOAuthBotOwner(req.user)) {
      return res.status(403).json({ error: 'Only bot owners can update global bot status' });
    }
    validatedPatches.push(result);
  }

  try {
    const globalPatches = validatedPatches.filter((patch) => patch.topLevelKey === 'botStatus');
    const guildPatches = validatedPatches.filter((patch) => patch.topLevelKey !== 'botStatus');

    if (globalPatches.length > 0) {
      await setMultipleConfigValues(globalPatches);
    }

    if (guildPatches.length > 0) {
      await setMultipleConfigValues(guildPatches, req.params.id);
    }

    const effectiveConfig = getConfig(req.params.id);

    info('Bulk config updated via API', {
      patchesCount: validatedPatches.length,
      guild: req.params.id,
    });

    // Responding with the full effective config minus sensitive fields
    res.json(maskSensitiveFields(effectiveConfig, READABLE_CONFIG_KEYS));
  } catch (err) {
    error('Failed to update bulk config via API', { guild: req.params.id, error: err.message });
    res.status(500).json({ error: 'Failed to update config' });
  }
});

/**
 * @openapi
 * /guilds/{id}/stats:
 *   get:
 *     tags:
 *       - Guilds
 *     summary: Guild statistics
 *     description: Returns aggregate guild statistics — member count, AI conversations, moderation cases, and uptime.
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Guild stats
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 guildId:
 *                   type: string
 *                 memberCount:
 *                   type: integer
 *                 aiConversations:
 *                   type: integer
 *                   description: Total AI conversations logged for this guild
 *                 moderationCases:
 *                   type: integer
 *                   description: Total moderation cases for this guild
 *                 uptime:
 *                   type: number
 *                   description: Bot process uptime in seconds
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "403":
 *         $ref: "#/components/responses/Forbidden"
 *       "404":
 *         $ref: "#/components/responses/NotFound"
 *       "500":
 *         $ref: "#/components/responses/ServerError"
 *       "503":
 *         $ref: "#/components/responses/ServiceUnavailable"
 */
router.get('/:id/stats', requireGuildAdmin, validateGuild, async (req, res) => {
  const { dbPool } = req.app.locals;

  if (!dbPool) {
    return res.status(503).json({ error: 'Database not available' });
  }

  try {
    const cacheKey = `guild:stats:${req.params.id}`;

    /**
     * Cache the DB-backed counts for TTL.CONFIG seconds.
     * Note: Pre-existing conversation rows (from before guild tracking was added)
     * may have NULL guild_id and won't be counted here. These will self-correct
     * as new conversations are created with the guild_id populated.
     */
    const { aiConversations, moderationCases } = await cacheGetOrSet(
      cacheKey,
      async () => {
        const [conversationResult, caseResult] = await Promise.all([
          dbPool.query('SELECT COUNT(*)::int AS count FROM conversations WHERE guild_id = $1', [
            req.params.id,
          ]),
          dbPool.query('SELECT COUNT(*)::int AS count FROM mod_cases WHERE guild_id = $1', [
            req.params.id,
          ]),
        ]);
        return {
          aiConversations: conversationResult.rows[0].count,
          moderationCases: caseResult.rows[0].count,
        };
      },
      TTL.CONFIG,
    );

    res.json({
      guildId: req.params.id,
      aiConversations,
      moderationCases,
      memberCount: req.guild.memberCount,
      uptime: process.uptime(),
    });
  } catch (err) {
    error('Failed to fetch stats', { error: err.message, guild: req.params.id });
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * @openapi
 * /guilds/{id}/analytics:
 *   get:
 *     tags:
 *       - Guilds
 *     summary: Guild analytics
 *     description: Returns time-series analytics data for dashboard charts — messages, joins/leaves, active members, AI usage, XP distribution, and more.
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: range
 *         schema:
 *           type: string
 *           enum: [today, week, month, custom]
 *           default: week
 *         description: Preset time range. Use 'custom' with from/to for a specific window.
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start of custom date range (ISO 8601). Required when range=custom.
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End of custom date range (ISO 8601). Required when range=custom.
 *       - in: query
 *         name: interval
 *         schema:
 *           type: string
 *           enum: [hour, day]
 *         description: Bucket size for time-series data. Auto-selected if omitted.
 *       - in: query
 *         name: compare
 *         schema:
 *           type: string
 *           enum: ["1", "true", "yes", "on"]
 *         description: When set, includes comparison data for the previous equivalent period.
 *       - in: query
 *         name: channelId
 *         schema:
 *           type: string
 *         description: Optional filter by channel ID
 *     responses:
 *       "200":
 *         description: Analytics dataset
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       "400":
 *         description: Invalid analytics query parameters
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
 *       "500":
 *         $ref: "#/components/responses/ServerError"
 *       "503":
 *         $ref: "#/components/responses/ServiceUnavailable"
 */
router.get('/:id/analytics', requireGuildAdmin, validateGuild, async (req, res) => {
  const { dbPool } = req.app.locals;

  if (!dbPool) {
    return res.status(503).json({ error: 'Database not available' });
  }

  try {
    const analyticsData = await getGuildAnalytics({
      dbPool,
      guild: req.guild,
      guildId: req.params.id,
      query: req.query,
    });

    return res.json(analyticsData);
  } catch (err) {
    if (err instanceof AnalyticsRangeValidationError) {
      return res.status(400).json({ error: err.message });
    }

    const analyticsContext =
      err !== null && typeof err === 'object' ? err.analyticsContext || {} : {};
    error('Failed to fetch analytics', {
      error: getErrorMessage(err),
      guild: req.params.id,
      ...analyticsContext,
    });
    return res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

/**
 * @openapi
 * /guilds/{id}/moderation:
 *   get:
 *     tags:
 *       - Guilds
 *     summary: Recent moderation cases
 *     description: Returns recent moderation cases for the guild overview. Requires moderator permissions.
 *     security:
 *       - ApiKeyAuth: []
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
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
 *     responses:
 *       "200":
 *         description: Moderation cases
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 cases:
 *                   type: array
 *                   items:
 *                     type: object
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *       "401":
 *         $ref: "#/components/responses/Unauthorized"
 *       "403":
 *         $ref: "#/components/responses/Forbidden"
 *       "404":
 *         $ref: "#/components/responses/NotFound"
 *       "500":
 *         $ref: "#/components/responses/ServerError"
 *       "503":
 *         $ref: "#/components/responses/ServiceUnavailable"
 */
router.get('/:id/moderation', requireGuildModerator, validateGuild, async (req, res) => {
  const { dbPool } = req.app.locals;

  if (!dbPool) {
    return res.status(503).json({ error: 'Database not available' });
  }

  const { page, limit, offset } = parsePagination(req.query);

  try {
    const [countResult, casesResult] = await Promise.all([
      dbPool.query('SELECT COUNT(*)::int AS count FROM mod_cases WHERE guild_id = $1', [
        req.params.id,
      ]),
      dbPool.query(
        `SELECT id, guild_id, case_number, action, target_id, target_tag,
                moderator_id, moderator_tag, reason, duration, expires_at,
                log_message_id, created_at
         FROM mod_cases
         WHERE guild_id = $1
         ORDER BY case_number DESC
         LIMIT $2 OFFSET $3`,
        [req.params.id, limit, offset],
      ),
    ]);

    res.json({
      page,
      limit,
      total: countResult.rows[0].count,
      cases: casesResult.rows,
    });
  } catch (err) {
    error('Failed to fetch moderation cases', { error: err.message, guild: req.params.id });
    res.status(500).json({ error: 'Failed to fetch moderation cases' });
  }
});

/**
 * @openapi
 * /guilds/{id}/actions:
 *   post:
 *     tags:
 *       - Guilds
 *     summary: Trigger guild action
 *     description: >
 *       Trigger a bot action on a guild. Supported actions: sendMessage (post a text message
 *       to a channel). Restricted to API-secret authentication only.
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *             properties:
 *               action:
 *                 type: string
 *                 description: The action to perform
 *     responses:
 *       "201":
 *         description: Message sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 channelId:
 *                   type: string
 *                 content:
 *                   type: string
 *       "400":
 *         description: Unknown action
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
 *       "500":
 *         $ref: "#/components/responses/ServerError"
 */
router.post('/:id/actions', requireGuildAdmin, validateGuild, async (req, res) => {
  if (req.authMethod !== 'api-secret') {
    return res.status(403).json({ error: 'Actions endpoint requires API secret authentication' });
  }

  if (!req.body) {
    return res.status(400).json({ error: 'Missing request body' });
  }

  const { action, channelId, content } = req.body;

  if (!action) {
    return res.status(400).json({ error: 'Missing "action" in request body' });
  }

  if (action === 'sendMessage') {
    if (!channelId || !content) {
      return res.status(400).json({ error: 'Missing "channelId" or "content" for sendMessage' });
    }

    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content must be a string' });
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      return res
        .status(400)
        .json({ error: `Content exceeds ${MAX_CONTENT_LENGTH} character limit` });
    }

    // Validate channel belongs to guild
    const channel = req.guild.channels.cache.get(channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found in this guild' });
    }

    if (!channel.isTextBased()) {
      return res.status(400).json({ error: 'Channel is not a text channel' });
    }

    try {
      // safeSend sanitizes mentions internally via prepareOptions() → sanitizeMessageOptions()
      const message = await safeSend(channel, content);
      info('Message sent via API', { guild: req.params.id, channel: channelId });
      // If content exceeded 2000 chars, safeSend splits into multiple messages;
      // we return the first chunk's content and ID
      const sent = Array.isArray(message) ? message[0] : message;
      res.status(201).json({ id: sent.id, channelId, content: sent.content });
    } catch (err) {
      error('Failed to send message via API', { error: err.message, guild: req.params.id });
      res.status(500).json({ error: 'Failed to send message' });
    }
  } else {
    res.status(400).json({ error: 'Unsupported action type' });
  }
});

export default router;
