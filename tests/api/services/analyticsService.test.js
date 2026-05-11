/**
 * Tests for src/api/services/analyticsService.js
 * Covers getErrorMessage, parseDateParam, parseAnalyticsRange,
 * parseAnalyticsInterval, parseComparisonMode, parseChannelFilter,
 * countNewMembersInRange, countOnlineMembers, buildAnalyticsCacheKey,
 * and AnalyticsRangeValidationError.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../src/utils/cache.js', () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheGetOrSet: vi.fn().mockImplementation((_key, factory) => factory()),
  cacheDel: vi.fn().mockResolvedValue(undefined),
  cacheDelPattern: vi.fn().mockResolvedValue(0),
  TTL: {
    CHANNELS: 300,
    ROLES: 300,
    MEMBERS: 60,
    CONFIG: 60,
    REPUTATION: 60,
    LEADERBOARD: 300,
    ANALYTICS: 3600,
    SESSION: 86400,
  },
}));

vi.mock('../../../src/api/repositories/analyticsRepository.js', () => ({
  fetchAnalyticsDataset: vi.fn().mockResolvedValue({
    guildId: 'g1',
    range: { type: 'week', from: '', to: '', interval: 'day', channelId: null, compare: false },
    kpis: { totalMessages: 0, aiRequests: 0, aiCostUsd: null, activeUsers: 0 },
    messageVolume: [],
    aiUsage: { source: 'ai_usage', byModel: [], tokens: { prompt: null, completion: null } },
    channelActivity: [],
    topChannels: [],
    commandUsage: { source: 'command_usage', items: [] },
    comparison: null,
    heatmap: [],
    userEngagement: null,
    xpEconomy: null,
  }),
  fetchRecentEvents: vi.fn().mockResolvedValue([]),
  fetchActiveAiConversations: vi.fn().mockResolvedValue(0),
}));

import { fetchAnalyticsDataset } from '../../../src/api/repositories/analyticsRepository.js';
import {
  ANALYTICS_CACHE_SCHEMA_VERSION,
  AnalyticsRangeValidationError,
  buildAnalyticsCacheKey,
  countNewMembersInRange,
  countOnlineMembers,
  getErrorMessage,
  getGuildAnalytics,
  MAX_ANALYTICS_RANGE_DAYS,
  parseAnalyticsInterval,
  parseAnalyticsRange,
  parseChannelFilter,
  parseComparisonMode,
  parseDateParam,
  UNKNOWN_ERROR_MESSAGE,
} from '../../../src/api/services/analyticsService.js';

// ─── AnalyticsRangeValidationError ───────────────────────────────────────────

describe('AnalyticsRangeValidationError', () => {
  it('is an instance of Error', () => {
    const err = new AnalyticsRangeValidationError('bad range');
    expect(err).toBeInstanceOf(Error);
  });

  it('has name "AnalyticsRangeValidationError"', () => {
    const err = new AnalyticsRangeValidationError('bad range');
    expect(err.name).toBe('AnalyticsRangeValidationError');
  });

  it('carries the provided message', () => {
    const err = new AnalyticsRangeValidationError('invalid param');
    expect(err.message).toBe('invalid param');
  });
});

// ─── getErrorMessage ──────────────────────────────────────────────────────────

describe('getErrorMessage', () => {
  it('returns message from Error instance', () => {
    expect(getErrorMessage(new Error('oops'))).toBe('oops');
  });

  it('does not throw when an Error message accessor throws', () => {
    const hostileError = new Error('hidden');
    Object.defineProperty(hostileError, 'message', {
      get() {
        throw new Error('message getter failed');
      },
    });

    expect(getErrorMessage(hostileError)).toBe(UNKNOWN_ERROR_MESSAGE);
  });

  it('returns message from object with string message', () => {
    expect(getErrorMessage({ message: 'object message' })).toBe('object message');
  });

  it('returns String() for non-nullish non-Error values', () => {
    expect(getErrorMessage('raw string')).toBe('raw string');
    expect(getErrorMessage(42)).toBe('42');
  });

  it('returns the stable fallback for nullish values', () => {
    expect(getErrorMessage(null)).toBe(UNKNOWN_ERROR_MESSAGE);
    expect(getErrorMessage(undefined)).toBe(UNKNOWN_ERROR_MESSAGE);
  });

  it('falls back when a hostile value cannot be stringified', () => {
    const hostile = {
      get message() {
        throw new Error('message getter failed');
      },
      [Symbol.toPrimitive]() {
        throw new Error('primitive failed');
      },
      toString() {
        throw new Error('toString failed');
      },
    };

    expect(getErrorMessage(hostile)).toBe(UNKNOWN_ERROR_MESSAGE);
  });
});

// ─── attachAnalyticsContext via getGuildAnalytics ─────────────────────────────

describe('getGuildAnalytics error context', () => {
  const guild = {
    members: { cache: new Map() },
  };

  it('wraps frozen errors that cannot be annotated in-place', async () => {
    const original = Object.freeze(new Error('frozen analytics failure'));
    fetchAnalyticsDataset.mockRejectedValueOnce(original);

    try {
      await getGuildAnalytics({ dbPool: {}, guild, guildId: 'guild1', query: {} });
      throw new Error('expected getGuildAnalytics to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBe(original);
      expect(err.message).toBe('frozen analytics failure');
      expect(err.cause).toBe(original);
      expect(err.analyticsContext).toMatchObject({ range: 'week', interval: 'day' });
    }
  });

  it('wraps non-extensible error-like values with context and cause', async () => {
    const original = Object.preventExtensions({ message: 'sealed analytics failure' });
    fetchAnalyticsDataset.mockRejectedValueOnce(original);

    try {
      await getGuildAnalytics({ dbPool: {}, guild, guildId: 'guild1', query: {} });
      throw new Error('expected getGuildAnalytics to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('sealed analytics failure');
      expect(err.cause).toBe(original);
      expect(err.analyticsContext).toMatchObject({ range: 'week', interval: 'day' });
    }
  });

  it('wraps non-extensible values when message access and stringification fail', async () => {
    const original = Object.preventExtensions({
      get message() {
        throw new Error('message getter failed');
      },
      [Symbol.toPrimitive]() {
        throw new Error('primitive failed');
      },
      toString() {
        throw new Error('toString failed');
      },
    });
    fetchAnalyticsDataset.mockRejectedValueOnce(original);

    try {
      await getGuildAnalytics({ dbPool: {}, guild, guildId: 'guild1', query: {} });
      throw new Error('expected getGuildAnalytics to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe(UNKNOWN_ERROR_MESSAGE);
      expect(err.cause).toBe(original);
      expect(err.analyticsContext).toMatchObject({ range: 'week', interval: 'day' });
    }
  });
});

// ─── getGuildAnalytics comparison windows ────────────────────────────────────

describe('getGuildAnalytics comparison windows', () => {
  it('passes comparisonTo as one millisecond before the custom range start', async () => {
    fetchAnalyticsDataset.mockClear();

    const from = '2024-03-10T00:00:00.000Z';
    const to = '2024-03-12T12:00:00.000Z';
    const guild = {
      members: { cache: new Map() },
    };

    await getGuildAnalytics({
      dbPool: {},
      guild,
      guildId: 'guild1',
      query: { range: 'custom', from, to, compare: 'true' },
    });

    expect(fetchAnalyticsDataset).toHaveBeenCalledTimes(1);
    const [{ comparisonTo }] = fetchAnalyticsDataset.mock.calls[0];
    expect(comparisonTo).toBeInstanceOf(Date);
    expect(comparisonTo.getTime()).toBe(new Date(from).getTime() - 1);
    expect(comparisonTo.toISOString()).toBe('2024-03-09T23:59:59.999Z');
  });
});

// ─── getGuildAnalytics realtime ───────────────────────────────────────────────

describe('getGuildAnalytics realtime', () => {
  it('excludes bot presences from realtime onlineMembers', async () => {
    const guild = {
      members: {
        cache: new Map([
          ['human-online', { user: { bot: false }, presence: { status: 'online' } }],
          ['human-offline', { user: { bot: false }, presence: { status: 'offline' } }],
          ['bot-online', { user: { bot: true }, presence: { status: 'online' } }],
        ]),
      },
    };

    const result = await getGuildAnalytics({ dbPool: {}, guild, guildId: 'guild1', query: {} });

    expect(result.realtime.onlineMembers).toBe(1);
  });
});

// ─── parseDateParam ───────────────────────────────────────────────────────────

describe('parseDateParam', () => {
  it('returns null for non-string values', () => {
    expect(parseDateParam(null)).toBeNull();
    expect(parseDateParam(undefined)).toBeNull();
    expect(parseDateParam(123)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseDateParam('')).toBeNull();
    expect(parseDateParam('   ')).toBeNull();
  });

  it('returns null for invalid date string', () => {
    expect(parseDateParam('not-a-date')).toBeNull();
    expect(parseDateParam('99999-99-99')).toBeNull();
  });

  it('returns Date for valid ISO string', () => {
    const result = parseDateParam('2024-03-15T10:00:00Z');
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe('2024-03-15T10:00:00.000Z');
  });

  it('returns Date for date-only string', () => {
    const result = parseDateParam('2024-06-01');
    expect(result).toBeInstanceOf(Date);
    expect(Number.isNaN(result.getTime())).toBe(false);
  });
});

// ─── parseAnalyticsRange ──────────────────────────────────────────────────────

describe('parseAnalyticsRange', () => {
  it('defaults to "week" for missing range', () => {
    const result = parseAnalyticsRange({});
    expect(result.range).toBe('week');
    expect(result.from).toBeInstanceOf(Date);
    expect(result.to).toBeInstanceOf(Date);
  });

  it('defaults to "week" for unknown range value', () => {
    const result = parseAnalyticsRange({ range: 'quarterly' });
    expect(result.range).toBe('week');
  });

  it('accepts "today" range', () => {
    const result = parseAnalyticsRange({ range: 'today' });
    expect(result.range).toBe('today');
    // "from" should be start of today UTC
    expect(result.from.getUTCHours()).toBe(0);
    expect(result.from.getUTCMinutes()).toBe(0);
    expect(result.from.getUTCSeconds()).toBe(0);
  });

  it('accepts "month" range', () => {
    const result = parseAnalyticsRange({ range: 'month' });
    expect(result.range).toBe('month');
    const expectedFrom = new Date(
      Date.UTC(result.to.getUTCFullYear(), result.to.getUTCMonth(), result.to.getUTCDate() - 30),
    );
    expect(result.from.toISOString()).toBe(expectedFrom.toISOString());
  });

  it('accepts "week" range', () => {
    const result = parseAnalyticsRange({ range: 'week' });
    expect(result.range).toBe('week');
    const expectedFrom = new Date(
      Date.UTC(result.to.getUTCFullYear(), result.to.getUTCMonth(), result.to.getUTCDate() - 7),
    );
    expect(result.from.toISOString()).toBe(expectedFrom.toISOString());
  });

  it('is case-insensitive for range values', () => {
    expect(parseAnalyticsRange({ range: 'TODAY' }).range).toBe('today');
    expect(parseAnalyticsRange({ range: 'WEEK' }).range).toBe('week');
  });

  it('accepts valid custom range', () => {
    const result = parseAnalyticsRange({
      range: 'custom',
      from: '2024-03-01T00:00:00Z',
      to: '2024-03-07T00:00:00Z',
    });
    expect(result.range).toBe('custom');
    expect(result.from.toISOString()).toBe('2024-03-01T00:00:00.000Z');
    expect(result.to.toISOString()).toBe('2024-03-07T00:00:00.000Z');
  });

  it('throws AnalyticsRangeValidationError for custom range without from/to', () => {
    expect(() => parseAnalyticsRange({ range: 'custom' })).toThrow(AnalyticsRangeValidationError);
  });

  it('throws AnalyticsRangeValidationError when from > to', () => {
    expect(() =>
      parseAnalyticsRange({
        range: 'custom',
        from: '2024-03-07T00:00:00Z',
        to: '2024-03-01T00:00:00Z',
      }),
    ).toThrow(AnalyticsRangeValidationError);
  });

  it(`throws AnalyticsRangeValidationError when custom range exceeds ${MAX_ANALYTICS_RANGE_DAYS} days`, () => {
    const from = '2024-01-01T00:00:00Z';
    const toDate = new Date('2024-01-01T00:00:00Z');
    toDate.setDate(toDate.getDate() + MAX_ANALYTICS_RANGE_DAYS + 1);
    expect(() => parseAnalyticsRange({ range: 'custom', from, to: toDate.toISOString() })).toThrow(
      AnalyticsRangeValidationError,
    );
  });

  it('throws error with message for invalid from param in custom range', () => {
    expect(() =>
      parseAnalyticsRange({ range: 'custom', from: 'invalid', to: '2024-03-07T00:00:00Z' }),
    ).toThrow('Custom range requires valid');
  });

  it('boundary: custom range of exactly MAX_ANALYTICS_RANGE_DAYS days does not throw', () => {
    const from = new Date('2024-01-01T00:00:00Z');
    const to = new Date(from.getTime() + MAX_ANALYTICS_RANGE_DAYS * 24 * 60 * 60 * 1000);
    expect(() =>
      parseAnalyticsRange({ range: 'custom', from: from.toISOString(), to: to.toISOString() }),
    ).not.toThrow();
  });
});

// ─── parseAnalyticsInterval ───────────────────────────────────────────────────

describe('parseAnalyticsInterval', () => {
  const from = new Date('2024-03-01T00:00:00Z');

  it('returns "hour" when query.interval is "hour"', () => {
    expect(parseAnalyticsInterval({ interval: 'hour' }, from, new Date())).toBe('hour');
  });

  it('returns "day" when query.interval is "day"', () => {
    expect(parseAnalyticsInterval({ interval: 'day' }, from, new Date())).toBe('day');
  });

  it('auto-selects "hour" for windows <= 48 hours', () => {
    const to = new Date(from.getTime() + 48 * 60 * 60 * 1000);
    expect(parseAnalyticsInterval({}, from, to)).toBe('hour');
  });

  it('auto-selects "day" for windows > 48 hours', () => {
    const to = new Date(from.getTime() + 48 * 60 * 60 * 1000 + 1);
    expect(parseAnalyticsInterval({}, from, to)).toBe('day');
  });

  it('ignores unknown interval values and falls back to auto', () => {
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000); // 1 day = hour bucket
    expect(parseAnalyticsInterval({ interval: 'week' }, from, to)).toBe('hour');
  });
});

// ─── parseComparisonMode ──────────────────────────────────────────────────────

describe('parseComparisonMode', () => {
  it('returns false when compare is not in query', () => {
    expect(parseComparisonMode({})).toBe(false);
  });

  it('returns false when compare is not a string', () => {
    expect(parseComparisonMode({ compare: true })).toBe(false);
    expect(parseComparisonMode({ compare: 1 })).toBe(false);
  });

  it('returns true for "1"', () => {
    expect(parseComparisonMode({ compare: '1' })).toBe(true);
  });

  it('returns true for "true"', () => {
    expect(parseComparisonMode({ compare: 'true' })).toBe(true);
  });

  it('returns true for "yes"', () => {
    expect(parseComparisonMode({ compare: 'yes' })).toBe(true);
  });

  it('returns true for "on"', () => {
    expect(parseComparisonMode({ compare: 'on' })).toBe(true);
  });

  it('returns true case-insensitively', () => {
    expect(parseComparisonMode({ compare: 'TRUE' })).toBe(true);
    expect(parseComparisonMode({ compare: 'YES' })).toBe(true);
    expect(parseComparisonMode({ compare: 'ON' })).toBe(true);
  });

  it('returns false for "0"', () => {
    expect(parseComparisonMode({ compare: '0' })).toBe(false);
  });

  it('returns false for "false"', () => {
    expect(parseComparisonMode({ compare: 'false' })).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(parseComparisonMode({ compare: '' })).toBe(false);
  });
});

// ─── parseChannelFilter ───────────────────────────────────────────────────────

describe('parseChannelFilter', () => {
  it('returns null when channelId is not provided', () => {
    expect(parseChannelFilter({})).toBeNull();
  });

  it('returns null when channelId is not a string', () => {
    expect(parseChannelFilter({ channelId: 12345 })).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseChannelFilter({ channelId: '' })).toBeNull();
    expect(parseChannelFilter({ channelId: '   ' })).toBeNull();
  });

  it('returns the channelId for a valid numeric-string ID', () => {
    expect(parseChannelFilter({ channelId: '123456789' })).toBe('123456789');
  });

  it('returns the channelId for a 20-digit ID', () => {
    const id = '1'.repeat(20);
    expect(parseChannelFilter({ channelId: id })).toBe(id);
  });

  it('returns null for an ID longer than 20 digits', () => {
    const id = '1'.repeat(21);
    expect(parseChannelFilter({ channelId: id })).toBeNull();
  });

  it('returns null for channelId containing non-digit characters', () => {
    expect(parseChannelFilter({ channelId: 'abc123' })).toBeNull();
    expect(parseChannelFilter({ channelId: '123-456' })).toBeNull();
  });
});

// ─── countNewMembersInRange ───────────────────────────────────────────────────

describe('countNewMembersInRange', () => {
  it('returns 0 for empty cache', () => {
    expect(countNewMembersInRange(new Map(), 0, Date.now())).toBe(0);
  });

  it('counts members whose joinedTimestamp is within range (inclusive)', () => {
    const fromMs = new Date('2024-03-01T00:00:00Z').getTime();
    const toMs = new Date('2024-03-07T00:00:00Z').getTime();
    const cache = new Map([
      ['m1', { user: { bot: false }, joinedTimestamp: fromMs }], // at from boundary
      ['m2', { user: { bot: false }, joinedTimestamp: toMs }], // at to boundary
      ['m3', { user: { bot: false }, joinedTimestamp: fromMs + 1000 }], // inside
    ]);
    expect(countNewMembersInRange(cache, fromMs, toMs)).toBe(3);
  });

  it('excludes members whose joinedTimestamp is outside range', () => {
    const fromMs = new Date('2024-03-01T00:00:00Z').getTime();
    const toMs = new Date('2024-03-07T00:00:00Z').getTime();
    const cache = new Map([
      ['m1', { user: { bot: false }, joinedTimestamp: fromMs - 1 }], // before range
      ['m2', { user: { bot: false }, joinedTimestamp: toMs + 1 }], // after range
    ]);
    expect(countNewMembersInRange(cache, fromMs, toMs)).toBe(0);
  });

  it('excludes bot members', () => {
    const fromMs = 0;
    const toMs = Date.now();
    const cache = new Map([
      ['bot1', { user: { bot: true }, joinedTimestamp: fromMs + 1000 }],
      ['user1', { user: { bot: false }, joinedTimestamp: fromMs + 1000 }],
    ]);
    expect(countNewMembersInRange(cache, fromMs, toMs)).toBe(1);
  });

  it('excludes members without joinedTimestamp', () => {
    const fromMs = 0;
    const toMs = Date.now();
    const cache = new Map([
      ['m1', { user: { bot: false }, joinedTimestamp: null }],
      ['m2', { user: { bot: false }, joinedTimestamp: undefined }],
    ]);
    expect(countNewMembersInRange(cache, fromMs, toMs)).toBe(0);
  });

  it('handles members without user property gracefully', () => {
    const fromMs = 0;
    const toMs = Date.now();
    const cache = new Map([
      ['m1', { joinedTimestamp: fromMs + 1000 }], // no user prop
    ]);
    // member.user is undefined → user?.bot is undefined (falsy) → not excluded as bot
    expect(countNewMembersInRange(cache, fromMs, toMs)).toBe(1);
  });

  it('iterates member values directly without copying the cache', () => {
    const fromMs = 0;
    const toMs = 10;
    const arrayFromSpy = vi.spyOn(Array, 'from');
    const cache = new Map([
      ['m1', { user: { bot: false }, joinedTimestamp: 5 }],
      ['m2', { user: { bot: true }, joinedTimestamp: 6 }],
    ]);

    try {
      expect(countNewMembersInRange(cache, fromMs, toMs)).toBe(1);
      expect(arrayFromSpy).not.toHaveBeenCalled();
    } finally {
      arrayFromSpy.mockRestore();
    }
  });
});

// ─── countOnlineMembers ───────────────────────────────────────────────────────

describe('countOnlineMembers', () => {
  it('returns onlineMembers: null and membersWithPresence: 0 for empty cache', () => {
    const result = countOnlineMembers(new Map());
    expect(result.onlineMembers).toBeNull();
    expect(result.membersWithPresence).toBe(0);
  });

  it('returns onlineMembers: null when no members have presence data', () => {
    const cache = new Map([
      ['m1', {}],
      ['m2', { presence: null }],
    ]);
    const result = countOnlineMembers(cache);
    expect(result.onlineMembers).toBeNull();
    expect(result.membersWithPresence).toBe(0);
  });

  it('counts online (non-offline) members correctly', () => {
    const cache = new Map([
      ['m1', { presence: { status: 'online' } }],
      ['m2', { presence: { status: 'idle' } }],
      ['m3', { presence: { status: 'dnd' } }],
      ['m4', { presence: { status: 'offline' } }],
    ]);
    const result = countOnlineMembers(cache);
    expect(result.onlineMembers).toBe(3); // online, idle, dnd
    expect(result.membersWithPresence).toBe(4);
  });

  it('returns onlineMembers: 0 when all members with presence are offline', () => {
    const cache = new Map([
      ['m1', { presence: { status: 'offline' } }],
      ['m2', { presence: { status: 'offline' } }],
    ]);
    const result = countOnlineMembers(cache);
    expect(result.onlineMembers).toBe(0);
    expect(result.membersWithPresence).toBe(2);
  });

  it('ignores members without presence.status', () => {
    const cache = new Map([
      ['m1', { presence: { status: 'online' } }],
      ['m2', { presence: {} }], // no status
      ['m3', {}], // no presence
    ]);
    const result = countOnlineMembers(cache);
    expect(result.onlineMembers).toBe(1);
    expect(result.membersWithPresence).toBe(1);
  });

  it('excludes bot presences from online counts', () => {
    const cache = new Map([
      ['human-online', { user: { bot: false }, presence: { status: 'online' } }],
      ['human-offline', { user: { bot: false }, presence: { status: 'offline' } }],
      ['bot-online', { user: { bot: true }, presence: { status: 'online' } }],
      ['bot-offline', { user: { bot: true }, presence: { status: 'offline' } }],
    ]);
    const result = countOnlineMembers(cache);
    expect(result.onlineMembers).toBe(1);
    expect(result.membersWithPresence).toBe(2);
  });
});

// ─── buildAnalyticsCacheKey ───────────────────────────────────────────────────

describe('buildAnalyticsCacheKey', () => {
  const baseParams = {
    guildId: 'guild1',
    range: 'week',
    interval: 'day',
    compareMode: false,
    channelFilter: null,
    from: new Date('2024-03-01T00:00:00Z'),
    to: new Date('2024-03-07T00:00:00Z'),
  };

  it('includes schema version in the key', () => {
    const key = buildAnalyticsCacheKey(baseParams);
    expect(key).toContain(ANALYTICS_CACHE_SCHEMA_VERSION);
  });

  it('includes guildId, range, and interval in the key', () => {
    const key = buildAnalyticsCacheKey(baseParams);
    expect(key).toContain('guild1');
    expect(key).toContain('week');
    expect(key).toContain('day');
  });

  it('includes "0" for compareMode=false and "1" for compareMode=true', () => {
    const keyFalse = buildAnalyticsCacheKey({ ...baseParams, compareMode: false });
    const keyTrue = buildAnalyticsCacheKey({ ...baseParams, compareMode: true });
    expect(keyFalse).toContain(':0:');
    expect(keyTrue).toContain(':1:');
  });

  it('uses from/to ISO strings as bucket for custom range', () => {
    const params = { ...baseParams, range: 'custom' };
    const key = buildAnalyticsCacheKey(params);
    expect(key).toContain(params.from.toISOString());
    expect(key).toContain(params.to.toISOString());
  });

  it('uses hour bucket for non-custom ranges', () => {
    const now = new Date('2024-03-05T14:30:00Z');
    const key = buildAnalyticsCacheKey({ ...baseParams, now });
    // Should include the hour portion of the now timestamp, not from/to
    expect(key).toContain('2024-03-05T14');
    expect(key).not.toContain(baseParams.from.toISOString());
  });

  it('includes channelFilter in key when provided', () => {
    const key = buildAnalyticsCacheKey({ ...baseParams, channelFilter: 'ch42' });
    expect(key).toContain('ch42');
  });

  it('uses empty string for null channelFilter', () => {
    const keyNull = buildAnalyticsCacheKey({ ...baseParams, channelFilter: null });
    const keyEmpty = buildAnalyticsCacheKey({ ...baseParams, channelFilter: '' });
    // Both should produce the same key (empty channel section)
    expect(keyNull).toBe(keyEmpty);
  });

  it('produces different keys for different guilds', () => {
    const key1 = buildAnalyticsCacheKey({ ...baseParams, guildId: 'guild1' });
    const key2 = buildAnalyticsCacheKey({ ...baseParams, guildId: 'guild2' });
    expect(key1).not.toBe(key2);
  });

  it('produces deterministic key given same inputs', () => {
    const now = new Date('2024-03-05T14:00:00Z');
    const k1 = buildAnalyticsCacheKey({ ...baseParams, now });
    const k2 = buildAnalyticsCacheKey({ ...baseParams, now });
    expect(k1).toBe(k2);
  });
});
