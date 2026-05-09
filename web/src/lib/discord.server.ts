import 'server-only';

import { createHash } from 'node:crypto';
import { getBotApiBaseUrl } from '@/lib/bot-api';
import { logger } from '@/lib/logger';
import type { BotGuild, DiscordGuild, MutualGuild } from '@/types/discord';

const DISCORD_API_BASE = 'https://discord.com/api/v10';

/** Maximum number of retry attempts for rate-limited requests. */
const MAX_RETRIES = 3;

/** Default maximum delay we'll honor from a single retry-after header. */
const DEFAULT_MAX_RETRY_DELAY_MS = 5_000;

/** Default total time budget to spend sleeping across all retries. */
const DEFAULT_TOTAL_RETRY_BUDGET_MS = 8_000;

/** Discord returns at most 200 guilds per page. */
const GUILDS_PER_PAGE = 200;
export const USER_GUILDS_REQUEST_TIMEOUT_MS = 10_000;
export const BOT_GUILD_ACCESS_FALLBACK_TIMEOUT_MS = 2_500;
const MAX_ACCESS_LOOKUP_GUILDS = 100;
const BOT_GUILD_ACCESS_FALLBACK_MAX_GUILDS = MAX_ACCESS_LOOKUP_GUILDS;
const DISCORD_CDN = 'https://cdn.discordapp.com';
const inFlightUserGuildRequests = new Map<string, Promise<DiscordGuild[]>>();
const BOT_GUILD_ACCESS_LEVELS = new Set<BotGuildAccessLevel>(['viewer', 'moderator', 'admin']);
const ADMINISTRATOR_PERMISSION = 0x8n;
const MANAGE_GUILD_PERMISSION = 0x20n;
const KICK_MEMBERS_PERMISSION = 0x2n;
const BAN_MEMBERS_PERMISSION = 0x4n;
const MODERATE_MEMBERS_PERMISSION = 0x10000000000n;

export type BotGuildAccessLevel = 'viewer' | 'moderator' | 'admin';

export interface BotGuildAccessEntry {
  id: string;
  access: BotGuildAccessLevel;
  present?: boolean;
}

interface GetMutualGuildsOptions {
  userId?: string;
}

interface FetchWithRateLimitOptions extends RequestInit {
  rateLimit?: {
    maxRetries?: number;
    maxRetryDelayMs?: number;
    totalRetryBudgetMs?: number;
  };
}

class DiscordUserGuildFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DiscordUserGuildFetchError';
  }
}

function parseRetryAfterMs(response: Response): number {
  const retryAfter = response.headers.get('retry-after');
  const resetAfter = response.headers.get('x-ratelimit-reset-after');

  const parseSeconds = (value: string | null): number | null => {
    if (!value) {
      return null;
    }
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : null;
  };

  return parseSeconds(retryAfter) ?? parseSeconds(resetAfter) ?? 1000;
}

function getUserGuildRequestKey(accessToken: string): string {
  return createHash('sha256').update(accessToken).digest('hex');
}

function getAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function getGuildIconUrl(guildId: string, iconHash: string | null, size = 128): string | null {
  if (!iconHash) return null;
  const ext = iconHash.startsWith('a_') ? 'gif' : 'webp';
  return `${DISCORD_CDN}/icons/${guildId}/${iconHash}.${ext}?size=${size}`;
}

function getDiscordGuildAccess(guild: DiscordGuild): NonNullable<MutualGuild['access']> {
  if (guild.owner) return 'owner';

  try {
    const permissions = BigInt(guild.permissions);

    if ((permissions & ADMINISTRATOR_PERMISSION) === ADMINISTRATOR_PERMISSION) {
      return 'admin';
    }

    if (
      (permissions & MANAGE_GUILD_PERMISSION) === MANAGE_GUILD_PERMISSION ||
      (permissions & KICK_MEMBERS_PERMISSION) === KICK_MEMBERS_PERMISSION ||
      (permissions & BAN_MEMBERS_PERMISSION) === BAN_MEMBERS_PERMISSION ||
      (permissions & MODERATE_MEMBERS_PERMISSION) === MODERATE_MEMBERS_PERMISSION
    ) {
      return 'moderator';
    }
  } catch {
    return 'viewer';
  }

  return 'viewer';
}

