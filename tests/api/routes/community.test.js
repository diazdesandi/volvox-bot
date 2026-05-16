/**
 * Tests for src/api/routes/community.js
 * Covers public leaderboard, stats, profile endpoints + privacy + rate limiting.
 */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../src/db.js', () => ({
  getPool: vi.fn(),
}));

vi.mock('../../../src/modules/config.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    reputation: {
      enabled: true,
      levelThresholds: [100, 300, 600, 1000],
    },
    permissions: {},
  }),
  setConfigValue: vi.fn(),
}));

// Mock cache to pass through (no caching in tests)
vi.mock('../../../src/utils/cache.js', () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheGetOrSet: vi.fn().mockImplementation(async (_key, factory) => factory()),
  cacheDel: vi.fn().mockResolvedValue(undefined),
  cacheDelPattern: vi.fn().mockResolvedValue(0),
  TTL: { LEADERBOARD: 300 },
}));

vi.mock('../../../src/api/middleware/oauthJwt.js', () => ({
  handleOAuthJwt: vi.fn().mockResolvedValue(false),
  stopJwtCleanup: vi.fn(),
}));

import { createApp } from '../../../src/api/server.js';

const GUILD_ID = 'guild123';
const PUBLIC_USER = 'publicUser1';
const PRIVATE_USER = 'privateUser2';

