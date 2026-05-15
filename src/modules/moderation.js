/**
 * Moderation Module
 * Shared logic for case management, DM notifications, mod log posting,
 * auto-escalation, and tempban scheduling.
 */

import { EmbedBuilder } from 'discord.js';
import { getPool } from '../db.js';
import { info, error as logError, warn as logWarn } from '../logger.js';
import { fetchChannelCached } from '../utils/discordCache.js';
import { parseDuration } from '../utils/duration.js';
import { getConfiguredRoleIds } from '../utils/permissions.js';
import { safeSend } from '../utils/safeSend.js';
import { getConfig } from './config.js';
import { createWarning } from './warningEngine.js';
import { fireEvent } from './webhookNotifier.js';

/**
 * Color map for mod log embeds by action type.
 * @type {Record<string, number>}
 */
export const ACTION_COLORS = {
  warn: 0xfee75c,
  kick: 0xed4245,
  timeout: 0xe67e22,
  untimeout: 0x57f287,
  ban: 0xed4245,
  tempban: 0xed4245,
  unban: 0x57f287,
  softban: 0xed4245,
  purge: 0x5865f2,
  lock: 0xe67e22,
  unlock: 0x57f287,
  slowmode: 0x5865f2,
};

/**
 * Past-participle labels used in DM notifications and moderator success replies.
 * Values must work after "has been" / "You have been" (e.g. "has been warned").
 * @type {Record<string, string>}
 */
export const ACTION_PAST_TENSE = {
  warn: 'warned',
  kick: 'kicked',
  timeout: 'timed out',
  untimeout: 'removed from timeout',
  ban: 'banned',
  tempban: 'temporarily banned',
  unban: 'unbanned',
  softban: 'soft-banned',
  purge: 'purged',
  lock: 'locked',
  unlock: 'unlocked',
  slowmode: 'put in slowmode',
};

/**
 * Channel config key for each action type (maps to moderation.logging.channels.*).
 * @type {Record<string, string>}
 */
export const ACTION_LOG_CHANNEL_KEY = {
  warn: 'warns',
  kick: 'kicks',
  timeout: 'timeouts',
  untimeout: 'timeouts',
  ban: 'bans',
  tempban: 'bans',
  unban: 'bans',
  softban: 'bans',
  purge: 'purges',
  lock: 'locks',
  unlock: 'locks',
  slowmode: 'locks',
};

/** @type {ReturnType<typeof setInterval> | null} */
let schedulerInterval = null;

/** @type {boolean} */
let schedulerPollInFlight = false;

/**
 * Insert a mod case row inside an existing transaction.
 * Acquires a per-guild advisory lock to serialise case-number generation.
 *
 * @param {import('pg').PoolClient} client - Active transaction client
 * @param {string} guildId
 * @param {Object} data
 * @returns {Promise<Object>} Created case row
 */
async function insertModCase(client, guildId, data) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [guildId]);

  const { rows } = await client.query(
    `INSERT INTO mod_cases
      (
        guild_id,
        case_number,
        action,
        target_id,
        target_tag,
        moderator_id,
        moderator_tag,
        reason,
        duration,
        expires_at
      )
    VALUES (
      $1,
      COALESCE((SELECT MAX(case_number) FROM mod_cases WHERE guild_id = $1), 0) + 1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      $9
    )
    RETURNING *`,
    [
      guildId,
      data.action,
      data.targetId,
      data.targetTag,
      data.moderatorId,
      data.moderatorTag,
      data.reason || null,
      data.duration || null,
      data.expiresAt || null,
    ],
  );

  return rows[0];
}

/**
 * Create a moderation case in the database.
 * Uses a per-guild advisory lock to atomically assign sequential case numbers.
 * @param {string} guildId - Discord guild ID
 * @param {Object} data - Case data
 * @param {string} data.action - Action type (warn, kick, ban, etc.)
 * @param {string} data.targetId - Target user ID
 * @param {string} data.targetTag - Target user tag
 * @param {string} data.moderatorId - Moderator user ID
 * @param {string} data.moderatorTag - Moderator user tag
 * @param {string} [data.reason] - Reason for action
 * @param {string} [data.duration] - Duration string (for timeout/tempban)
 * @param {Date} [data.expiresAt] - Expiration timestamp
 * @returns {Promise<Object>} Created case row
 */