/**
 * Create a MutualGuild from a DiscordGuild with its icon URL resolved and bot presence set to absent.
 *
 * @returns A `MutualGuild` object derived from `guild` where `icon` is the CDN URL computed from the guild's `icon` hash, `iconHash` preserves the original hash, and `botPresent` is `false`.
 */
function mapDiscordGuildToMutualGuild(guild: DiscordGuild): MutualGuild {
  const iconHash = guild.icon;
  return {
    ...guild,
    icon: getGuildIconUrl(guild.id, iconHash),
    iconHash,
    botPresent: false as const,
  };
}

/**
 * Map a bot-managed guild record into a MutualGuild that reflects the bot's presence and access level.
 *
 * @param guild - BotGuild object returned by the bot API to convert
 * @param access - The bot's access level for this guild
 * @returns A MutualGuild with `botPresent` set to `true`, fields populated from `guild`, and `access` set to `access`
 */
function mapBotGuildToMutualGuild(guild: BotGuild, access: BotGuildAccessLevel): MutualGuild {
  const iconHash = guild.iconHash ?? null;
  return {
    id: guild.id,
    name: guild.name,
    icon: guild.icon ?? getGuildIconUrl(guild.id, iconHash),
    iconHash,
    // Bot-backed fallback cannot know Discord owner/permission bitfields;
    // `access` from the bot API is authoritative for dashboard authorization.
    owner: false,
    permissions: '0',
    features: [],
    botPresent: true as const,
    access,
    config: guild.config,
  };
}

/**
 * Throw the abort reason if the provided AbortSignal is already aborted.
 *
 * @param signal - Optional AbortSignal to inspect
 * @throws The signal's abort reason if present; otherwise throws an AbortError (a DOMException)
 */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw getAbortReason(signal);
  }
}

function isAbortLikeError(error: unknown): boolean {
  return (
    error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

function isTransientUserGuildFetchError(error: unknown): boolean {
  if (isAbortLikeError(error) || error instanceof TypeError) {
    return true;
  }

  if (error instanceof DiscordUserGuildFetchError && typeof error.status === 'number') {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }

  return false;
}

function isDiscordUserGuildAuthFailure(error: unknown): boolean {
  return (
    error instanceof DiscordUserGuildFetchError && (error.status === 401 || error.status === 403)
  );
}

async function withBotGuildAccessLookupTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new DOMException('Timed out', 'TimeoutError'));
  }, BOT_GUILD_ACCESS_FALLBACK_TIMEOUT_MS);

  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Races a promise against an AbortSignal, rejecting if the signal aborts.
 *
 * @param promise - The promise to await
 * @param signal - Optional AbortSignal; if it is already aborted or aborts before `promise` settles, the returned promise rejects with the signal's abort reason
 * @returns The fulfilled value of `promise` if it resolves first; rejects with the original promise error if it rejects first, or with the signal's abort reason if aborted first
 */
function waitForPromiseOrAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);

  if (!signal) {
    return promise;
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(getAbortReason(signal));
    };

    signal.addEventListener('abort', onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Fetches all Discord guilds for the user associated with the provided access token by iterating paginated API results.
 *
 * Respects the provided AbortSignal for early cancellation.
 *
 * @param accessToken - OAuth2 user access token used to authenticate the Discord API requests
 * @param signal - Optional AbortSignal to cancel the fetch; when aborted the function will throw the abort reason
 * @returns An array of `DiscordGuild` objects containing every guild the user belongs to
 * @throws If the Discord API responds with a non-OK status
 * @throws If the Discord API returns non-JSON or an unexpected (non-array) response shape
 */
async function fetchAllUserGuildPages(
  accessToken: string,
  signal?: AbortSignal,
): Promise<DiscordGuild[]> {
  const allGuilds: DiscordGuild[] = [];
  let after: string | undefined;
  let hasMore = true;

  do {
    throwIfAborted(signal);

    const url = new URL(`${DISCORD_API_BASE}/users/@me/guilds`);
    url.searchParams.set('limit', String(GUILDS_PER_PAGE));
    if (after) {
      url.searchParams.set('after', after);
    }

    const response = await fetchWithRateLimit(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal,
      cache: 'no-store',
      rateLimit: {
        maxRetryDelayMs: 2_000,
        totalRetryBudgetMs: 4_000,
      },
    });

    if (!response.ok) {
      throw new DiscordUserGuildFetchError(
        `Failed to fetch user guilds: ${response.status} ${response.statusText}`,
        response.status,
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error('Discord returned non-JSON response for user guilds');
    }
    if (!Array.isArray(data)) {
      throw new Error(
        'Discord returned unexpected response shape for user guilds (expected array)',
      );
    }
    const page: DiscordGuild[] = data;
    allGuilds.push(...page);

    hasMore = page.length >= GUILDS_PER_PAGE;
    if (hasMore) {
      after = page[page.length - 1].id;
    }
  } while (hasMore);

  return allGuilds;
}

/**
 * Fetch wrapper with basic rate limit retry logic.
 * When Discord returns 429 Too Many Requests, waits for the indicated
 * retry-after duration and retries up to MAX_RETRIES times.
 */
export async function fetchWithRateLimit(
  url: string,
  init?: FetchWithRateLimitOptions,
): Promise<Response> {
  const maxRetries = init?.rateLimit?.maxRetries ?? MAX_RETRIES;
  const maxRetryDelayMs = init?.rateLimit?.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
  const totalRetryBudgetMs = init?.rateLimit?.totalRetryBudgetMs ?? DEFAULT_TOTAL_RETRY_BUDGET_MS;
  let totalWaitMs = 0;
  const maxAttempts = maxRetries + 1;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, init);

    if (response.status !== 429) {
      return response;
    }

    // Rate limited — parse retry-after header (seconds)
    const waitMs = parseRetryAfterMs(response);
    const remainingBudgetMs = totalRetryBudgetMs - totalWaitMs;

    if (attempt === maxRetries || waitMs > maxRetryDelayMs || waitMs > remainingBudgetMs) {
      logger.warn(
        `[discord] Rate limited on ${url}, not retrying after ${waitMs}ms ` +
          `(attempt ${attempt + 1}/${maxAttempts}, remaining budget ${Math.max(remainingBudgetMs, 0)}ms)`,
      );
      return response;
    }

    logger.warn(
      `[discord] Rate limited on ${url}, retrying in ${waitMs}ms ` +
        `(attempt ${attempt + 1}/${maxAttempts}, remaining budget ${remainingBudgetMs}ms)`,
    );
    // Abort-aware sleep: if the caller's signal fires while we're waiting,
    // cancel the delay immediately instead of blocking for the full duration.
    const signal = init?.signal;
    if (signal?.aborted) {
      throw signal.reason;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, waitMs);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    totalWaitMs += waitMs;
  }

  // Should never reach here, but satisfies TypeScript
  throw new Error('Unexpected end of rate limit retry loop');
}

/**
 * Retrieve all Discord guilds the user is a member of.
 *
 * This call deduplicates concurrent identical requests so simultaneous calls with the same
 * access token will share the in-flight fetch. It supports cancellation via an AbortSignal.
 *
 * @param signal - Optional AbortSignal to cancel the request
 * @returns All Discord guild objects the user belongs to
 */