describe('community routes', () => {
  let app;
  let mockPool;

  const mockMember = {
    id: PUBLIC_USER,
    user: {
      username: 'alice',
      displayAvatarURL: () => 'https://cdn.example.com/alice.png',
    },
    displayName: 'Alice',
    joinedAt: new Date('2024-01-15'),
    roles: { cache: new Map() },
  };

  const mockGuild = {
    id: GUILD_ID,
    name: 'Test Server',
    iconURL: () => 'https://cdn.example.com/icon.png',
    memberCount: 100,
    channels: { cache: new Map() },
    roles: { cache: new Map() },
    members: {
      cache: new Map([[PUBLIC_USER, mockMember]]),
      fetch: vi.fn().mockImplementation((userIdOrOpts) => {
        // Handle batch fetch: guild.members.fetch({ user: [...] })
        if (userIdOrOpts !== null && typeof userIdOrOpts === 'object' && 'user' in userIdOrOpts) {
          const result = new Map();
          for (const uid of userIdOrOpts.user) {
            if (uid === PUBLIC_USER) result.set(uid, mockMember);
          }
          return Promise.resolve(result);
        }
        // Handle individual fetch: guild.members.fetch(userId)
        if (userIdOrOpts === PUBLIC_USER) return Promise.resolve(mockMember);
        return Promise.reject(new Error('Unknown Member'));
      }),
    },
  };

  const mockClient = {
    guilds: {
      cache: new Map([[GUILD_ID, mockGuild]]),
    },
  };

  beforeEach(() => {
    vi.stubEnv('BOT_API_SECRET', 'test-secret');

    mockPool = {
      query: vi.fn(),
    };

    app = createApp(mockClient, mockPool);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // ─── Leaderboard ──────────────────────────────────────────────────────────

  describe('GET /api/v1/community/:guildId/leaderboard', () => {
    it('returns leaderboard with public members only', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: 1 }] }) // count
        .mockResolvedValueOnce({
          rows: [{ user_id: PUBLIC_USER, xp: 500, level: 2 }],
        }); // members

      const res = await request(app).get(`/api/v1/community/${GUILD_ID}/leaderboard`).expect(200);

      expect(res.body.members).toHaveLength(1);
      expect(res.body.members[0]).toMatchObject({
        username: 'alice',
        displayName: 'Alice',
        xp: 500,
        rank: 1,
      });
      expect(res.body.total).toBe(1);
      expect(res.body.page).toBe(1);

      // Verify query filters by public_profile = TRUE
      const countCall = mockPool.query.mock.calls[0];
      expect(countCall[0]).toContain('public_profile = TRUE');
    });

    it('supports pagination', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: 50 }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get(`/api/v1/community/${GUILD_ID}/leaderboard?limit=10&page=3`)
        .expect(200);

      expect(res.body.page).toBe(3);
      // Verify offset = (3-1) * 10 = 20
      const membersCall = mockPool.query.mock.calls[1];
      expect(membersCall[1]).toEqual([GUILD_ID, 10, 20]);
    });

    it('caps limit at 100', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app).get(`/api/v1/community/${GUILD_ID}/leaderboard?limit=999`).expect(200);

      const membersCall = mockPool.query.mock.calls[1];
      expect(membersCall[1][1]).toBe(100);
    });

    it('returns 503 when database is unavailable', async () => {
      const appNoDb = createApp(mockClient, null);
      await request(appNoDb).get(`/api/v1/community/${GUILD_ID}/leaderboard`).expect(503);
    });

    it('returns 500 on database error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB down'));

      await request(app).get(`/api/v1/community/${GUILD_ID}/leaderboard`).expect(500);
    });
  });

  // ─── Removed project gallery ──────────────────────────────────────────────

  it('does not expose the removed project gallery endpoint', async () => {
    await request(app).get(`/api/v1/community/${GUILD_ID}/showcases`).expect(404);
  });

  // ─── Stats ────────────────────────────────────────────────────────────────

  describe('GET /api/v1/community/:guildId/stats', () => {
    it('returns community stats', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: 42 }] }) // memberCount
        .mockResolvedValueOnce({ rows: [{ total: 1337 }] }) // totalMessagesSent (all-time)
        .mockResolvedValueOnce({ rows: [{ count: 88 }] }) // challengesCompleted
        .mockResolvedValueOnce({
          rows: [{ user_id: PUBLIC_USER, xp: 500, level: 2 }],
        }); // topContributors

      const res = await request(app).get(`/api/v1/community/${GUILD_ID}/stats`).expect(200);

      expect(res.body).toMatchObject({
        memberCount: 42,
        totalMessagesSent: 1337,
        challengesCompleted: 88,
      });
      expect(res.body.topContributors).toHaveLength(1);
      expect(res.body.topContributors[0]).toMatchObject({
        username: 'alice',
        xp: 500,
      });
    });

    it('returns 503 when database unavailable', async () => {
      const appNoDb = createApp(mockClient, null);
      await request(appNoDb).get(`/api/v1/community/${GUILD_ID}/stats`).expect(503);
    });

    it('returns 500 on database error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB down'));

      await request(app).get(`/api/v1/community/${GUILD_ID}/stats`).expect(500);
    });
  });

  // ─── Profile ──────────────────────────────────────────────────────────────

  describe('GET /api/v1/community/:guildId/profile/:userId', () => {
    it('returns public profile with stats and badges', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            {
              messages_sent: 150,
              reactions_given: 60,
              reactions_received: 30,
              days_active: 35,
              first_seen: '2024-01-15T00:00:00Z',
              last_active: '2024-06-15T00:00:00Z',
              public_profile: true,
            },
          ],
        }) // user_stats
        .mockResolvedValueOnce({
          rows: [{ xp: 500, level: 2, messages_count: 100, voice_minutes: 0, helps_given: 5 }],
        }); // reputation

      const res = await request(app)
        .get(`/api/v1/community/${GUILD_ID}/profile/${PUBLIC_USER}`)
        .expect(200);

      expect(res.body).toMatchObject({
        username: 'alice',
        displayName: 'Alice',
        xp: 500,
        level: 2,
        stats: {
          messagesSent: 150,
          reactionsGiven: 60,
          daysActive: 35,
        },
      });
      expect(res.body).not.toHaveProperty('projects');
      expect(res.body.recentBadges.length).toBeGreaterThan(0);
    });

    it('returns 404 for users who have not opted in', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            messages_sent: 50,
            reactions_given: 10,
            reactions_received: 5,
            days_active: 5,
            public_profile: false,
          },
        ],
      });

      await request(app).get(`/api/v1/community/${GUILD_ID}/profile/${PRIVATE_USER}`).expect(404);
    });

    it('returns 404 for users with no stats row', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app).get(`/api/v1/community/${GUILD_ID}/profile/nonexistent`).expect(404);
    });

    it('returns 503 when database unavailable', async () => {
      const appNoDb = createApp(mockClient, null);
      await request(appNoDb)
        .get(`/api/v1/community/${GUILD_ID}/profile/${PUBLIC_USER}`)
        .expect(503);
    });

    it('returns 500 on database error', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB down'));

      await request(app).get(`/api/v1/community/${GUILD_ID}/profile/${PUBLIC_USER}`).expect(500);
    });
  });

  // ─── Privacy ──────────────────────────────────────────────────────────────

  describe('privacy enforcement', () => {
    it('leaderboard query only includes public_profile = TRUE', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app).get(`/api/v1/community/${GUILD_ID}/leaderboard`).expect(200);

      // Both count and data queries should filter by public_profile
      expect(mockPool.query.mock.calls[0][0]).toContain('public_profile = TRUE');
      expect(mockPool.query.mock.calls[1][0]).toContain('public_profile = TRUE');
    });

    it('profile endpoint rejects private users with 404', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            public_profile: false,
            messages_sent: 100,
            reactions_given: 5,
            reactions_received: 2,
            days_active: 10,
          },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/community/${GUILD_ID}/profile/${PRIVATE_USER}`)
        .expect(404);

      expect(res.body.error).toBe('Profile not found');
    });
  });

  // ─── No Auth Required ────────────────────────────────────────────────────

  describe('no auth required', () => {
    it('leaderboard works without auth headers', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app).get(`/api/v1/community/${GUILD_ID}/leaderboard`).expect(200);
    });

    it('stats works without auth headers', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [{ count: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app).get(`/api/v1/community/${GUILD_ID}/stats`).expect(200);
    });

    it('profile works without auth headers', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      // 404 is correct — no stats row, but still no 401
      await request(app).get(`/api/v1/community/${GUILD_ID}/profile/someuser`).expect(404);
    });
  });

  // ─── Additional coverage ──────────────────────────────────────────────────

  describe('profile badge coverage', () => {
    it('returns all badge types for power users', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            {
              messages_sent: 1500,
              reactions_given: 100,
              reactions_received: 50,
              days_active: 45,
              first_seen: '2024-01-01T00:00:00Z',
              last_active: '2024-06-15T00:00:00Z',
              public_profile: true,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ xp: 2000, level: 5, messages_count: 500, voice_minutes: 10, helps_given: 20 }],
        });

      const res = await request(app)
        .get(`/api/v1/community/${GUILD_ID}/profile/${PUBLIC_USER}`)
        .expect(200);

      const badgeNames = res.body.recentBadges.map((b) => b.name);
      expect(badgeNames).toContain('💬 Chatterbox');
      expect(badgeNames).toContain('🗣️ Active Voice');
      expect(badgeNames).toContain('📅 Monthly Regular');
      expect(badgeNames).toContain('🔄 Week Warrior');
      expect(badgeNames).toContain('❤️ Generous');
      expect(res.body).not.toHaveProperty('projects');
    });

    it('profile works when user has no reputation row', async () => {
      mockPool.query
        .mockResolvedValueOnce({
          rows: [
            {
              messages_sent: 5,
              reactions_given: 1,
              reactions_received: 0,
              days_active: 1,
              first_seen: '2024-06-01T00:00:00Z',
              last_active: '2024-06-01T00:00:00Z',
              public_profile: true,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }); // no reputation

      const res = await request(app)
        .get(`/api/v1/community/${GUILD_ID}/profile/${PUBLIC_USER}`)
        .expect(200);

      expect(res.body.xp).toBe(0);
      expect(res.body.level).toBe(0);
      expect(res.body.badge).toBe('👋 New');
    });
  });

  // ─── Rate Limiting (MUST be last — exhausts the module-level limiter) ─────

  describe('rate limiting', () => {
    it('enforces 30 req/min rate limit on community endpoints', async () => {
      // Stub all queries so they succeed fast
      mockPool.query.mockResolvedValue({ rows: [{ total: 0, count: 0 }] });

      // The community router has its own 30 req/min limiter.
      // Plus the global server limiter (100 req/15min).
      // We send 31 requests and expect the 31st to be rate-limited.
      const promises = [];
      for (let i = 0; i < 31; i++) {
        promises.push(request(app).get(`/api/v1/community/${GUILD_ID}/leaderboard`));
      }

      const results = await Promise.all(promises);
      const statusCodes = results.map((r) => r.status);
      const rateLimited = statusCodes.filter((s) => s === 429);

      expect(rateLimited.length).toBeGreaterThanOrEqual(1);
    });
  });
});