export async function createCase(guildId, data) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const createdCase = await insertModCase(client, guildId, data);

    await client.query('COMMIT');

    info('Moderation case created', {
      guildId,
      caseNumber: createdCase.case_number,
      action: data.action,
      target: data.targetTag,
      moderator: data.moderatorTag,
    });

    // Fire webhook notification — fire-and-forget, don't block case creation
    fireEvent('moderation.action', guildId, {
      action: data.action,
      caseNumber: createdCase.case_number,
      targetId: data.targetId,
      targetTag: data.targetTag,
      moderatorId: data.moderatorId,
      moderatorTag: data.moderatorTag,
      reason: data.reason || null,
    }).catch(() => {});

    return createdCase;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Atomically create a warn moderation case and linked warning record.
 * The moderation.action webhook is fired only after both records commit, so warning persistence
 * failures cannot leave dashboard/history/webhook state claiming a warn succeeded.
 * @param {string} guildId - Discord guild ID
 * @param {Object} caseData - Moderation case data
 * @param {string} caseData.targetId - Target user ID
 * @param {string} caseData.targetTag - Target user tag
 * @param {string} caseData.moderatorId - Moderator user ID
 * @param {string} caseData.moderatorTag - Moderator user tag
 * @param {string} [caseData.reason] - Reason for action
 * @param {Object} warningData - Warning data
 * @param {string} warningData.userId - Target user ID
 * @param {string} warningData.moderatorId - Moderator user ID
 * @param {string} warningData.moderatorTag - Moderator display tag
 * @param {string} [warningData.reason] - Reason for the warning
 * @param {string} [warningData.severity='low'] - Warning severity
 * @param {Object} [config] - Bot configuration used to determine warning points and expiry
 * @returns {Promise<{caseData: Object, warning: Object}>} Created case and warning rows
 */
export async function createWarnCaseWithWarning(guildId, caseData, warningData, config) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const createdCase = await insertModCase(client, guildId, {
      action: 'warn',
      targetId: caseData.targetId,
      targetTag: caseData.targetTag,
      moderatorId: caseData.moderatorId,
      moderatorTag: caseData.moderatorTag,
      reason: caseData.reason,
    });

    const warning = await createWarning(
      guildId,
      {
        userId: warningData.userId,
        moderatorId: warningData.moderatorId,
        moderatorTag: warningData.moderatorTag,
        reason: warningData.reason,
        severity: warningData.severity,
        caseId: createdCase.id,
      },
      config,
      { client },
    );

    await client.query('COMMIT');

    info('Moderation case created', {
      guildId,
      caseNumber: createdCase.case_number,
      action: 'warn',
      target: caseData.targetTag,
      moderator: caseData.moderatorTag,
    });

    fireEvent('moderation.action', guildId, {
      action: 'warn',
      caseNumber: createdCase.case_number,
      targetId: caseData.targetId,
      targetTag: caseData.targetTag,
      moderatorId: caseData.moderatorId,
      moderatorTag: caseData.moderatorTag,
      reason: caseData.reason || null,
    }).catch(() => {});

    return { caseData: createdCase, warning };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Schedule a moderation action for future execution.
 * @param {string} guildId - Discord guild ID
 * @param {string} action - Action type (e.g. unban)
 * @param {string} targetId - Target user ID
 * @param {number|null} caseId - Related case ID (if any)
 * @param {Date} executeAt - When to execute the action
 * @returns {Promise<Object>} Created scheduled action row
 */
