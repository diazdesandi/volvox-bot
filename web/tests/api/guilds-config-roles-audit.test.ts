import { describe, expect, it } from 'vitest';
import { NextResponse } from 'next/server';

import {
  expectJson,
  expectProxiedRoutes,
  expectSharedProxyFailures,
  guildParams,
  mockAuthorizeGuildAdmin,
  mockGetDashboardActorHeaders,
  mockProxyToBotApi,
  proxyCases,
  request,
  setupProxyRouteMocks,
} from './helpers/proxy-route-test-helpers';

import * as auditLogRoute from '@/app/api/guilds/[guildId]/audit-log/route';
import * as configRoute from '@/app/api/guilds/[guildId]/config/route';
import * as rolesRoute from '@/app/api/guilds/[guildId]/roles/route';

describe('guild config, roles, and audit proxy routes', () => {
  setupProxyRouteMocks();

  it('covers audit log query forwarding', async () => {
    const cases = proxyCases([
      {
        call: () =>
          auditLogRoute.GET(
            request(
              'http://localhost/api?limit=25&offset=5&category=ai&targetId=user-9&channelId=chan-7&ignored=x',
            ),
            guildParams(),
          ),
        path: '/guilds/guild%201/audit-log',
        query: {
          category: 'ai',
          channelId: 'chan-7',
          limit: '25',
          offset: '5',
          targetId: 'user-9',
        },
      },
    ]);

    await expectProxiedRoutes(cases);
  });

  it('returns proxied audit log rows without loading dashboard actor headers', async () => {
    mockProxyToBotApi.mockResolvedValueOnce(
      NextResponse.json({
        entries: [
          {
            id: 1,
            guild_id: 'guild-1',
            user_id: '123456789012345678',
            user_tag: null,
            action: 'config.update',
            target_type: null,
            target_id: null,
            target_tag: null,
            details: null,
            ip_address: '::1',
            created_at: '2026-05-16T23:42:00Z',
          },
          {
            id: 2,
            guild_id: 'guild-1',
            user_id: '987654321098765432',
            user_tag: null,
            action: 'config.update',
            target_type: null,
            target_id: null,
            target_tag: null,
            details: null,
            ip_address: '::1',
            created_at: '2026-05-16T23:43:00Z',
          },
        ],
        total: 2,
      }),
    );

    const response = await auditLogRoute.GET(request('http://localhost/api'), guildParams());

    expect(response.status).toBe(200);
    await expectJson(response, {
      entries: [
        expect.objectContaining({
          id: 1,
          user_id: '123456789012345678',
          user_tag: null,
        }),
        expect.objectContaining({
          id: 2,
          user_id: '987654321098765432',
          user_tag: null,
        }),
      ],
      total: 2,
    });
    expect(mockGetDashboardActorHeaders).not.toHaveBeenCalled();
  });

  it('covers config read and write validation before proxying', async () => {
    const getResponse = await configRoute.GET(request('http://localhost/api'), guildParams());
    expect(getResponse.status).toBe(200);
    await expectJson(getResponse, { ok: true });

    const patchResponse = await configRoute.PATCH(
      request('http://localhost/api', {
        method: 'PATCH',
        body: JSON.stringify({ path: 'features.xp.enabled', value: true }),
      }),
      guildParams(),
    );
    expect(patchResponse.status).toBe(200);
    expect(mockGetDashboardActorHeaders).toHaveBeenCalled();
    expect(mockProxyToBotApi.mock.calls.at(-1)?.[4]).toMatchObject({
      method: 'PATCH',
      headers: expect.objectContaining({
        'x-discord-user-id': '123456789012345678',
        'x-discord-user-tag': 'Owner#0001',
      }),
    });

    const putResponse = await configRoute.PUT(
      request('http://localhost/api', {
        method: 'PUT',
        body: JSON.stringify([{ path: 'features.levels.enabled', value: false }]),
      }),
      guildParams(),
    );
    expect(putResponse.status).toBe(200);
    expect(mockProxyToBotApi.mock.calls.at(-1)?.[4]).toMatchObject({
      method: 'PUT',
      headers: expect.objectContaining({
        'x-discord-user-id': '123456789012345678',
        'x-discord-user-tag': 'Owner#0001',
      }),
    });

    const invalidPatch = await configRoute.PATCH(
      request('http://localhost/api', { method: 'PATCH', body: JSON.stringify({ path: '' }) }),
      guildParams(),
    );
    expect(invalidPatch.status).toBe(400);
    await expectJson(invalidPatch, {
      error: 'Invalid patch: expected { path: string, value: unknown }',
    });

    const invalidPut = await configRoute.PUT(
      request('http://localhost/api', { method: 'PUT', body: JSON.stringify({ path: 'x' }) }),
      guildParams(),
    );
    expect(invalidPut.status).toBe(400);
    await expectJson(invalidPut, { error: 'Invalid payload: expected an array of patches' });
  });

  it('covers missing guild guards for config, roles, and audit routes', async () => {
    const missingGuildCases = [
      () => auditLogRoute.GET(request('http://localhost/api'), guildParams('')),
      () => configRoute.GET(request('http://localhost/api'), guildParams('')),
      () => rolesRoute.GET(request('http://localhost/api'), guildParams('')),
    ];

    for (const call of missingGuildCases) {
      const response = await call();
      expect(response.status).toBe(400);
    }
  });

  it('returns auth, config, and upstream construction errors from config, roles, and audit routes', async () => {
    const adminRoutes = [
      () => auditLogRoute.GET(request('http://localhost/api'), guildParams('guild-1')),
      () => configRoute.GET(request('http://localhost/api'), guildParams('guild-1')),
      () => rolesRoute.GET(request('http://localhost/api'), guildParams('guild-1')),
    ];

    for (const call of adminRoutes) {
      await expectSharedProxyFailures(call, mockAuthorizeGuildAdmin);
    }
  });
});
