import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import {
  BOT_GUILD_ACCESS_FALLBACK_TIMEOUT_MS,
  getMutualGuilds,
  USER_GUILDS_REQUEST_TIMEOUT_MS,
} from '@/lib/discord.server';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const REQUEST_TIMEOUT_BUFFER_MS = 1_000;

/**
 * Request timeout for the guilds endpoint. Keep enough budget for the
 * Discord user-guild request, bot-backed fallback, and a small route buffer.
 */
const REQUEST_TIMEOUT_MS =
  USER_GUILDS_REQUEST_TIMEOUT_MS + BOT_GUILD_ACCESS_FALLBACK_TIMEOUT_MS + REQUEST_TIMEOUT_BUFFER_MS;

export async function GET(request: NextRequest) {
  const token = await getToken({ req: request });

  if (!token?.accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // If the JWT refresh previously failed, don't send a stale token to Discord
  if (token.error === 'RefreshTokenError') {
    return NextResponse.json({ error: 'Token expired. Please sign in again.' }, { status: 401 });
  }

  try {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const userId =
      typeof token.id === 'string' ? token.id : typeof token.sub === 'string' ? token.sub : '';
    const guilds = await getMutualGuilds(token.accessToken as string, signal, { userId });
    return NextResponse.json(guilds);
  } catch (error) {
    logger.error('[api/guilds] Failed to fetch guilds:', error);
    return NextResponse.json({ error: 'Failed to fetch guilds' }, { status: 500 });
  }
}