export async function scheduleAction(guildId, action, targetId, caseId, executeAt) {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO mod_scheduled_actions
      (guild_id, action, target_id, case_id, execute_at)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *`,
    [guildId, action, targetId, caseId || null, executeAt],
  );

  return rows[0];
}

/**
 * Send a DM embed to a guild member notifying them of a moderation action.
 *
 * The embed includes the action (past-tense form), the provided reason, and a timestamp.
 * Sending failures (for example, DMs disabled) are caught and ignored.
 *
 * @param {import('discord.js').GuildMember} member - Target guild member to message.
 * @param {string} action - Moderation action key used to determine the embed title and default color.
 * @param {string|null} reason - Reason shown in the embed; if null, displays "No reason provided".
 * @param {string} guildName - Guild name used when composing the default title.
 * @param {{ title?: string, colorAction?: string }} [options] - Optional overrides: `title` replaces the default DM title; `colorAction` selects the color key from action color mappings.
 */
export async function sendDmNotification(member, action, reason, guildName, options = {}) {
  const pastTense = ACTION_PAST_TENSE[action] || action;
  const title = options.title ?? `You have been ${pastTense} in ${guildName}`;
  const colorAction = options.colorAction ?? action;
  const embed = new EmbedBuilder()
    .setColor(ACTION_COLORS[colorAction] || ACTION_COLORS[action] || 0x5865f2)
    .setTitle(title)
    .addFields({ name: 'Reason', value: reason || 'No reason provided' })
    .setTimestamp();

  try {
    await member.send({ embeds: [embed] });
  } catch (err) {
    // 50007 = Cannot send messages to this user (DMs disabled or bot blocked)
    if (err.code !== 50007) {
      logError('Failed to send DM notification', { error: err.message, userId: member.id });
    }
  }
}

/**
 * Post a moderation log embed for a case to the configured logging channel.
 *
 * Attempts to send an embed describing the case to the channel determined by
 * the moderation logging configuration. On successful send it records the
 * sent message's ID on the case row (logging any storage failures) and returns
 * the sent message; if sending or channel resolution fails, returns `null`.
 *
 * @param {import('discord.js').Client} client - Discord client instance used to resolve channels.
 * @param {Object} config - Bot configuration object containing moderation.logging.channels.
 * @param {Object} caseData - Case object returned by createCase(), including at least `id`, `case_number`, `action`, `target_id`, `target_tag`, `moderator_id`, `moderator_tag`, and optional `reason`, `duration`, `created_at`.
 * @returns {import('discord.js').Message|null} The sent log message if delivered, `null` if no message was sent.
 */
export async function sendModLogEmbed(client, config, caseData) {
  const channels = config.moderation?.logging?.channels;
  if (!channels) return null;

  const actionKey = ACTION_LOG_CHANNEL_KEY[caseData.action];
  const channelId = channels[actionKey] || channels.default;
  if (!channelId) return null;

  const channel = await fetchChannelCached(client, channelId, caseData.guild_id);
  if (!channel) return null;

  const embed = new EmbedBuilder()
    .setColor(ACTION_COLORS[caseData.action] || 0x5865f2)
    .setTitle(`Case #${caseData.case_number} — ${caseData.action.toUpperCase()}`)
    .addFields(
      { name: 'Target', value: `<@${caseData.target_id}> (${caseData.target_tag})`, inline: true },
      {
        name: 'Moderator',
        value: `<@${caseData.moderator_id}> (${caseData.moderator_tag})`,
        inline: true,
      },
      { name: 'Reason', value: caseData.reason || 'No reason provided' },
    )
    .setTimestamp(caseData.created_at ? new Date(caseData.created_at) : new Date())
    .setFooter({ text: `Case #${caseData.case_number}` });

  if (caseData.duration) {
    embed.addFields({ name: 'Duration', value: caseData.duration, inline: true });
  }

  try {
    const sentMessage = await safeSend(channel, { embeds: [embed] });

    // Store log message ID for future editing
    try {
      const pool = getPool();
      await pool.query('UPDATE mod_cases SET log_message_id = $1 WHERE id = $2', [
        sentMessage.id,
        caseData.id,
      ]);
    } catch (err) {
      logError('Failed to store log message ID', {
        caseId: caseData.id,
        messageId: sentMessage.id,
        error: err.message,
      });
    }

    return sentMessage;
  } catch (err) {
    logWarn('Failed to send mod log embed', { error: err.message, channelId });
    return null;
  }
}

