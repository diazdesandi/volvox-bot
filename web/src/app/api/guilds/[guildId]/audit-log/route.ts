import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  authorizeGuildAdmin,
  buildUpstreamUrl,
  getBotApiConfig,
  getDashboardActorHeaders,
  proxyToBotApi,
} from '@/lib/bot-api-proxy';

const LOG_PREFIX = '[api/guilds/:guildId/audit-log]';

export const dynamic = 'force-dynamic';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function hasDisplayName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hydrateCurrentActorTags(
  payload: unknown,
  actorHeaders: Record<string, string> | null,
): unknown {
  const actorId = actorHeaders?.['x-discord-user-id'];
  const actorTag = actorHeaders?.['x-discord-user-tag'];
  if (!actorId || !actorTag) return payload;

  const responseBody = asRecord(payload);
  if (!responseBody || !Array.isArray(responseBody.entries)) return payload;

  let changed = false;
  const entries = responseBody.entries.map((entry) => {
    const row = asRecord(entry);
    if (!row || row.user_id !== actorId || hasDisplayName(row.user_tag)) return entry;

    changed = true;
    return { ...row, user_tag: actorTag };
  });

  return changed ? { ...responseBody, entries } : payload;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ guildId: string }> },
) {
  const { guildId } = await params;
  if (!guildId) {
    return NextResponse.json({ error: 'Missing guildId' }, { status: 400 });
  }

  const authError = await authorizeGuildAdmin(request, guildId, LOG_PREFIX);
  if (authError) return authError;

  const config = getBotApiConfig(LOG_PREFIX);
  if (config instanceof NextResponse) return config;

  const upstreamUrl = buildUpstreamUrl(
    config.baseUrl,
    `/guilds/${encodeURIComponent(guildId)}/audit-log`,
    LOG_PREFIX,
  );
  if (upstreamUrl instanceof NextResponse) return upstreamUrl;

  const allowedParams = [
    'limit',
    'offset',
    'action',
    'category',
    'userId',
    'targetId',
    'channelId',
    'startDate',
    'endDate',
  ];
  for (const key of allowedParams) {
    const value = request.nextUrl.searchParams.get(key);
    if (value !== null) {
      upstreamUrl.searchParams.set(key, value);
    }
  }

  const actorHeadersResult = await getDashboardActorHeaders(request);
  const actorHeaders = actorHeadersResult instanceof NextResponse ? null : actorHeadersResult;
  const response = await proxyToBotApi(
    upstreamUrl,
    config.secret,
    LOG_PREFIX,
    'Failed to fetch audit log',
  );

  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    return response;
  }

  const payload = await response.json();
  return NextResponse.json(hydrateCurrentActorTags(payload, actorHeaders), {
    status: response.status,
  });
}
