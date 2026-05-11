/**
 * Tests for src/api/repositories/analyticsRepository.js
 * Covers buildFilteredQuery, formatRecentEvents, formatBucketLabel,
 * fetchRecentEvents, fetchAnalyticsDataset, and fetchActiveAiConversations.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import {
  buildFilteredQuery,
  fetchActiveAiConversations,
  fetchAnalyticsDataset,
  fetchRecentEvents,
  formatBucketLabel,
  formatRecentEvents,
} from '../../../src/api/repositories/analyticsRepository.js';
import * as logger from '../../../src/logger.js';

// ─── buildFilteredQuery ───────────────────────────────────────────────────────

describe('buildFilteredQuery', () => {
  it('adds a nullable channel predicate when channelFilter is falsy', () => {
    const { where, values } = buildFilteredQuery(
      ['guild_id = $1', 'created_at >= $2'],
      ['g1', '2024-01-01'],
      null,
      'channel_id',
    );
    expect(where).toBe(
      'guild_id = $1 AND created_at >= $2 AND ($3::text IS NULL OR channel_id = $3)',
    );
    expect(values).toEqual(['g1', '2024-01-01', null]);
  });

  it('uses the same nullable channel predicate when channelFilter is provided', () => {
    const { where, values } = buildFilteredQuery(
      ['guild_id = $1', 'created_at >= $2'],
      ['g1', '2024-01-01'],
      'ch123',
      'channel_id',
    );
    expect(where).toBe(
      'guild_id = $1 AND created_at >= $2 AND ($3::text IS NULL OR channel_id = $3)',
    );
    expect(values).toEqual(['g1', '2024-01-01', 'ch123']);
  });

  it('handles a single base part with channel filter', () => {
    const { where, values } = buildFilteredQuery(['guild_id = $1'], ['g1'], 'ch999', 'channel_id');
    expect(where).toBe('guild_id = $1 AND ($2::text IS NULL OR channel_id = $2)');
    expect(values).toEqual(['g1', 'ch999']);
  });

  it('does not mutate the original baseParts or baseValues arrays', () => {
    const baseParts = ['guild_id = $1'];
    const baseValues = ['g1'];
    buildFilteredQuery(baseParts, baseValues, 'ch1', 'channel_id');
    expect(baseParts).toEqual(['guild_id = $1']);
    expect(baseValues).toEqual(['g1']);
  });

  it('uses empty string channelFilter as null for the nullable channel predicate', () => {
    const { where, values } = buildFilteredQuery(['guild_id = $1'], ['g1'], '', 'channel_id');
    expect(where).toBe('guild_id = $1 AND ($2::text IS NULL OR channel_id = $2)');
    expect(values).toEqual(['g1', null]);
  });

  it('rejects unsupported channel columns instead of interpolating SQL identifiers', () => {
    expect(() => buildFilteredQuery(['guild_id = $1'], ['g1'], 'ch1', 'evil_column')).toThrow(
      TypeError,
    );
  });
});

// ─── formatRecentEvents ───────────────────────────────────────────────────────

describe('formatRecentEvents', () => {
  it('returns empty array for two empty inputs', () => {
    expect(formatRecentEvents([], [])).toEqual([]);
  });

  it('formats message rows with actor and truncated detail', () => {
    const ts = new Date('2024-03-01T12:00:00Z');
    const rows = [{ type: 'message', actor: 'Alice', detail: 'Hello world', ts: ts.toISOString() }];
    const result = formatRecentEvents(rows, []);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Alice: Hello world');
  });

  it('truncates message detail at 40 characters with ellipsis', () => {
    const ts = new Date('2024-03-01T12:00:00Z');
    const longDetail = 'a'.repeat(41);
    const rows = [{ type: 'message', actor: 'Bob', detail: longDetail, ts: ts.toISOString() }];
    const result = formatRecentEvents(rows, []);
    expect(result[0].text).toBe(`Bob: ${'a'.repeat(40)}...`);
  });

  it('does not truncate message detail at exactly 40 characters', () => {
    const ts = new Date('2024-03-01T12:00:00Z');
    const detail40 = 'b'.repeat(40);
    const rows = [{ type: 'message', actor: 'Carol', detail: detail40, ts: ts.toISOString() }];
    const result = formatRecentEvents(rows, []);
    expect(result[0].text).toBe(`Carol: ${'b'.repeat(40)}`);
    expect(result[0].text).not.toContain('...');
  });

  it('formats command rows correctly', () => {
    const ts = new Date('2024-03-01T12:00:00Z');
    const rows = [{ type: 'command', actor: 'Dave', detail: 'play', ts: ts.toISOString() }];
    const result = formatRecentEvents([], rows);
    expect(result[0].text).toBe('Dave used /play');
  });

  it('defaults missing detail to empty string', () => {
    const ts = new Date('2024-03-01T12:00:00Z');
    const rows = [{ type: 'command', actor: 'Eve', ts: ts.toISOString() }];
    const result = formatRecentEvents([], rows);
    expect(result[0].text).toBe('Eve used /');
  });

  it('sorts combined rows by descending timestamp', () => {
    const earlier = new Date('2024-03-01T10:00:00Z');
    const later = new Date('2024-03-01T12:00:00Z');
    const msgs = [{ type: 'message', actor: 'A', detail: 'first', ts: earlier.toISOString() }];
    const cmds = [{ type: 'command', actor: 'B', detail: 'cmd', ts: later.toISOString() }];
    const result = formatRecentEvents(msgs, cmds);
    expect(result[0].text).toBe('B used /cmd');
    expect(result[1].text).toBe('A: first');
  });

  it('limits output to 10 events', () => {
    const ts = new Date('2024-03-01T12:00:00Z');
    const msgs = Array.from({ length: 8 }, (_, i) => ({
      type: 'message',
      actor: `User${i}`,
      detail: 'hi',
      ts: new Date(ts.getTime() + i * 1000).toISOString(),
    }));
    const cmds = Array.from({ length: 5 }, (_, i) => ({
      type: 'command',
      actor: `User${i}`,
      detail: 'cmd',
      ts: new Date(ts.getTime() + (i + 8) * 1000).toISOString(),
    }));
    const result = formatRecentEvents(msgs, cmds);
    expect(result).toHaveLength(10);
  });

  it('assigns a deterministic id with type prefix', () => {
    const ts = new Date('2024-03-01T12:00:00Z');
    const rows = [{ type: 'message', actor: 'Alice', detail: 'Hi', ts: ts.toISOString() }];
    const result = formatRecentEvents(rows, []);
    expect(result[0].id).toMatch(/^message-[0-9a-f]{16}$/);
  });

  it('produces the same id for identical input (deterministic)', () => {
    const ts = new Date('2024-03-01T12:00:00Z');
    const rows = [{ type: 'command', actor: 'Bob', detail: 'play', ts: ts.toISOString() }];
    const r1 = formatRecentEvents([], rows);
    const r2 = formatRecentEvents([], rows);
    expect(r1[0].id).toBe(r2[0].id);
  });

  it('falls back to epoch for invalid ts values', () => {
    const rows = [{ type: 'command', actor: 'X', detail: 'y', ts: 'not-a-date' }];
    const result = formatRecentEvents([], rows);
    expect(result[0].timestamp).toBe(new Date(0).toISOString());
  });

  it('includes an ISO timestamp on each event', () => {
    const ts = new Date('2024-06-15T08:30:00Z');
    const rows = [{ type: 'message', actor: 'A', detail: 'msg', ts: ts.toISOString() }];
    const result = formatRecentEvents(rows, []);
    expect(result[0].timestamp).toBe(ts.toISOString());
  });
});

// ─── formatBucketLabel ────────────────────────────────────────────────────────

describe('formatBucketLabel', () => {
  it('includes hour when interval is "hour"', () => {
    const bucket = new Date('2024-03-15T14:00:00Z');
    const label = formatBucketLabel(bucket, 'hour');
    // Should contain "Mar" and "15" and a time component
    expect(label).toMatch(/Mar/);
    expect(label).toMatch(/15/);
    // hour interval label typically ends with "AM" or "PM"
    expect(label).toMatch(/AM|PM/i);
  });

  it('does not include hour when interval is "day"', () => {
    const bucket = new Date('2024-03-15T00:00:00Z');
    const label = formatBucketLabel(bucket, 'day');
    expect(label).toMatch(/Mar/);
    expect(label).toMatch(/15/);
    expect(label).not.toMatch(/AM|PM/i);
  });

  it('returns day format for unknown interval', () => {
    const bucket = new Date('2024-07-04T00:00:00Z');
    const label = formatBucketLabel(bucket, 'week');
    expect(label).toMatch(/Jul/);
    expect(label).toMatch(/4/);
    expect(label).not.toMatch(/AM|PM/i);
  });

  it('formats UTC dates consistently regardless of local timezone', () => {
    // Bucket at UTC midnight — date should reflect UTC day, not local offset
    const bucket = new Date('2024-01-01T00:00:00Z');
    const label = formatBucketLabel(bucket, 'day');
    expect(label).toMatch(/Jan/);
    expect(label).toMatch(/1/);
  });
});

// ─── fetchRecentEvents ────────────────────────────────────────────────────────

describe('fetchRecentEvents', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = { query: vi.fn() };
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('queries with guild_id filter only when no channelFilter is provided', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await fetchRecentEvents(mockPool, 'guild1', null);

    expect(mockPool.query).toHaveBeenCalledTimes(2);
    // First call: conversations query
    const convQuery = mockPool.query.mock.calls[0];
    expect(convQuery[1]).toEqual(['guild1', null]);
    // Second call: command query
    const cmdQuery = mockPool.query.mock.calls[1];
    expect(cmdQuery[1]).toEqual(['guild1', null]);
  });

  it('appends channel_id to query values when channelFilter is provided', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await fetchRecentEvents(mockPool, 'guild1', 'ch999');

    const convArgs = mockPool.query.mock.calls[0][1];
    const cmdArgs = mockPool.query.mock.calls[1][1];
    expect(convArgs).toContain('ch999');
    expect(cmdArgs).toContain('ch999');
  });

  it('returns formatted events merging messages and commands', async () => {
    const ts = new Date('2024-03-01T12:00:00Z');
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{ type: 'message', actor: 'Alice', detail: 'Hello', ts: ts.toISOString() }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            type: 'command',
            actor: 'Bob',
            detail: 'play',
            ts: new Date(ts.getTime() + 1000).toISOString(),
          },
        ],
      });

    const result = await fetchRecentEvents(mockPool, 'guild1', null);
    expect(result).toHaveLength(2);
    // Bob's command is more recent, so it comes first
    expect(result[0].text).toBe('Bob used /play');
    expect(result[1].text).toBe('Alice: Hello');
  });

  it('returns empty array and logs warning when messages query fails', async () => {
    const err = new Error('DB down');
    mockPool.query.mockRejectedValueOnce(err).mockResolvedValueOnce({ rows: [] });

    const result = await fetchRecentEvents(mockPool, 'guild1', null);
    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Recent messages query failed'),
      expect.objectContaining({ guild: 'guild1', error: 'DB down' }),
    );
  });

  it('returns empty array and logs warning when commands query fails', async () => {
    const err = new Error('timeout');
    mockPool.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(err);

    const result = await fetchRecentEvents(mockPool, 'guild1', null);
    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Recent commands query failed'),
      expect.objectContaining({ guild: 'guild1', error: 'timeout' }),
    );
  });

  it('handles non-Error thrown values in query catch', async () => {
    mockPool.query.mockRejectedValueOnce('string error').mockResolvedValueOnce({ rows: [] });

    const result = await fetchRecentEvents(mockPool, 'guild1', null);
    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Recent messages query failed'),
      expect.objectContaining({ error: 'string error' }),
    );
  });

  it('logs a stable fallback when an Error message accessor throws', async () => {
    const hostileError = new Error('hidden');
    Object.defineProperty(hostileError, 'message', {
      get() {
        throw new Error('message getter failed');
      },
    });
    mockPool.query.mockRejectedValueOnce(hostileError).mockResolvedValueOnce({ rows: [] });

    const result = await fetchRecentEvents(mockPool, 'guild1', null);
    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Recent messages query failed'),
      expect.objectContaining({ guild: 'guild1', error: 'Unknown error' }),
    );
  });
});

// ─── fetchActiveAiConversations ───────────────────────────────────────────────

describe('fetchActiveAiConversations', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = { query: vi.fn() };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns count when no channelFilter provided', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ count: 3 }] });

    const count = await fetchActiveAiConversations(mockPool, 'guild1', null, 15);
    expect(count).toBe(3);
    expect(mockPool.query.mock.calls[0][1]).toEqual(['guild1', null, 15]);
  });

  it('returns count when channelFilter is provided', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ count: 7 }] });

    const count = await fetchActiveAiConversations(mockPool, 'guild1', 'ch42', 15);
    expect(count).toBe(7);
    expect(mockPool.query.mock.calls[0][1]).toEqual(['guild1', 'ch42', 15]);
  });

  it('returns 0 when result has no rows', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const count = await fetchActiveAiConversations(mockPool, 'guild1', null, 15);
    expect(count).toBe(0);
  });

  it('returns 0 when count is null or undefined', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ count: null }] });

    const count = await fetchActiveAiConversations(mockPool, 'guild1', null, 15);
    expect(count).toBe(0);
  });
});

// ─── fetchAnalyticsDataset ────────────────────────────────────────────────────

describe('fetchAnalyticsDataset', () => {
  let mockPool;
  let mockGuild;

  const baseOptions = {
    guildId: 'guild1',
    from: new Date('2024-03-01T00:00:00Z'),
    to: new Date('2024-03-08T00:00:00Z'),
    range: 'week',
    interval: 'day',
    compareMode: false,
    comparisonFrom: null,
    comparisonTo: null,
    channelFilter: null,
    aiUsageUnavailableSource: 'unavailable',
  };

  beforeEach(() => {
    mockGuild = {
      channels: { cache: new Map([['ch1', { name: 'general' }]]) },
    };

    // Default mock: return empty rows for all queries
    mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns dataset with zeros when all queries return empty rows', async () => {
    const result = await fetchAnalyticsDataset({
      ...baseOptions,
      dbPool: mockPool,
      guild: mockGuild,
    });

    expect(result.guildId).toBe('guild1');
    expect(result.kpis.totalMessages).toBe(0);
    expect(result.kpis.aiRequests).toBe(0);
    expect(result.kpis.aiCostUsd).toBeNull();
    expect(result.kpis.activeUsers).toBe(0);
    expect(result.messageVolume).toEqual([]);
    expect(result.heatmap).toEqual([]);
    expect(result.aiUsage.source).toBe('ai_usage');
    expect(result.channelActivity).toEqual([]);
    expect(result.topChannels).toEqual([]);
    expect(result.commandUsage.source).toBe('command_usage');
    expect(result.comparison).toBeNull();
    expect(result.userEngagement).toBeNull();
    expect(result.xpEconomy).toBeNull();
  });

  it('includes range metadata in result', async () => {
    const result = await fetchAnalyticsDataset({
      ...baseOptions,
      dbPool: mockPool,
      guild: mockGuild,
    });

    expect(result.range).toMatchObject({
      type: 'week',
      from: baseOptions.from.toISOString(),
      to: baseOptions.to.toISOString(),
      interval: 'day',
      channelId: null,
      compare: false,
    });
  });

  it('populates kpis from the kpi result row', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (
        sql.includes('total_messages') &&
        sql.includes('ai_requests') &&
        sql.includes('active_users')
      ) {
        return Promise.resolve({
          rows: [{ total_messages: 100, ai_requests: 20, active_users: 15 }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await fetchAnalyticsDataset({
      ...baseOptions,
      dbPool: mockPool,
      guild: mockGuild,
    });
    expect(result.kpis.totalMessages).toBe(100);
    expect(result.kpis.aiRequests).toBe(20);
    expect(result.kpis.activeUsers).toBe(15);
  });

  it('resolves channel names from guild cache in channelActivity', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('GROUP BY channel_id') && sql.includes('ORDER BY messages DESC')) {
        return Promise.resolve({
          rows: [{ channel_id: 'ch1', messages: 42 }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await fetchAnalyticsDataset({
      ...baseOptions,
      dbPool: mockPool,
      guild: mockGuild,
    });
    expect(result.channelActivity[0]).toMatchObject({
      channelId: 'ch1',
      name: 'general',
      messages: 42,
    });
  });

  it('falls back to channel_id when channel not in cache', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('GROUP BY channel_id') && sql.includes('ORDER BY messages DESC')) {
        return Promise.resolve({
          rows: [{ channel_id: 'unknown-ch', messages: 5 }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await fetchAnalyticsDataset({
      ...baseOptions,
      dbPool: mockPool,
      guild: mockGuild,
    });
    expect(result.channelActivity[0].name).toBe('unknown-ch');
  });

  it('sets aiUsage source to unavailable when ai_usage query fails', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('FROM ai_usage')) {
        return Promise.reject(new Error('ai_usage table missing'));
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await fetchAnalyticsDataset({
      ...baseOptions,
      dbPool: mockPool,
      guild: mockGuild,
    });
    expect(result.aiUsage.source).toBe('unavailable');
    expect(result.aiUsage.byModel).toEqual([]);
    expect(result.aiUsage.tokens).toEqual({ prompt: null, completion: null });
  });

  it('sets commandUsage source to unavailable when command_usage query fails', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('FROM command_usage')) {
        return Promise.reject(new Error('command_usage table missing'));
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await fetchAnalyticsDataset({
      ...baseOptions,
      dbPool: mockPool,
      guild: mockGuild,
    });
    expect(result.commandUsage.source).toBe('unavailable');
    expect(result.commandUsage.items).toEqual([]);
  });

  it('includes comparison data when compareMode is true', async () => {
    const opts = {
      ...baseOptions,
      compareMode: true,
      comparisonFrom: new Date('2024-02-22T00:00:00Z'),
      comparisonTo: new Date('2024-03-01T00:00:00Z'),
    };

    const result = await fetchAnalyticsDataset({ ...opts, dbPool: mockPool, guild: mockGuild });
    expect(result.comparison).not.toBeNull();
    expect(result.comparison.previousRange.from).toBe(opts.comparisonFrom.toISOString());
    expect(result.comparison.previousRange.to).toBe(opts.comparisonTo.toISOString());
  });

  it('does not call toISOString on missing comparison dates when compareMode is true', async () => {
    const result = await fetchAnalyticsDataset({
      ...baseOptions,
      compareMode: true,
      comparisonFrom: null,
      comparisonTo: null,
      dbPool: mockPool,
      guild: mockGuild,
    });

    expect(result.range.compare).toBe(true);
    expect(result.comparison).toBeNull();
  });

  it('includes userEngagement when trackedUsers > 0', async () => {
    mockPool.query.mockImplementation((sql) => {
      // Engagement query (range_engagement CTE)
      if (sql.includes('tracked_users') && sql.includes('user_messages')) {
        return Promise.resolve({
          rows: [
            {
              tracked_users: 5,
              user_messages: 10,
              lifetime_reactions_given: 2,
              lifetime_reactions_received: 3,
            },
          ],
        });
      }
      // KPI query
      if (
        sql.includes('total_messages') &&
        sql.includes('ai_requests') &&
        sql.includes('active_users')
      ) {
        return Promise.resolve({
          rows: [{ total_messages: 10, ai_requests: 5, active_users: 5 }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await fetchAnalyticsDataset({
      ...baseOptions,
      dbPool: mockPool,
      guild: mockGuild,
    });
    expect(result.userEngagement).not.toBeNull();
    expect(result.userEngagement.trackedUsers).toBe(5);
    expect(result.userEngagement.avgMessagesPerUser).toBe(2); // 10/5
  });

  it('returns null userEngagement when engagement query fails', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('range_engagement') || sql.includes('lifetime_reactions')) {
        return Promise.reject(new Error('engagement table missing'));
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await fetchAnalyticsDataset({
      ...baseOptions,
      dbPool: mockPool,
      guild: mockGuild,
    });
    expect(result.userEngagement).toBeNull();
  });

  it('populates xpEconomy from reputation table', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('FROM reputation')) {
        return Promise.resolve({
          rows: [{ total_users: 50, total_xp: 5000, avg_level: 3.7, max_level: 10 }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await fetchAnalyticsDataset({
      ...baseOptions,
      dbPool: mockPool,
      guild: mockGuild,
    });
    expect(result.xpEconomy).toMatchObject({
      totalUsers: 50,
      totalXp: 5000,
      avgLevel: 3.7,
      maxLevel: 10,
    });
  });

  it('returns null xpEconomy when reputation query fails', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('FROM reputation')) {
        return Promise.reject(new Error('reputation table missing'));
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await fetchAnalyticsDataset({
      ...baseOptions,
      dbPool: mockPool,
      guild: mockGuild,
    });
    expect(result.xpEconomy).toBeNull();
  });

  it('uses hour bucket expression when interval is hour', async () => {
    const querySpy = vi.fn().mockResolvedValue({ rows: [] });
    mockPool.query = querySpy;

    await fetchAnalyticsDataset({
      ...baseOptions,
      interval: 'hour',
      dbPool: mockPool,
      guild: mockGuild,
    });

    const volumeCall = querySpy.mock.calls.find(
      ([sql]) => sql.includes('bucket') && sql.includes('GROUP BY 1'),
    );
    expect(volumeCall[0]).toContain("date_trunc('hour'");
  });

  it('uses day bucket expression when interval is day', async () => {
    const querySpy = vi.fn().mockResolvedValue({ rows: [] });
    mockPool.query = querySpy;

    await fetchAnalyticsDataset({
      ...baseOptions,
      interval: 'day',
      dbPool: mockPool,
      guild: mockGuild,
    });

    const volumeCall = querySpy.mock.calls.find(
      ([sql]) => sql.includes('bucket') && sql.includes('GROUP BY 1'),
    );
    expect(volumeCall[0]).toContain("date_trunc('day'");
  });

  it('aggregates tokens from ai_usage rows', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('FROM ai_usage')) {
        return Promise.resolve({
          rows: [
            {
              model: 'gpt-4',
              requests: 5,
              prompt_tokens: 100,
              completion_tokens: 50,
              cost_usd: 0.01,
            },
            {
              model: 'gpt-3.5',
              requests: 3,
              prompt_tokens: 200,
              completion_tokens: 80,
              cost_usd: 0.005,
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await fetchAnalyticsDataset({
      ...baseOptions,
      dbPool: mockPool,
      guild: mockGuild,
    });
    expect(result.aiUsage.tokens.prompt).toBe(300);
    expect(result.aiUsage.tokens.completion).toBe(130);
    expect(result.aiUsage.source).toBe('ai_usage');
    expect(result.kpis.aiCostUsd).toBeCloseTo(0.015);
  });

  it('heatmap contains dayOfWeek, hour, and messages', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('day_of_week') && sql.includes('hour_of_day')) {
        return Promise.resolve({
          rows: [{ day_of_week: 1, hour_of_day: 9, messages: 7 }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await fetchAnalyticsDataset({
      ...baseOptions,
      dbPool: mockPool,
      guild: mockGuild,
    });
    expect(result.heatmap).toEqual([{ dayOfWeek: 1, hour: 9, messages: 7 }]);
  });
});
