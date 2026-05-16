/**
 * Welcome Onboarding Handlers
 * Handles Discord button interactions for rules acceptance.
 */

import { error as logError } from '../../logger.js';
import { safeEditReply } from '../../utils/safeSend.js';
import { getConfig } from '../config.js';
import { handleRulesAcceptButton, RULES_ACCEPT_BUTTON_ID } from '../welcomeOnboarding.js';

/**
 * Handle welcome onboarding interactions.
 *
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>} true if handled, false if not applicable
 */
export async function handleWelcomeOnboarding(interaction) {
  const guildId = interaction.guildId;
  if (!guildId) return false;

  const guildConfig = getConfig(guildId);
  if (!guildConfig.welcome?.enabled) return false;

  if (interaction.isButton() && interaction.customId === RULES_ACCEPT_BUTTON_ID) {
    try {
      await handleRulesAcceptButton(interaction, guildConfig);
    } catch (err) {
      logError('Rules acceptance handler failed', {
        guildId,
        userId: interaction.user?.id,
        error: err?.message,
      });

      try {
        await safeEditReply(interaction, {
          content: '❌ Failed to verify. Please ping an admin.',
        });
      } catch {
        // ignore
      }
    }
    return true;
  }

  return false;
}

/** @deprecated Use handleWelcomeOnboarding directly */
export function registerWelcomeOnboardingHandlers(client) {
  client.on('interactionCreate', handleWelcomeOnboarding);
}
