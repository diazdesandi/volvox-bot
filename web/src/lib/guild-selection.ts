export const SELECTED_GUILD_KEY = 'volvox-bot-selected-guild';
export const GUILD_SELECTED_EVENT = 'volvox-bot:guild-selected';
export const GUILD_SELECTION_CLEARED_EVENT = 'volvox-bot:guild-selection-cleared';

function dispatchSelectedGuild(guildId: string): void {
  window.dispatchEvent(
    new CustomEvent<string>(GUILD_SELECTED_EVENT, {
      detail: guildId,
      cancelable: true,
    }),
  );
}

/**
 * Persist and broadcast guild selection changes so dashboard views can react immediately.
 *
 * This helper writes to localStorage before dispatching the in-tab custom event.
 */
export function broadcastSelectedGuild(guildId: string): void {
  if (typeof window === 'undefined') return;

  const normalizedGuildId = guildId.trim();
  if (!normalizedGuildId) return;
  try {
    const currentGuildId = window.localStorage.getItem(SELECTED_GUILD_KEY)?.trim() ?? '';
    if (currentGuildId === normalizedGuildId) {
      return;
    }
  } catch {
    // localStorage may be unavailable in strict browser contexts
  }

  try {
    window.localStorage.setItem(SELECTED_GUILD_KEY, normalizedGuildId);
  } catch {
    // localStorage may be unavailable in strict browser contexts
  }

  dispatchSelectedGuild(normalizedGuildId);
}

/**
 * Clear the persisted guild selection and notify dashboard consumers.
 */
export function clearSelectedGuild(): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(SELECTED_GUILD_KEY);
  } catch {
    // localStorage may be unavailable in strict browser contexts
  }

  dispatchSelectedGuild('');
}

/**
 * Force-clear the persisted guild selection after the selected guild becomes invalid.
 *
 * This intentionally uses a separate, non-cancelable event so unsaved-change guards
 * for user-initiated guild switches cannot keep other dashboard contexts on a stale guild.
 */
export function forceClearSelectedGuild(): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(SELECTED_GUILD_KEY);
  } catch {
    // localStorage may be unavailable in strict browser contexts
  }

  window.dispatchEvent(
    new CustomEvent<string>(GUILD_SELECTION_CLEARED_EVENT, {
      detail: '',
    }),
  );
}