/**
 * Count active warnings for a user within a threshold window.
 * Falls back to mod_cases if the warnings table doesn't exist yet.
 */
async function countActiveWarnings(pool, guildId, targetId, withinDays) {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::integer AS count FROM warnings
       WHERE guild_id = $1 AND user_id = $2 AND active = TRUE
       AND (expires_at IS NULL OR expires_at > NOW())
       AND created_at > NOW() - INTERVAL '1 day' * $3`,
      [guildId, targetId, withinDays],
    );
    return rows[0]?.count || 0;
  } catch (err) {
    if (err.code === '42P01') {
      // 42P01 = undefined_table — fall back to mod_cases
      const { rows } = await pool.query(
        `SELECT COUNT(*)::integer AS count FROM mod_cases
         WHERE guild_id = $1 AND target_id = $2 AND action = 'warn'
         AND created_at > NOW() - INTERVAL '1 day' * $3`,
        [guildId, targetId, withinDays],
      );
      return rows[0]?.count || 0;
    }
    logError('Failed to count active warnings for escalation', {
      error: err.message,
      guildId,
      targetId,
    });
    throw err;
  }
}

/**
 * Execute a single escalation action (timeout or ban) and create the mod case.
 */
async function executeEscalationAction(
  client,
  config,
  guildId,
  targetId,
  moderatorId,
  moderatorTag,
  threshold,
  reason,
) {
  const guild = await client.guilds.fetch(guildId);
  const member = await guild.members.fetch(targetId).catch(() => null);

  if (threshold.action === 'timeout' && member) {
    const ms = parseDuration(threshold.duration);
    if (ms) {
      await member.timeout(ms, reason);
    }
  } else if (threshold.action === 'ban') {
    await guild.members.ban(targetId, { reason });
  }

  const escalationCase = await createCase(guildId, {
    action: threshold.action,
    targetId,
    targetTag: member?.user?.tag || targetId,
    moderatorId,
    moderatorTag,
    reason,
    duration: threshold.duration || null,
  });

  await sendModLogEmbed(client, config, escalationCase);
  return escalationCase;
}

/**
 * Evaluate configured escalation thresholds for a guild target and apply the first matching escalation.
 *
 * If a threshold is met, performs the configured action (e.g., timeout or ban), creates a moderation case, and posts the mod-log for the escalation.
 *
 * @param {import('discord.js').Client} client - Discord client instance.
 * @param {string} guildId - ID of the guild where escalation is evaluated.
 * @param {string} targetId - ID of the target user being evaluated.
 * @param {string} moderatorId - ID used as the moderator for the escalation case (typically the bot).
 * @param {string} moderatorTag - Tag to record for the moderator in the created case.
 * @param {Object} config - Bot configuration containing moderation.escalation settings and thresholds.
 * @returns {Object|null} The created escalation case object when an escalation is applied, `null` if no thresholds triggered or on failure.
 */
export async function checkEscalation(
  client,
  guildId,
  targetId,
  moderatorId,
  moderatorTag,
  config,
) {
  if (!config.moderation?.escalation?.enabled) return null;

  const thresholds = config.moderation.escalation.thresholds;
  if (!thresholds?.length) return null;

  const pool = getPool();

  for (const threshold of thresholds) {
    const warnCount = await countActiveWarnings(pool, guildId, targetId, threshold.withinDays);
    if (warnCount < threshold.warns) continue;

    const reason = `Auto-escalation: ${warnCount} active warns in ${threshold.withinDays} days`;
    info('Escalation triggered', { guildId, targetId, warnCount, threshold });

    try {
      return await executeEscalationAction(
        client,
        config,
        guildId,
        targetId,
        moderatorId,
        moderatorTag,
        threshold,
        reason,
      );
    } catch (err) {
      logError('Escalation action failed', { error: err.message, guildId, targetId, threshold });
      return null;
    }
  }

  return null;
}

/**
 * Poll for expired tempbans and execute unbans.
 * @param {import('discord.js').Client} client - Discord client
 */
async function pollTempbans(client) {
  if (schedulerPollInFlight) {
    return;
  }

  schedulerPollInFlight = true;

  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM mod_scheduled_actions
       WHERE executed = FALSE AND execute_at <= NOW()
       ORDER BY execute_at ASC
       LIMIT 50`,
    );

    for (const row of rows) {
      // Use a transaction to ensure atomicity:
      // 1. Lock the row with FOR UPDATE SKIP LOCKED
      // 2. Execute Discord unban
      // 3. Only mark executed after successful unban
      const txClient = await pool.connect();
      let txCommitted = false;
      try {
        await txClient.query('BEGIN');

        // Lock the row - skip if already executed by another poll
        const { rows: lockRows } = await txClient.query(
          'SELECT id FROM mod_scheduled_actions WHERE id = $1 AND executed = FALSE FOR UPDATE SKIP LOCKED',
          [row.id],
        );
        if (lockRows.length === 0) {
          await txClient.query('ROLLBACK');
          continue; // Already handled by another poll
        }

        // Execute the Discord unban FIRST (before marking executed)
        // Track any error for logging, but don't throw - we still mark as executed
        // to prevent infinite retry on non-recoverable errors
        let unbanError = null;
        const guild = await client.guilds.fetch(row.guild_id);
        try {
          await guild.members.unban(row.target_id, 'Tempban expired');
        } catch (err) {
          unbanError = err;
          // Unknown Ban (code 10026) means already unbanned - not really an error
          const isAlreadyUnbanned = err?.code === 10026 || /Unknown Ban/i.test(err?.message || '');
          if (isAlreadyUnbanned) {
            info('Tempban target already unbanned; finalizing scheduled action', {
              id: row.id,
              guildId: row.guild_id,
              targetId: row.target_id,
            });
            unbanError = null; // Clear error - this is success
          }
        }

        // Mark executed regardless of unban outcome to prevent infinite retry
        await txClient.query('UPDATE mod_scheduled_actions SET executed = TRUE WHERE id = $1', [
          row.id,
        ]);
        await txClient.query('COMMIT');
        txCommitted = true;

        // Log unban failure AFTER successful commit (if there was a real error)
        if (unbanError) {
          logError('Failed to unban tempban target (marked as executed to prevent retry)', {
            error: unbanError.message,
            id: row.id,
            guildId: row.guild_id,
            targetId: row.target_id,
          });
        }
      } catch (err) {
        // Only reach here on transaction/DB errors (not unban errors)
        await txClient.query('ROLLBACK').catch(() => {});
        logError('Failed to process expired tempban', {
          error: err.message,
          id: row.id,
          guildId: row.guild_id,
          targetId: row.target_id,
        });
        // Action remains unexecuted (executed = FALSE) and will be retried on next poll
      } finally {
        txClient.release();
      }

      if (!txCommitted) continue;

      // Post-commit work (outside transaction): create case, send mod-log
      // These are non-critical - failures here don't affect the unban itself
      try {
        const targetUser = await client.users.fetch(row.target_id).catch(() => null);

        // Create unban case
        const config = getConfig(row.guild_id);
        const unbanCase = await createCase(row.guild_id, {
          action: 'unban',
          targetId: row.target_id,
          targetTag: targetUser?.tag || row.target_id,
          moderatorId: client.user?.id || 'system',
          moderatorTag: client.user?.tag || 'System',
          reason: `Tempban expired (case #${row.case_id ? row.case_id : 'unknown'})`,
        });

        await sendModLogEmbed(client, config, unbanCase);

        info('Tempban expired, user unbanned', {
          guildId: row.guild_id,
          targetId: row.target_id,
        });
      } catch (err) {
        // Log but don't retry - the unban itself succeeded, just the logging failed
        logError('Post-commit work failed for tempban (unban already executed)', {
          error: err.message,
          id: row.id,
          guildId: row.guild_id,
          targetId: row.target_id,
        });
      }
    }
  } catch (err) {
    logError('Tempban scheduler poll error', { error: err.message });
  } finally {
    schedulerPollInFlight = false;
  }
}

