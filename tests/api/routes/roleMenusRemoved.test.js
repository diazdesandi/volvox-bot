import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

import { _resetSecretCache } from '../../../src/api/middleware/verifyJwt.js';
import { createApp } from '../../../src/api/server.js';
import { sessionStore } from '../../../src/api/utils/sessionStore.js';

describe('removed role menu API routes', () => {
  let app;
  let secret;

  beforeEach(() => {
    secret = randomBytes(32).toString('hex');
    vi.stubEnv('BOT_API_SECRET', secret);
    app = createApp(
      {
        guilds: { cache: new Map([['guild1', { id: 'guild1' }]]) },
        ws: { status: 0, ping: 42 },
        user: { tag: 'Bot#1234' },
      },
      null,
    );
  });

  afterEach(() => {
    sessionStore.clear();
    _resetSecretCache();
    vi.unstubAllEnvs();
  });

  it('does not expose role menu template routes', async () => {
    const res = await request(app)
      .get('/api/v1/guilds/guild1/role-menu/templates')
      .set('x-api-secret', secret);

    expect(res.status).toBe(404);
  });
});