export async function fetchUserGuilds(
  accessToken: string,
  signal?: AbortSignal,
): Promise<DiscordGuild[]> {
  throwIfAborted(signal);

  const requestKey = getUserGuildRequestKey(accessToken);
  const existingRequest = inFlightUserGuildRequests.get(requestKey);

  if (existingRequest) {
    return waitForPromiseOrAbort(existingRequest, signal);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new DOMException('Timed out', 'TimeoutError'));
  }, USER_GUILDS_REQUEST_TIMEOUT_MS);

  let requestPromise: Promise<DiscordGuild[]>;
  requestPromise = fetchAllUserGuildPages(accessToken, controller.signal).finally(() => {
    clearTimeout(timeout);
    if (inFlightUserGuildRequests.get(requestKey) === requestPromise) {
      inFlightUserGuildRequests.delete(requestKey);
    }
  });

  inFlightUserGuildRequests.set(requestKey, requestPromise);

  return waitForPromiseOrAbort(requestPromise, signal);
}

/**
 * Parse a parsed JSON value into validated bot guild access entries.
 *
 * @param data - The parsed JSON value returned by the bot API `/guilds/access` endpoint.
 * @returns `null` if `data` is not an array; otherwise an array of well-formed `BotGuildAccessEntry` objects. Invalid or malformed entries are skipped.
 */
function parseBotGuildAccessEntries(data: unknown): BotGuildAccessEntry[] | null {
  if (!Array.isArray(data)) {
    return null;
  }

  return data.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }

    const { id, access, present } = entry as Record<string, unknown>;
    if (
      typeof id !== 'string' ||
      typeof access !== 'string' ||
      !BOT_GUILD_ACCESS_LEVELS.has(access as BotGuildAccessLevel)
    ) {
      return [];
    }

    return [
      {
        id,
        access: access as BotGuildAccessLevel,
        ...(typeof present === 'boolean' ? { present } : {}),
      },
    ];
  });
}

/**
 * Fetches bot access entries for a user across the provided guild IDs from the internal bot API.
 *
 * @param userId - The Discord user ID whose access is being queried
 * @param guildIds - Array of guild IDs to look up; requests are chunked when large
 * @param signal - Optional AbortSignal to cancel the network requests
 * @returns An array of `BotGuildAccessEntry` for the requested guilds, or `null` if the lookup could not be performed, returned an unexpected shape, or required configuration is missing
 */
export async function fetchBotGuildAccess(
  userId: string,
  guildIds: string[],
  signal?: AbortSignal,
): Promise<BotGuildAccessEntry[] | null> {
  const botApiBaseUrl = getBotApiBaseUrl();
  const botApiSecret = process.env.BOT_API_SECRET;

  if (!userId || !botApiBaseUrl || !botApiSecret || guildIds.length === 0) {
    return null;
  }

  const entries: BotGuildAccessEntry[] = [];

  try {
    for (let start = 0; start < guildIds.length; start += MAX_ACCESS_LOOKUP_GUILDS) {
      const guildIdChunk = guildIds.slice(start, start + MAX_ACCESS_LOOKUP_GUILDS);
      const url = new URL(`${botApiBaseUrl}/guilds/access`);
      url.searchParams.set('userId', userId);
      url.searchParams.set('guildIds', guildIdChunk.join(','));

      const response = await fetchWithRateLimit(url.toString(), {
        headers: {
          'x-api-secret': botApiSecret,
        },
        signal,
        cache: 'no-store',
        rateLimit: {
          maxRetries: 1,
          maxRetryDelayMs: 250,
          totalRetryBudgetMs: 500,
        },
      });

      if (!response.ok) {
        logger.warn('[discord] Bot API guild access lookup failed', {
          status: response.status,
          statusText: response.statusText,
          guildCount: guildIdChunk.length,
        });
        return null;
      }

      const data: unknown = await response.json();
      const parsedEntries = parseBotGuildAccessEntries(data);
      if (!parsedEntries) {
        logger.warn('[discord] Bot API guild access lookup returned an invalid response shape.');
        return null;
      }

      entries.push(...parsedEntries);
    }
  } catch (error) {
    logger.warn('[discord] Bot API guild access lookup is unreachable.', error);
    return null;
  }

  return entries;
}

