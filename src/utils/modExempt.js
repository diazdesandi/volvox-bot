/**
 * Shared mod/admin exemption check.
 * Used by rate limiting and link filter modules to avoid duplicating
 * the same isExempt logic in both places.
 */

import { PermissionFlagsBits } from 'discord.js';
import { getConfiguredRoleIds } from './permissions.js';

/**
 * Check whether a message author has mod/admin permissions and should be
 * exempted from automated moderation actions.
 *
 * Exempt if the member:
 *  - has the ADMINISTRATOR Discord permission, OR
 *  - holds any role in `config.permissions.adminRoleIds` (array), OR
 *  - holds any role in `config.permissions.moderatorRoleIds` (array), OR
 *  - holds any role ID or name listed in `config.permissions.modRoles` (array)
 *
 * Backward compat: also checks singular `adminRoleId` / `moderatorRoleId` fields
 * so old configs continue to work without migration.
 *
 * @param {import('discord.js').Message} message
 * @param {Object} config - Merged guild config
 * @returns {boolean}
 */
export function isExempt(message, config) {
  const member = message.member;
  if (!member) return false;

  // ADMINISTRATOR permission bypasses everything
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  // Array role IDs — new schema (permissions.adminRoleIds / moderatorRoleIds)
  // Use getConfiguredRoleIds to handle configs that have both the new empty-array default
  // AND the old singular field set from a legacy guild override.
  const { adminRoleIds, moderatorRoleIds } = getConfiguredRoleIds(config);
  if (adminRoleIds.some((id) => member.roles.cache.has(id))) return true;
  if (moderatorRoleIds.some((id) => member.roles.cache.has(id))) return true;

  // Custom protection roles — protectRoles.roleIds entries are shielded from
  // slash commands via isProtectedTarget, but they should also be exempt from
  // automated moderation (AI auto-mod, rate limiting, link filters).
  const protectedRoleIds = config.moderation?.protectRoles?.roleIds || [];
  if (protectedRoleIds.some((id) => member.roles.cache.has(id))) return true;

  // Legacy / test-facing array of role IDs or names (permissions.modRoles)
  const modRoles = config.permissions?.modRoles ?? [];
  if (modRoles.length === 0) return false;

  return member.roles.cache.some(
    (role) => modRoles.includes(role.id) || modRoles.includes(role.name),
  );
}