/**
 * Start the tempban scheduler polling interval.
 * Polls every 60 seconds for expired tempbans.
 * Runs an immediate check on startup to catch missed unbans.
 * @param {import('discord.js').Client} client - Discord client
 */
export function startTempbanScheduler(client) {
  if (schedulerInterval) return;

  // Immediate check on startup
  pollTempbans(client).catch((err) => {
    logError('Initial tempban poll failed', { error: err.message });
  });

  schedulerInterval = setInterval(() => {
    pollTempbans(client).catch((err) => {
      logError('Tempban poll failed', { error: err.message });
    });
  }, 60000);

  info('Tempban scheduler started');
}

/**
 * Stop the tempban scheduler.
 */
export function stopTempbanScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    info('Tempban scheduler stopped');
  }
}

/**
 * Determine whether a guild member is protected from moderation actions.
 * Protection is driven by the guild's live moderation.protectRoles settings (server owner, admin/moderator roles, and explicit role IDs).
 * @param {import('discord.js').GuildMember} target - Member to evaluate.
 * @param {import('discord.js').Guild} guild - Guild containing the member.
 * @returns {boolean} `true` if the member is protected from moderation actions, `false` otherwise.
 */
export function isProtectedTarget(target, guild) {
  // Fetch config per-invocation so live config edits take effect immediately.
  const config = getConfig(guild.id);
  /**
   * When the protectRoles block is missing from persisted configuration,
   * fall back to the intended defaults: protection enabled, include owner,
   * admins, and moderators (matches config.json defaults and web UI defaults).
   */
  const defaultProtectRoles = {
    enabled: true,
    includeAdmins: true,
    includeModerators: true,
    includeServerOwner: true,
    roleIds: [],
  };

  // Deep-merge defaults so a partial persisted object (e.g. only roleIds set)
  // never leaves enabled/include* as undefined/falsy.
  const protectRoles = { ...defaultProtectRoles, ...config.moderation?.protectRoles };
  if (!protectRoles.enabled) {
    return false;
  }

  // Server owner is always protected when enabled
  if (protectRoles.includeServerOwner && target.id === guild.ownerId) {
    return true;
  }

  // Resolve admin/moderator role ID arrays — getConfiguredRoleIds handles the case where
  // defaults inject adminRoleIds:[] alongside a legacy adminRoleId guild override
  const { adminRoleIds, moderatorRoleIds } = getConfiguredRoleIds(config);

  const protectedRoleIds = [
    ...(protectRoles.includeAdmins ? adminRoleIds : []),
    ...(protectRoles.includeModerators ? moderatorRoleIds : []),
    ...(Array.isArray(protectRoles.roleIds) ? protectRoles.roleIds : []),
  ].filter(Boolean);

  if (protectedRoleIds.length === 0) return false;

  const memberRoleIds = [...target.roles.cache.keys()];
  return protectedRoleIds.some((roleId) => memberRoleIds.includes(roleId));
}

/**
 * Check if the moderator (and optionally the bot) can moderate a target member.
 * @param {import('discord.js').GuildMember} moderator - The moderator
 * @param {import('discord.js').GuildMember} target - The target member
 * @param {import('discord.js').GuildMember|null} [botMember=null] - The bot's own guild member
 * @returns {string|null} Error message if cannot moderate, null if OK
 */
export function checkHierarchy(moderator, target, botMember = null) {
  if (target.roles.highest.position >= moderator.roles.highest.position) {
    return '❌ You cannot moderate a member with an equal or higher role than yours.';
  }
  if (botMember && target.roles.highest.position >= botMember.roles.highest.position) {
    return '❌ I cannot moderate this member — my role is not high enough.';
  }
  return null;
}

/**
 * Check if DM notification is enabled for an action type.
 * @param {Object} config - Bot configuration
 * @param {string} action - Action type
 * @returns {boolean} True if DM should be sent
 */
export function shouldSendDm(config, action) {
  return config.moderation?.dmNotifications?.[action] === true;
}