/**
 * Fetch guilds the bot is present in.
 * This calls our own bot API to get the list of guilds.
 * Requires BOT_API_SECRET env var for authentication.
 */
/** Result of fetchBotGuilds — discriminates API-unavailable from genuinely empty. */
export interface BotGuildResult {
  /** Whether the bot API was reachable and returned a valid response. */
  available: boolean;
  guilds: BotGuild[];
}

export async function fetchBotGuilds(signal?: AbortSignal): Promise<BotGuildResult> {
  const botApiBaseUrl = getBotApiBaseUrl();

  if (!botApiBaseUrl) {
    logger.warn(
      '[discord] BOT_API_URL is not set — cannot filter guilds by bot presence. ' +
        'Set BOT_API_URL to enable mutual guild filtering.',
    );
    return { available: false, guilds: [] };
  }

  const botApiSecret = process.env.BOT_API_SECRET;
  if (!botApiSecret) {
    logger.warn(
      '[discord] BOT_API_SECRET is missing while BOT_API_URL is set. ' +
        'Skipping bot guild fetch — refusing to send unauthenticated request.',
    );
    return { available: false, guilds: [] };
  }

  try {
    const response = await fetchWithRateLimit(`${botApiBaseUrl}/guilds`, {
      headers: {
        'x-api-secret': botApiSecret,
      },
      signal,
      cache: 'no-store',
      rateLimit: {
        maxRetries: 1,
        maxRetryDelayMs: 250,
        totalRetryBudgetMs: 500,
      },
    });

    if (!response.ok) {
      logger.warn(
        `[discord] Bot API returned ${response.status} ${response.statusText} — ` +
          'continuing without bot guild filtering.',
      );
      return { available: false, guilds: [] };
    }

    const data: unknown = await response.json();
    if (!Array.isArray(data)) {
      logger.warn(
        '[discord] Bot API returned unexpected response shape (expected array) — ' +
          'continuing without bot guild filtering.',
      );
      return { available: false, guilds: [] as BotGuild[] };
    }
    return { available: true, guilds: data as BotGuild[] };
  } catch (error) {
    logger.warn(
      '[discord] Bot API is unreachable — continuing without bot guild filtering.',
      error,
    );
    return { available: false, guilds: [] as BotGuild[] };
  }
}

function canExposeBotGuildAccess(entry: BotGuildAccessEntry): boolean {
  if (entry.present === false) {
    return false;
  }

  // Older bot API deployments did not include `present`; avoid exposing
  // member-only viewer guilds unless membership was explicitly confirmed.
  return entry.present === true || entry.access !== 'viewer';
}

function mapBotAccessEntriesToMutualGuilds(
  botGuilds: BotGuild[],
  accessEntries: BotGuildAccessEntry[],
): MutualGuild[] {
  const botGuildsById = new Map(botGuilds.map((guild) => [guild.id, guild]));

  return accessEntries.flatMap((entry) => {
    const botGuild = botGuildsById.get(entry.id);
    if (!botGuild || !canExposeBotGuildAccess(entry)) {
      return [];
    }

    return [mapBotGuildToMutualGuild(botGuild, entry.access)];
  });
}

/**
 * Compute mutual guilds between the authenticated user and the bot.
 *
 * When the bot API is unavailable, returns all user guilds with `botPresent` set to `false`
 * so the UI can still display guilds. If the user-guild fetch fails and `options.userId`
 * is provided, the function may return a bot-backed fallback list derived from the bot API.
 *
 * @param options - Optional settings; if `options.userId` is provided the function will attempt to fetch per-guild bot access for that user to produce a bot-backed fallback when needed.
 * @returns An array of MutualGuild objects representing guilds the user and bot share. If the bot API is unavailable, returns the user's guilds unfiltered with `botPresent: false`.
 */
