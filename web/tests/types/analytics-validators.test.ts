import { describe, expect, it } from 'vitest';
import { isDashboardAnalyticsPayload } from '@/types/analytics-validators';
import type { DashboardAnalytics } from '@/types/analytics';

const basePayload = {
  guildId: 'guild-1',
  range: {
    type: 'week',
    from: '2026-02-01T00:00:00.000Z',
    to: '2026-02-07T23:59:59.999Z',
    interval: 'day',
    channelId: null,
  },
  kpis: {
    totalMessages: 10,
    aiRequests: 4,
    aiCostUsd: null,
    activeUsers: 3,
    newMembers: 2,
  },
  realtime: {
    onlineMembers: null,
    activeAiConversations: 0,
  },
  messageVolume: [],
  aiUsage: {
    source: 'unavailable',
    byModel: [],
    tokens: { prompt: null, completion: null },
  },
  channelActivity: [],
  commandUsage: { source: 'unavailable', items: [] },
  comparison: {
    previousRange: {
      from: '2026-01-25T00:00:00.000Z',
      to: '2026-01-31T23:59:59.999Z',
    },
    kpis: {
      totalMessages: 5,
      aiRequests: 0,
      aiCostUsd: null,
      activeUsers: 1,
      newMembers: 0,
    },
  },
  heatmap: [],
  userEngagement: null,
  xpEconomy: null,
} satisfies DashboardAnalytics;

describe('isDashboardAnalyticsPayload', () => {
  it('accepts null AI cost KPI values for current and comparison ranges', () => {
    expect(isDashboardAnalyticsPayload(basePayload)).toBe(true);
  });

  it('accepts full user engagement and recent events data', () => {
    expect(
      isDashboardAnalyticsPayload({
        ...basePayload,
        userEngagement: {
          trackedUsers: 5,
          avgMessagesPerUser: 2.5,
          aiResponseRate: 40,
          peakHour: 14,
        },
        recentEvents: [
          { id: '1', text: 'Event 1', timestamp: '2026-02-01T12:00:00Z' },
        ],
      }),
    ).toBe(true);
  });

  it('accepts recentEvents as undefined (optional field)', () => {
    const payload = { ...basePayload, recentEvents: undefined };
    expect(isDashboardAnalyticsPayload(payload)).toBe(true);
  });

  it('accepts an empty recentEvents array', () => {
    expect(
      isDashboardAnalyticsPayload({ ...basePayload, recentEvents: [] }),
    ).toBe(true);
  });

  it('rejects recentEvents entries missing the id field', () => {
    expect(
      isDashboardAnalyticsPayload({
        ...basePayload,
        recentEvents: [{ text: 'hello', timestamp: '2026-01-01T00:00:00Z' }],
      }),
    ).toBe(false);
  });

  it('rejects recentEvents entries with a non-string text field', () => {
    expect(
      isDashboardAnalyticsPayload({
        ...basePayload,
        recentEvents: [{ id: '1', text: 42, timestamp: '2026-01-01T00:00:00Z' }],
      }),
    ).toBe(false);
  });

  it('rejects recentEvents entries with a missing timestamp', () => {
    expect(
      isDashboardAnalyticsPayload({
        ...basePayload,
        recentEvents: [{ id: '1', text: 'hello' }],
      }),
    ).toBe(false);
  });

  it('rejects userEngagement missing aiResponseRate', () => {
    expect(
      isDashboardAnalyticsPayload({
        ...basePayload,
        userEngagement: {
          trackedUsers: 5,
          avgMessagesPerUser: 2.5,
          peakHour: 14,
          // aiResponseRate is missing
        },
      }),
    ).toBe(false);
  });

  it('rejects userEngagement where aiResponseRate is not a number', () => {
    expect(
      isDashboardAnalyticsPayload({
        ...basePayload,
        userEngagement: {
          trackedUsers: 5,
          avgMessagesPerUser: 2.5,
          aiResponseRate: 'high',
          peakHour: 14,
        },
      }),
    ).toBe(false);
  });

  it('accepts userEngagement with peakHour=null', () => {
    expect(
      isDashboardAnalyticsPayload({
        ...basePayload,
        userEngagement: {
          trackedUsers: 5,
          avgMessagesPerUser: 2.5,
          aiResponseRate: 33.3,
          peakHour: null,
        },
      }),
    ).toBe(true);
  });

  it('rejects userEngagement where peakHour is a string', () => {
    expect(
      isDashboardAnalyticsPayload({
        ...basePayload,
        userEngagement: {
          trackedUsers: 5,
          avgMessagesPerUser: 2.5,
          aiResponseRate: 33.3,
          peakHour: '14',
        },
      }),
    ).toBe(false);
  });

  it('rejects unavailable AI cost values that are omitted or non-numeric', () => {
    expect(
      isDashboardAnalyticsPayload({
        ...basePayload,
        kpis: { ...basePayload.kpis, aiCostUsd: undefined },
      }),
    ).toBe(false);

    expect(
      isDashboardAnalyticsPayload({
        ...basePayload,
        comparison: {
          ...basePayload.comparison,
          kpis: { ...basePayload.comparison.kpis, aiCostUsd: 'unavailable' },
        },
      }),
    ).toBe(false);
  });
});
