/**
 * InteractionCreate Event Dispatcher
 *
 * Single interactionCreate listener that routes to all component handlers.
 * Each handler returns true if it handled the interaction, false otherwise.
 */

import { Events } from 'discord.js';
import { error as logError } from '../../logger.js';
import { handlePollButton } from '../handlers/pollHandler.js';
import { handleReviewButton } from '../handlers/reviewHandler.js';
import {
  handleTicketCloseButton,
  handleTicketModal,
  handleTicketOpenButton,
} from '../handlers/ticketHandler.js';
import {
  handleWelcomeOnboarding,
  registerWelcomeOnboardingHandlers,
} from '../handlers/welcomeOnboardingHandler.js';

// Backward-compatible re-exports (deprecated — use handler functions directly)
export { registerPollButtonHandler } from '../handlers/pollHandler.js';
export { registerReviewClaimHandler } from '../handlers/reviewHandler.js';
export {
  registerTicketCloseButtonHandler,
  registerTicketModalHandler,
  registerTicketOpenButtonHandler,
} from '../handlers/ticketHandler.js';
export { registerWelcomeOnboardingHandlers };

/** @type {Array<(interaction: import('discord.js').Interaction) => Promise<boolean>>} */
const handlers = [
  handlePollButton,
  handleReviewButton,
  handleTicketOpenButton,
  handleTicketModal,
  handleTicketCloseButton,
  handleWelcomeOnboarding,
];

/**
 * Register a single interactionCreate listener that dispatches to all component handlers.
 *
 * @param {import('discord.js').Client} client - Discord client instance
 */
export function registerComponentHandlers(client) {
  client.on(Events.InteractionCreate, async (interaction) => {
    for (const handler of handlers) {
      try {
        const handled = await handler(interaction);
        if (handled) return;
      } catch (err) {
        logError('Interaction handler threw unexpectedly', {
          handler: handler.name,
          customId: interaction.customId,
          error: err?.message,
        });
        return;
      }
    }
  });
}