export async function getMutualGuilds(
  accessToken: string,
  signal?: AbortSignal,
  options: GetMutualGuildsOptions = {},
): Promise<MutualGuild[]> {
  const botResultPromise = fetchBotGuilds(signal).catch((err) => {
    logger.warn('[discord] Unexpected error fetching bot guilds — degrading gracefully.', err);
    return { available: false, guilds: [] } as BotGuildResult;
  });

  let userGuilds: DiscordGuild[];
  try {
    userGuilds = await fetchUserGuilds(accessToken, signal);
  } catch (error) {
    // Never recover Discord auth failures with bot-backed guild data.
    // Only transient user-guild failures are eligible for fallback.
    if (isDiscordUserGuildAuthFailure(error)) {
      throw error;
    }

    // Preserve caller cancellation semantics: bot-backed fallback is only for
    // Discord-side transient failures/timeouts, not abandoned requests.
    if (signal?.aborted) {
      throw error;
    }

    const userId = options.userId;
    if (userId && isTransientUserGuildFetchError(error)) {
      const botResult = await botResultPromise;
      if (botResult.available) {
        if (botResult.guilds.length > BOT_GUILD_ACCESS_FALLBACK_MAX_GUILDS) {
          logger.warn(
            '[discord] User guild fetch failed, but bot-backed guild access fallback was skipped because the bot guild list is too large.',
            {
              botGuildCount: botResult.guilds.length,
              maxFallbackGuilds: BOT_GUILD_ACCESS_FALLBACK_MAX_GUILDS,
            },
          );
          throw error;
        }

        const accessEntries = await withBotGuildAccessLookupTimeout((accessSignal) =>
          fetchBotGuildAccess(
            userId,
            botResult.guilds.map((guild) => guild.id),
            accessSignal,
          ),
        );
        if (accessEntries) {
          const fallbackGuilds = mapBotAccessEntriesToMutualGuilds(botResult.guilds, accessEntries);
          logger.warn(
            '[discord] User guild fetch failed — using bot-backed guild access fallback.',
            error,
          );
          return fallbackGuilds;
        }
      }
    }
    throw error;
  }

  const botResult = await botResultPromise;

  // If the bot API was unavailable, return all user guilds unfiltered so
  // the UI can still be useful. If the API was available but the bot is
  // genuinely in zero guilds, return an empty list.
  if (!botResult.available) {
    return userGuilds.map(mapDiscordGuildToMutualGuild);
  }

  const botGuildsById = new Map(botResult.guilds.map((guild) => [guild.id, guild]));
  const mutualGuilds = userGuilds.flatMap((guild) => {
    const botGuild = botGuildsById.get(guild.id);
    if (!botGuild) return [];

    const iconHash = botGuild.iconHash ?? guild.icon;
    return [
      {
        ...guild,
        name: botGuild.name,
        icon: botGuild.icon ?? getGuildIconUrl(guild.id, iconHash),
        iconHash,
        botPresent: true as const,
        config: botGuild.config,
      },
    ];
  });

  const userId = options.userId;
  if (!userId || mutualGuilds.length === 0) {
    return mutualGuilds;
  }

  const accessEntries = await withBotGuildAccessLookupTimeout((accessSignal) =>
    fetchBotGuildAccess(
      userId,
      mutualGuilds.map((guild) => guild.id),
      accessSignal,
    ),
  );
  if (!accessEntries) {
    return mutualGuilds.map((guild) => ({
      ...guild,
      access: getDiscordGuildAccess(guild),
    }));
  }

  const botAccessById = new Map<string, BotGuildAccessLevel>(
    accessEntries.filter(canExposeBotGuildAccess).map((entry) => [entry.id, entry.access]),
  );

  return mutualGuilds.map((guild) => ({
    ...guild,
    access: botAccessById.get(guild.id) ?? getDiscordGuildAccess(guild),
  }));
}
