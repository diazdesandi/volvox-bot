import request from 'supertest';
import { afterEach, describe, it, vi } from 'vitest';

import { createApp } from '../../../src/api/server.js';

describe('removed backup routes', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not expose backup endpoints', async () => {
    vi.stubEnv('BOT_API_SECRET', 'test-secret');

    const app = createApp({ guilds: { cache: new Map() } }, null);
    const removedEndpoints = [
      ['get', '/api/v1/backups'],
      ['post', '/api/v1/backups'],
      ['get', '/api/v1/backups/export'],
      ['post', '/api/v1/backups/import'],
      ['get', '/api/v1/backups/backup-2026-03-01T12-00-00/download'],
      ['post', '/api/v1/backups/backup-2026-03-01T12-00-00/restore'],
      ['post', '/api/v1/backups/prune'],
    ];

    for (const [method, path] of removedEndpoints) {
      await request(app)[method](path).set('x-api-secret', 'test-secret').expect(404);
    }
  });
});
