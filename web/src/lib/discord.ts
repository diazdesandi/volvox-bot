const DISCORD_CDN = 'https://cdn.discordapp.com';

/**
 * Minimal permissions the bot needs:
 * - Kick Members      (1 << 1)  =            2
 * - Ban Members       (1 << 2)  =            4
 * - Manage Channels   (1 << 4)  =           16
 * - View Channels     (1 << 10) =        1,024
 * - Send Messages     (1 << 11) =        2,048
 * - Manage Messages   (1 << 13) =        8,192
 * - Read Msg History  (1 << 16) =       65,536
 * - Moderate Members  (1 << 40) = 1,099,511,627,776
 *                          Total = 1,099,511,704,598
 *
 * Verified: (1n<<1n)|(1n<<2n)|(1n<<4n)|(1n<<10n)|(1n<<11n)|(1n<<13n)|(1n<<16n)|(1n<<40n) === 1099511704598n
 */
export const BOT_PERMISSIONS = '1099511704598';

const BOT_INVITE_SCOPES = ['bot', 'applications.commands'] as const;
const COMBINED_BOT_INVITE_SCOPES = ['bot', 'applications.commands', 'identify', 'guilds'] as const;
const DIRECT_BOT_INVITE_SCOPE_SET = new Set<string>(BOT_INVITE_SCOPES);

interface BotInviteUrlOptions {
  readonly disableGuildSelect?: boolean;
  readonly guildId?: string;
  readonly redirectUri?: string;
  readonly responseType?: 'code';
  readonly scopes?: readonly string[];
  readonly state?: string;
}

interface BotInviteAuthorizationParamsOptions {
  readonly disableGuildSelect?: boolean;
  readonly guildId?: string;
  readonly scopes?: readonly string[];
}

function appendGuildInviteParams(
  params: URLSearchParams | Record<string, string>,
  options: Pick<BotInviteUrlOptions, 'disableGuildSelect' | 'guildId'>,
): void {
  const guildId = options.guildId?.trim();
  if (guildId) {
    if (params instanceof URLSearchParams) {
      params.set('guild_id', guildId);
    } else {
      params.guild_id = guildId;
    }
  }

  if (options.disableGuildSelect) {
    if (params instanceof URLSearchParams) {
      params.set('disable_guild_select', 'true');
    } else {
      params.disable_guild_select = 'true';
    }
  }
}

function requiresAuthorizationCodeFlow(scopes: readonly string[]): boolean {
  return scopes.some((scope) => !DIRECT_BOT_INVITE_SCOPE_SET.has(scope));
}

/**
 * Build authorization params for NextAuth's Discord signIn flow.
 *
 * NextAuth owns `state` and `redirect_uri`; these params add the bot invite
 * scopes and target guild without bypassing its CSRF protection.
 */
export function getBotInviteAuthorizationParams(
  options: BotInviteAuthorizationParamsOptions = {},
): Record<string, string> {
  const params: Record<string, string> = {
    permissions: BOT_PERMISSIONS,
    scope: (options.scopes ?? COMBINED_BOT_INVITE_SCOPES).join(' '),
  };

  appendGuildInviteParams(params, options);

  return params;
}

/**
 * Build the bot OAuth2 invite URL, or return null when
 * NEXT_PUBLIC_DISCORD_CLIENT_ID is not configured.
 */
export function getBotInviteUrl(options: BotInviteUrlOptions = {}): string | null {
  const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
  if (!clientId) return null;

  const scopes =
    options.scopes ?? (options.redirectUri ? COMBINED_BOT_INVITE_SCOPES : BOT_INVITE_SCOPES);
  if (!options.redirectUri && requiresAuthorizationCodeFlow(scopes)) {
    return null;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    permissions: BOT_PERMISSIONS,
    scope: scopes.join(' '),
  });

  if (options.redirectUri) {
    params.set('redirect_uri', options.redirectUri);
    params.set('response_type', options.responseType ?? 'code');
  }

  if (options.state) {
    params.set('state', options.state);
  }

  appendGuildInviteParams(params, options);

  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

/**
 * Get the URL for a guild's icon, or null if the guild has no custom icon.
 * Discord doesn't provide default guild icons via CDN — callers should
 * show the guild's initials or a placeholder icon when this returns null.
 */
export function getGuildIconUrl(
  guildId: string,
  iconHash: string | null,
  size = 128,
): string | null {
  if (!iconHash) return null;
  const ext = iconHash.startsWith('a_') ? 'gif' : 'webp';
  return `${DISCORD_CDN}/icons/${guildId}/${iconHash}.${ext}?size=${size}`;
}
