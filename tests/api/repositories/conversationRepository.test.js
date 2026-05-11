/**
 * Tests for src/api/repositories/conversationRepository.js
 * Covers estimateTokens, groupMessagesIntoConversations, findConversationMessage,
 * fetchFlagStatusesForMessages, fetchFlagTargets, insertFlaggedMessage,
 * listFlaggedMessages, fetchConversationStats, and listConversationSummaries.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/escapeIlike.js', () => ({
  escapeIlike: vi.fn((s) => s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')),
}));

import {
  CONVERSATION_GAP_MINUTES,
  estimateTokens,
  fetchConversationStats,
  fetchConversationWindowMessages,
  fetchFlagStatusesForMessages,
  fetchFlagTargets,
  findConversationMessage,
  groupMessagesIntoConversations,
  insertFlaggedMessage,
  isMessageInConversationSegment,
  listConversationSummaries,
  listFlaggedMessages,
  MAX_CONVERSATION_DETAIL_MESSAGES,
  MAX_CONVERSATION_MEMBERSHIP_HOPS,
} from '../../../src/api/repositories/conversationRepository.js';

// ─── Constants ────────────────────────────────────────────────────────────────

describe('CONVERSATION_GAP_MINUTES', () => {
  it('is 15', () => {
    expect(CONVERSATION_GAP_MINUTES).toBe(15);
  });
});

// ─── estimateTokens ───────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 0 for null', () => {
    expect(estimateTokens(null)).toBe(0);
  });

  it('returns 0 for undefined', () => {
    expect(estimateTokens(undefined)).toBe(0);
  });

  it('estimates 1 token for a 4-character string', () => {
    expect(estimateTokens('abcd')).toBe(1);
  });

  it('estimates 1 token for a 1-3 character string (ceil)', () => {
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('ab')).toBe(1);
    expect(estimateTokens('abc')).toBe(1);
  });

  it('estimates 2 tokens for a 5-character string', () => {
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('estimates tokens for a longer string', () => {
    const content = 'a'.repeat(100);
    expect(estimateTokens(content)).toBe(25);
  });
});

// ─── groupMessagesIntoConversations ──────────────────────────────────────────

describe('groupMessagesIntoConversations', () => {
  it('returns empty array for null input', () => {
    expect(groupMessagesIntoConversations(null)).toEqual([]);
  });

  it('returns empty array for empty array input', () => {
    expect(groupMessagesIntoConversations([])).toEqual([]);
  });

  it('groups single message as a single conversation', () => {
    const rows = [
      {
        id: 1,
        channel_id: 'ch1',
        role: 'user',
        content: 'Hello',
        created_at: '2024-01-01T10:00:00Z',
      },
    ];
    const result = groupMessagesIntoConversations(rows);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
    expect(result[0].channelId).toBe('ch1');
    expect(result[0].messages).toHaveLength(1);
  });

  it('groups messages within 15-minute gap into one conversation', () => {
    const rows = [
      { id: 1, channel_id: 'ch1', created_at: '2024-01-01T10:00:00Z' },
      { id: 2, channel_id: 'ch1', created_at: '2024-01-01T10:14:59Z' }, // 14m59s later
    ];
    const result = groupMessagesIntoConversations(rows);
    expect(result).toHaveLength(1);
    expect(result[0].messages).toHaveLength(2);
  });

  it('splits messages more than 15 minutes apart into separate conversations', () => {
    const rows = [
      { id: 1, channel_id: 'ch1', created_at: '2024-01-01T10:00:00Z' },
      { id: 2, channel_id: 'ch1', created_at: '2024-01-01T10:16:00Z' }, // 16 min later
    ];
    const result = groupMessagesIntoConversations(rows);
    expect(result).toHaveLength(2);
  });

  it('keeps exactly 15 minutes gap in the same conversation (> not >=)', () => {
    const rows = [
      { id: 1, channel_id: 'ch1', created_at: '2024-01-01T10:00:00Z' },
      { id: 2, channel_id: 'ch1', created_at: '2024-01-01T10:15:00Z' }, // exactly 15 min
    ];
    const result = groupMessagesIntoConversations(rows);
    // The condition is > gapMs (strictly greater), so exactly 15 min stays together.
    expect(result).toHaveLength(1);
    expect(result[0].messages).toHaveLength(2);
  });

  it('separates messages from different channels even if within 15 minutes', () => {
    const rows = [
      { id: 1, channel_id: 'ch1', created_at: '2024-01-01T10:00:00Z' },
      { id: 2, channel_id: 'ch2', created_at: '2024-01-01T10:01:00Z' },
    ];
    const result = groupMessagesIntoConversations(rows);
    // Each channel starts its own conversation
    expect(result).toHaveLength(2);
    const ch1 = result.find((c) => c.channelId === 'ch1');
    const ch2 = result.find((c) => c.channelId === 'ch2');
    expect(ch1).toBeDefined();
    expect(ch2).toBeDefined();
  });

  it('sorts conversations by most recent activity (descending lastTime)', () => {
    const rows = [
      { id: 1, channel_id: 'ch1', created_at: '2024-01-01T09:00:00Z' },
      { id: 2, channel_id: 'ch2', created_at: '2024-01-01T11:00:00Z' },
    ];
    const result = groupMessagesIntoConversations(rows);
    expect(result[0].channelId).toBe('ch2'); // more recent
    expect(result[1].channelId).toBe('ch1');
  });

  it('uses first message id as conversation id', () => {
    const rows = [
      { id: 10, channel_id: 'ch1', created_at: '2024-01-01T10:00:00Z' },
      { id: 20, channel_id: 'ch1', created_at: '2024-01-01T10:05:00Z' },
    ];
    const result = groupMessagesIntoConversations(rows);
    expect(result[0].id).toBe(10);
  });

  it('tracks firstTime and lastTime correctly', () => {
    const first = '2024-01-01T10:00:00Z';
    const last = '2024-01-01T10:10:00Z';
    const rows = [
      { id: 1, channel_id: 'ch1', created_at: first },
      { id: 2, channel_id: 'ch1', created_at: last },
    ];
    const result = groupMessagesIntoConversations(rows);
    expect(result[0].firstTime).toBe(new Date(first).getTime());
    expect(result[0].lastTime).toBe(new Date(last).getTime());
  });

  it('handles multiple channels with multiple conversations each', () => {
    const rows = [
      { id: 1, channel_id: 'ch1', created_at: '2024-01-01T08:00:00Z' },
      { id: 2, channel_id: 'ch1', created_at: '2024-01-01T09:00:00Z' }, // new convo (60 min gap)
      { id: 3, channel_id: 'ch2', created_at: '2024-01-01T10:00:00Z' },
    ];
    const result = groupMessagesIntoConversations(rows);
    expect(result).toHaveLength(3);
  });
});

// ─── findConversationMessage ──────────────────────────────────────────────────

describe('findConversationMessage', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = { query: vi.fn() };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns the first row when found', async () => {
    const row = { id: 42, channel_id: 'ch1', created_at: '2024-01-01T10:00:00Z' };
    mockPool.query.mockResolvedValue({ rows: [row] });

    const result = await findConversationMessage(mockPool, { guildId: 'g1', messageId: '42' });
    expect(result).toEqual(row);
  });

  it('returns null when no rows found', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const result = await findConversationMessage(mockPool, { guildId: 'g1', messageId: '999' });
    expect(result).toBeNull();
  });

  it('passes messageId as first and guildId as second parameter', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await findConversationMessage(mockPool, { guildId: 'guild1', messageId: 'msg123' });
    expect(mockPool.query.mock.calls[0][1]).toEqual(['msg123', 'guild1']);
  });
});

// ─── fetchFlagStatusesForMessages ─────────────────────────────────────────────

describe('fetchFlagStatusesForMessages', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = { query: vi.fn() };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty Map when no flags found', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const result = await fetchFlagStatusesForMessages(mockPool, {
      guildId: 'g1',
      messageIds: [1, 2],
    });
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('maps message_id to most recent status', async () => {
    mockPool.query.mockResolvedValue({
      rows: [
        { message_id: 1, status: 'open' },
        { message_id: 2, status: 'resolved' },
      ],
    });

    const result = await fetchFlagStatusesForMessages(mockPool, {
      guildId: 'g1',
      messageIds: [1, 2],
    });
    expect(result.get(1)).toBe('open');
    expect(result.get(2)).toBe('resolved');
  });

  it('uses first occurrence (most recent) when message_id appears multiple times', async () => {
    // rows are ordered by created_at DESC from DB, so first row = most recent
    mockPool.query.mockResolvedValue({
      rows: [
        { message_id: 5, status: 'resolved' }, // most recent
        { message_id: 5, status: 'open' }, // older
      ],
    });

    const result = await fetchFlagStatusesForMessages(mockPool, { guildId: 'g1', messageIds: [5] });
    expect(result.get(5)).toBe('resolved');
  });

  it('passes guildId and messageIds as query parameters', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const messageIds = [1, 2, 3];

    await fetchFlagStatusesForMessages(mockPool, { guildId: 'guild99', messageIds });
    expect(mockPool.query.mock.calls[0][1]).toEqual(['guild99', messageIds]);
  });

  it('uses id as a deterministic tie-breaker for equally recent flags', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await fetchFlagStatusesForMessages(mockPool, { guildId: 'guild99', messageIds: [1] });

    expect(mockPool.query.mock.calls[0][0]).toContain('ORDER BY created_at DESC, id DESC');
  });
});

// ─── fetchFlagTargets ─────────────────────────────────────────────────────────

describe('fetchFlagTargets', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = { query: vi.fn() };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns both message and anchor when found', async () => {
    const msgRow = { id: 10, channel_id: 'ch1', created_at: '2024-01-01T10:00:00Z' };
    const anchorRow = { id: 1, channel_id: 'ch1', created_at: '2024-01-01T09:00:00Z' };
    // findConversationMessage queries are run in parallel, both return results
    mockPool.query
      .mockResolvedValueOnce({ rows: [msgRow] })
      .mockResolvedValueOnce({ rows: [anchorRow] });

    const result = await fetchFlagTargets(mockPool, {
      guildId: 'g1',
      messageId: '10',
      conversationId: '1',
    });
    expect(result.message).toEqual(msgRow);
    expect(result.anchor).toEqual(anchorRow);
  });

  it('returns null message when not found', async () => {
    const anchorRow = { id: 1, channel_id: 'ch1', created_at: '2024-01-01T09:00:00Z' };
    mockPool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [anchorRow] });

    const result = await fetchFlagTargets(mockPool, {
      guildId: 'g1',
      messageId: '999',
      conversationId: '1',
    });
    expect(result.message).toBeNull();
    expect(result.anchor).toEqual(anchorRow);
  });

  it('returns null anchor when conversation not found', async () => {
    const msgRow = { id: 10, channel_id: 'ch1', created_at: '2024-01-01T10:00:00Z' };
    mockPool.query.mockResolvedValueOnce({ rows: [msgRow] }).mockResolvedValueOnce({ rows: [] });

    const result = await fetchFlagTargets(mockPool, {
      guildId: 'g1',
      messageId: '10',
      conversationId: '999',
    });
    expect(result.message).toEqual(msgRow);
    expect(result.anchor).toBeNull();
  });

  it('makes two queries in parallel (both find no results)', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await fetchFlagTargets(mockPool, { guildId: 'g1', messageId: '1', conversationId: '2' });
    expect(mockPool.query).toHaveBeenCalledTimes(2);
  });
});

// ─── insertFlaggedMessage ─────────────────────────────────────────────────────

describe('insertFlaggedMessage', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = { query: vi.fn() };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('inserts and returns the id and status', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ id: 77, status: 'open' }] });

    const result = await insertFlaggedMessage(mockPool, {
      guildId: 'g1',
      conversationId: 'c1',
      messageId: 'm1',
      flaggedBy: 'user1',
      reason: 'spam',
      notes: 'extra info',
    });
    expect(result).toEqual({ id: 77, status: 'open' });
  });

  it('trims whitespace from reason', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ id: 1, status: 'open' }] });

    await insertFlaggedMessage(mockPool, {
      guildId: 'g1',
      conversationId: 'c1',
      messageId: 'm1',
      flaggedBy: 'user1',
      reason: '  spam   ',
      notes: null,
    });

    const params = mockPool.query.mock.calls[0][1];
    expect(params[4]).toBe('spam');
  });

  it('trims whitespace from notes', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ id: 1, status: 'open' }] });

    await insertFlaggedMessage(mockPool, {
      guildId: 'g1',
      conversationId: 'c1',
      messageId: 'm1',
      flaggedBy: 'user1',
      reason: 'reason',
      notes: '  extra  ',
    });

    const params = mockPool.query.mock.calls[0][1];
    expect(params[5]).toBe('extra');
  });

  it('stores null when notes is not provided', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ id: 1, status: 'open' }] });

    await insertFlaggedMessage(mockPool, {
      guildId: 'g1',
      conversationId: 'c1',
      messageId: 'm1',
      flaggedBy: 'user1',
      reason: 'reason',
      notes: undefined,
    });

    const params = mockPool.query.mock.calls[0][1];
    expect(params[5]).toBeNull();
  });

  it('stores null when notes is empty string after trim', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ id: 1, status: 'open' }] });

    await insertFlaggedMessage(mockPool, {
      guildId: 'g1',
      conversationId: 'c1',
      messageId: 'm1',
      flaggedBy: 'user1',
      reason: 'reason',
      notes: '   ',
    });

    const params = mockPool.query.mock.calls[0][1];
    expect(params[5]).toBeNull();
  });
});

// ─── listFlaggedMessages ──────────────────────────────────────────────────────

describe('listFlaggedMessages', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = { query: vi.fn() };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns flags and total count', async () => {
    const flagRow = {
      id: 1,
      guild_id: 'g1',
      conversation_first_id: 100,
      message_id: 200,
      flagged_by: 'user1',
      reason: 'bad content',
      notes: null,
      status: 'open',
      resolved_by: null,
      resolved_at: null,
      created_at: '2024-01-01T10:00:00Z',
      message_content: 'Hello',
      message_role: 'user',
      message_username: 'alice',
    };
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ count: 1 }] }) // count query
      .mockResolvedValueOnce({ rows: [flagRow] }); // flags query

    const result = await listFlaggedMessages(mockPool, {
      guildId: 'g1',
      status: undefined,
      limit: 10,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0]).toMatchObject({
      id: 1,
      guildId: 'g1',
      conversationFirstId: 100,
      messageId: 200,
      flaggedBy: 'user1',
      reason: 'bad content',
      status: 'open',
      messageContent: 'Hello',
      messageRole: 'user',
      messageUsername: 'alice',
    });
  });

  it('adds status filter when valid status provided', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    await listFlaggedMessages(mockPool, {
      guildId: 'g1',
      status: 'resolved',
      limit: 10,
      offset: 0,
    });

    const countCall = mockPool.query.mock.calls[0];
    expect(countCall[0]).toContain('fm.status =');
    expect(countCall[1]).toContain('resolved');
  });

  it('does not add status filter for invalid status value', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    await listFlaggedMessages(mockPool, {
      guildId: 'g1',
      status: 'invalid-status',
      limit: 10,
      offset: 0,
    });

    const countCall = mockPool.query.mock.calls[0];
    expect(countCall[0]).not.toContain('fm.status =');
  });

  it('returns total 0 when count query returns no rows', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    const result = await listFlaggedMessages(mockPool, {
      guildId: 'g1',
      status: undefined,
      limit: 10,
      offset: 0,
    });

    expect(result.total).toBe(0);
    expect(result.flags).toEqual([]);
  });

  it('accepts "dismissed" as a valid status', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    await listFlaggedMessages(mockPool, {
      guildId: 'g1',
      status: 'dismissed',
      limit: 10,
      offset: 0,
    });

    const countCall = mockPool.query.mock.calls[0];
    expect(countCall[1]).toContain('dismissed');
  });
});

// ─── fetchConversationStats ───────────────────────────────────────────────────

describe('fetchConversationStats', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = { query: vi.fn() };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns zero stats when all queries return empty rows', async () => {
    // 5 queries: total, topUsers, daily, token, convoCount
    mockPool.query.mockResolvedValue({ rows: [] });

    const result = await fetchConversationStats(mockPool, 'g1');
    expect(result.totalConversations).toBe(0);
    expect(result.totalMessages).toBe(0);
    expect(result.avgMessagesPerConversation).toBe(0);
    expect(result.topUsers).toEqual([]);
    expect(result.dailyActivity).toEqual([]);
    expect(result.estimatedTokens).toBe(0);
  });

  it('calculates estimatedTokens from total_chars', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('total_chars')) {
        return Promise.resolve({ rows: [{ total_chars: 400 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await fetchConversationStats(mockPool, 'g1');
    expect(result.estimatedTokens).toBe(100); // 400 / 4 = 100
  });

  it('calculates avgMessagesPerConversation correctly', async () => {
    mockPool.query.mockImplementation((sql) => {
      // Parallel queries: total, topUsers, daily, token (first 4 calls)
      // Sequential: convoCount (5th call)
      if (sql.includes('total_messages') && sql.includes('COUNT(*)::int')) {
        return Promise.resolve({ rows: [{ total_messages: 30 }] });
      }
      if (sql.includes('total_conversations')) {
        return Promise.resolve({ rows: [{ total_conversations: 5 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await fetchConversationStats(mockPool, 'g1');
    expect(result.avgMessagesPerConversation).toBe(6); // 30 / 5 = 6
  });

  it('returns 0 avgMessagesPerConversation when no conversations', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('total_messages')) {
        return Promise.resolve({ rows: [{ total_messages: 50 }] });
      }
      return Promise.resolve({ rows: [{ total_conversations: 0 }] });
    });

    const result = await fetchConversationStats(mockPool, 'g1');
    expect(result.avgMessagesPerConversation).toBe(0);
  });

  it('maps topUsers with username and messageCount', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (
        sql.includes('username') &&
        sql.includes('message_count') &&
        sql.includes('GROUP BY username')
      ) {
        return Promise.resolve({
          rows: [
            { username: 'alice', message_count: 50 },
            { username: 'bob', message_count: 30 },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await fetchConversationStats(mockPool, 'g1');
    expect(result.topUsers).toEqual([
      { username: 'alice', messageCount: 50 },
      { username: 'bob', messageCount: 30 },
    ]);
  });

  it('maps dailyActivity with date and count', async () => {
    mockPool.query.mockImplementation((sql) => {
      if (sql.includes('DATE(created_at)')) {
        return Promise.resolve({
          rows: [
            { date: '2024-03-01', count: 10 },
            { date: '2024-03-02', count: 20 },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await fetchConversationStats(mockPool, 'g1');
    expect(result.dailyActivity).toEqual([
      { date: '2024-03-01', count: 10 },
      { date: '2024-03-02', count: 20 },
    ]);
  });

  it('bounds dailyActivity to the recent 30 calendar days with a parameterized date', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const before = Date.now();
    await fetchConversationStats(mockPool, 'g1');
    const after = Date.now();

    const dailyCall = mockPool.query.mock.calls.find(([sql]) => sql.includes('DATE(created_at)'));
    expect(dailyCall[0]).toContain('created_at >= $2::date');
    expect(dailyCall[0]).not.toContain("CURRENT_DATE - INTERVAL '30 days'");
    expect(dailyCall[1][0]).toBe('g1');

    const lowerBound = new Date(`${dailyCall[1][1]}T00:00:00.000Z`).getTime();
    expect(lowerBound).toBeGreaterThanOrEqual(
      new Date(before - 29 * 24 * 60 * 60 * 1000).setUTCHours(0, 0, 0, 0),
    );
    expect(lowerBound).toBeLessThanOrEqual(
      new Date(after - 29 * 24 * 60 * 60 * 1000).setUTCHours(0, 0, 0, 0),
    );
  });
});

// ─── fetchConversationWindowMessages ─────────────────────────────────────────

describe('fetchConversationWindowMessages', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = { query: vi.fn() };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('passes guildId, channelId, anchorId and gap seconds as parameters', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await fetchConversationWindowMessages(mockPool, {
      guildId: 'g1',
      channelId: 'ch1',
      anchorId: 42,
    });

    const params = mockPool.query.mock.calls[0][1];
    expect(params).toEqual([
      'g1',
      'ch1',
      42,
      CONVERSATION_GAP_MINUTES * 60,
      MAX_CONVERSATION_DETAIL_MESSAGES + 1,
    ]);
  });

  it('uses gap-bounded directional recursion with an explicit oversized-response sentinel cap', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await fetchConversationWindowMessages(mockPool, {
      guildId: 'g1',
      channelId: 'ch1',
      anchorId: 42,
    });

    const sql = mockPool.query.mock.calls[0][0];
    const params = mockPool.query.mock.calls[0][1];
    expect(sql).toContain('WITH RECURSIVE anchor');
    expect(sql).toContain('JOIN LATERAL');
    expect(sql).toContain('ORDER BY created_at DESC, id DESC');
    expect(sql).toContain('ORDER BY created_at ASC, id ASC');
    expect(sql).toContain('current_message.depth < $5');
    expect(sql).toContain('LIMIT $5');
    expect(params).toEqual([
      'g1',
      'ch1',
      42,
      CONVERSATION_GAP_MINUTES * 60,
      MAX_CONVERSATION_DETAIL_MESSAGES + 1,
    ]);
  });

  it('returns the message rows from the query', async () => {
    const rows = [
      {
        id: 1,
        channel_id: 'ch1',
        role: 'user',
        content: 'Hello',
        created_at: '2024-01-01T10:00:00Z',
      },
    ];
    mockPool.query.mockResolvedValue({ rows });

    const result = await fetchConversationWindowMessages(mockPool, {
      guildId: 'g1',
      channelId: 'ch1',
      anchorId: 1,
    });
    expect(result).toEqual(rows);
  });
});

// ─── isMessageInConversationSegment ──────────────────────────────────────────

describe('isMessageInConversationSegment', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = { query: vi.fn() };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns belongs true when the directional membership query finds the target', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ belongs: true, limit_exceeded: false }] });

    const result = await isMessageInConversationSegment(mockPool, {
      guildId: 'g1',
      channelId: 'ch1',
      anchorId: 1,
      messageId: 501,
    });

    expect(result).toEqual({ belongs: true, limitExceeded: false });
  });

  it('returns belongs true for same-anchor validation', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ belongs: true, limit_exceeded: false }] });

    const result = await isMessageInConversationSegment(mockPool, {
      guildId: 'g1',
      channelId: 'ch1',
      anchorId: 1,
      messageId: 1,
    });

    expect(result).toEqual({ belongs: true, limitExceeded: false });
  });

  it('returns belongs false when the target is outside the gap-bounded segment', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ belongs: false, limit_exceeded: false }] });

    const result = await isMessageInConversationSegment(mockPool, {
      guildId: 'g1',
      channelId: 'ch1',
      anchorId: 1,
      messageId: 9,
    });

    expect(result).toEqual({ belongs: false, limitExceeded: false });
  });

  it('returns limitExceeded when validation reaches the hop cutoff', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ belongs: false, limit_exceeded: true }] });

    const result = await isMessageInConversationSegment(mockPool, {
      guildId: 'g1',
      channelId: 'ch1',
      anchorId: 1,
      messageId: 2005,
    });

    expect(result).toEqual({ belongs: false, limitExceeded: true });
  });

  it('uses only minimal fields and gap-bounded directional recursion', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ belongs: false, limit_exceeded: false }] });

    await isMessageInConversationSegment(mockPool, {
      guildId: 'g1',
      channelId: 'ch1',
      anchorId: 1,
      messageId: 501,
    });

    const sql = mockPool.query.mock.calls[0][0];
    const params = mockPool.query.mock.calls[0][1];
    expect(sql).toContain('WITH RECURSIVE endpoints');
    expect(sql).toContain('JOIN LATERAL');
    expect(sql).toContain('target_created_at');
    expect(sql).toContain('EXTRACT(EPOCH');
    expect(sql).toContain('walk.hops <= $6');
    expect(sql).toContain('BOOL_OR(hops > $6)');
    expect(sql).not.toContain('content');
    expect(sql).not.toContain(' OVER ');
    expect(sql).not.toContain('LIMIT 500');
    expect(params).toEqual([
      'g1',
      'ch1',
      1,
      501,
      CONVERSATION_GAP_MINUTES * 60,
      MAX_CONVERSATION_MEMBERSHIP_HOPS,
    ]);
  });
});

// ─── listConversationSummaries ────────────────────────────────────────────────

describe('listConversationSummaries', () => {
  let mockPool;

  beforeEach(() => {
    mockPool = { query: vi.fn() };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns rows and total from query result', async () => {
    const row = {
      id: 1,
      channel_id: 'ch1',
      first_msg_time: '2024-01-01T09:00:00Z',
      last_msg_time: '2024-01-01T10:00:00Z',
      message_count: 5,
      preview_content: 'Hello',
      participant_pairs: ['alice:::user:::u1'],
      total_conversations: 3,
    };
    mockPool.query.mockResolvedValue({ rows: [row] });

    const result = await listConversationSummaries(mockPool, {
      guildId: 'g1',
      query: {},
      limit: 10,
      offset: 0,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.total).toBe(3);
  });

  it('returns total 0 when no rows returned', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const result = await listConversationSummaries(mockPool, {
      guildId: 'g1',
      query: {},
      limit: 10,
      offset: 0,
    });

    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('preserves total when the requested page is beyond the last conversation', async () => {
    mockPool.query.mockResolvedValue({
      rows: [
        {
          id: null,
          channel_id: null,
          first_msg_time: null,
          last_msg_time: null,
          message_count: null,
          preview_content: null,
          participant_pairs: null,
          total_conversations: 3,
        },
      ],
    });

    const result = await listConversationSummaries(mockPool, {
      guildId: 'g1',
      query: {},
      limit: 10,
      offset: 30,
    });

    expect(result.rows).toEqual([]);
    expect(result.total).toBe(3);
  });

  it('supports omitted optional query filters', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await expect(
      listConversationSummaries(mockPool, {
        guildId: 'g1',
        limit: 10,
        offset: 0,
      }),
    ).resolves.toEqual({ rows: [], total: 0 });
  });

  it('uses documented default limit and offset when omitted', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await listConversationSummaries(mockPool, { guildId: 'g1' });

    const params = mockPool.query.mock.calls[0][1];
    expect(params.at(-2)).toBe(50);
    expect(params.at(-1)).toBe(0);
  });

  it('includes search filter in WHERE clause when query.search is provided', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await listConversationSummaries(mockPool, {
      guildId: 'g1',
      query: { search: 'hello' },
      limit: 10,
      offset: 0,
    });

    const sql = mockPool.query.mock.calls[0][0];
    expect(sql).toContain('ILIKE');
    const params = mockPool.query.mock.calls[0][1];
    expect(params.some((p) => typeof p === 'string' && p.includes('hello'))).toBe(true);
  });

  it('includes username filter when query.user is provided', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await listConversationSummaries(mockPool, {
      guildId: 'g1',
      query: { user: 'alice' },
      limit: 10,
      offset: 0,
    });

    const sql = mockPool.query.mock.calls[0][0];
    expect(sql).toContain('username =');
    const params = mockPool.query.mock.calls[0][1];
    expect(params).toContain('alice');
  });

  it('includes channel filter when query.channel is provided', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await listConversationSummaries(mockPool, {
      guildId: 'g1',
      query: { channel: 'ch99' },
      limit: 10,
      offset: 0,
    });

    const sql = mockPool.query.mock.calls[0][0];
    expect(sql).toContain('channel_id =');
    const params = mockPool.query.mock.calls[0][1];
    expect(params).toContain('ch99');
  });

  it('applies default 30-day lower bound when no from is provided', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const before = Date.now();
    await listConversationSummaries(mockPool, {
      guildId: 'g1',
      query: {},
      limit: 10,
      offset: 0,
    });
    const after = Date.now();

    const params = mockPool.query.mock.calls[0][1];
    // Find the ISO date string that looks like a 30-day ago cutoff
    const dateParam = params.find((p) => typeof p === 'string' && p.includes('T'));
    expect(dateParam).toBeDefined();
    const paramDate = new Date(dateParam).getTime();
    expect(paramDate).toBeGreaterThanOrEqual(before - 30 * 24 * 60 * 60 * 1000 - 1000);
    expect(paramDate).toBeLessThanOrEqual(after - 30 * 24 * 60 * 60 * 1000 + 1000);
  });

  it('treats date-only "to" as exclusive (next day)', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await listConversationSummaries(mockPool, {
      guildId: 'g1',
      query: { from: '2024-03-01', to: '2024-03-07' },
      limit: 10,
      offset: 0,
    });

    const sql = mockPool.query.mock.calls[0][0];
    expect(sql).toContain('created_at <');
    const params = mockPool.query.mock.calls[0][1];
    // The exclusive upper bound should be 2024-03-08T00:00:00.000Z
    expect(params).toContain('2024-03-08T00:00:00.000Z');
  });

  it('trims date-only "to" filters before detecting full-day bounds', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await listConversationSummaries(mockPool, {
      guildId: 'g1',
      query: { from: '2024-03-01', to: '2024-03-07 ' },
      limit: 10,
      offset: 0,
    });

    const sql = mockPool.query.mock.calls[0][0];
    const params = mockPool.query.mock.calls[0][1];
    expect(sql).toContain('created_at <');
    expect(sql).not.toContain('created_at <=');
    expect(params).toContain('2024-03-08T00:00:00.000Z');
  });

  it('uses inclusive upper bound (<=) for ISO datetime "to"', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await listConversationSummaries(mockPool, {
      guildId: 'g1',
      query: { from: '2024-03-01T00:00:00Z', to: '2024-03-07T23:59:59Z' },
      limit: 10,
      offset: 0,
    });

    const sql = mockPool.query.mock.calls[0][0];
    expect(sql).toContain('created_at <=');
  });

  it('passes guildId as first query parameter', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await listConversationSummaries(mockPool, {
      guildId: 'myGuild',
      query: {},
      limit: 5,
      offset: 10,
    });

    const params = mockPool.query.mock.calls[0][1];
    expect(params[0]).toBe('myGuild');
  });
});
