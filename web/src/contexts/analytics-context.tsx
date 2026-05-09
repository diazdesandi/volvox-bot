'use client';

import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useGuildSelection } from '@/hooks/use-guild-selection';
import {
  DASHBOARD_ANALYTICS_EXPORTED_EVENT,
  DASHBOARD_ANALYTICS_FILTER_CHANGED_EVENT,
  DASHBOARD_ANALYTICS_REFRESH_FAILED_EVENT,
  DASHBOARD_ANALYTICS_REFRESHED_EVENT,
  trackDashboardEvent,
} from '@/lib/amplitude';
import { exportAnalyticsPdf } from '@/lib/analytics-pdf';
import { endOfDayIso, formatDateInput, startOfDayIso } from '@/lib/analytics-utils';
import type { AnalyticsRangePreset, DashboardAnalytics } from '@/types/analytics';
import { isDashboardAnalyticsPayload } from '@/types/analytics-validators';

function escapeCsvCell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toDeltaPercent(current: number, previous: number): number | null {
  if (previous === 0) {
    return current === 0 ? 0 : null;
  }
  return ((current - previous) / previous) * 100;
}

function getAnalyticsTelemetryProperties(
  range: AnalyticsRangePreset,
  compareMode: boolean,
  channelFilter: string | null,
) {
  return {
    channelFiltered: Boolean(channelFilter),
    compareMode,
    range,
  };
}

function getAnalyticsRefreshFailureReason(error: unknown): 'invalid_payload' | 'request_failed' {
  return error instanceof Error && error.message === 'Invalid analytics payload from server'
    ? 'invalid_payload'
    : 'request_failed';
}

interface AnalyticsContextType {
  analytics: DashboardAnalytics | null;
  loading: boolean;
  error: string | null;
  rangePreset: AnalyticsRangePreset;
  setRangePreset: (preset: AnalyticsRangePreset) => void;
  customFromApplied: string;
  customToApplied: string;
  setCustomRange: (from: string, to: string) => void;
  compareMode: boolean;
  setCompareMode: React.Dispatch<React.SetStateAction<boolean>>;
  channelFilter: string | null;
  setChannelFilter: React.Dispatch<React.SetStateAction<string | null>>;
  lastUpdatedAt: Date | null;
  refresh: (background?: boolean) => Promise<void>;
  exportCsv: () => void;
  exportPdf: () => void;
}

const AnalyticsContext = createContext<AnalyticsContextType | null>(null);

export function useAnalytics() {
  const context = useContext(AnalyticsContext);
  if (!context) {
    // Return a dummy context or throw error. For safety, let's throw if outside provider.
    throw new Error('useAnalytics must be used within an AnalyticsProvider');
  }
  return context;
}

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const [now] = useState(() => new Date());
  const [rangePreset, setRawRangePreset] = useState<AnalyticsRangePreset>('week');
  const [customFromApplied, setCustomFromApplied] = useState<string>(
    formatDateInput(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)),
  );
  const [customToApplied, setCustomToApplied] = useState<string>(formatDateInput(now));
  const [compareMode, setRawCompareMode] = useState(false);
  const [channelFilter, setRawChannelFilter] = useState<string | null>(null);
  const rangePresetRef = useRef(rangePreset);
  const compareModeRef = useRef(compareMode);
  const channelFilterRef = useRef(channelFilter);
  const guildId = useGuildSelection({
    onGuildChange: () => {
      channelFilterRef.current = null;
      setRawChannelFilter(null);
    },
  });

  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const trackFilterChanged = useCallback(
    (
      filter: 'channel' | 'compare' | 'range',
      nextProperties: ReturnType<typeof getAnalyticsTelemetryProperties>,
    ) => {
      trackDashboardEvent(DASHBOARD_ANALYTICS_FILTER_CHANGED_EVENT, {
        filter,
        ...nextProperties,
      });
    },
    [],
  );

  useEffect(() => {
    rangePresetRef.current = rangePreset;
  }, [rangePreset]);

  useEffect(() => {
    compareModeRef.current = compareMode;
  }, [compareMode]);

  useEffect(() => {
    channelFilterRef.current = channelFilter;
  }, [channelFilter]);

  const setRangePreset = useCallback(
    (preset: AnalyticsRangePreset) => {
      const currentRangePreset = rangePresetRef.current;
      if (preset === currentRangePreset) {
        return;
      }

      rangePresetRef.current = preset;
      setRawRangePreset(preset);
      trackFilterChanged(
        'range',
        getAnalyticsTelemetryProperties(preset, compareModeRef.current, channelFilterRef.current),
      );
    },
    [trackFilterChanged],
  );

  const setCustomRange = useCallback(
    (from: string, to: string) => {
      if (rangePreset === 'custom' && from === customFromApplied && to === customToApplied) {
        return;
      }

      rangePresetRef.current = 'custom';
      setCustomFromApplied(from);
      setCustomToApplied(to);
      setRawRangePreset('custom');
      trackFilterChanged(
        'range',
        getAnalyticsTelemetryProperties('custom', compareModeRef.current, channelFilterRef.current),
      );
    },
    [customFromApplied, customToApplied, rangePreset, trackFilterChanged],
  );

  const setCompareMode = useCallback<React.Dispatch<React.SetStateAction<boolean>>>(
    (nextCompareMode) => {
      const currentCompareMode = compareModeRef.current;
      const resolvedCompareMode =
        typeof nextCompareMode === 'function'
          ? nextCompareMode(currentCompareMode)
          : nextCompareMode;

      if (resolvedCompareMode === currentCompareMode) {
        return;
      }

      compareModeRef.current = resolvedCompareMode;
      trackFilterChanged(
        'compare',
        getAnalyticsTelemetryProperties(
          rangePresetRef.current,
          resolvedCompareMode,
          channelFilterRef.current,
        ),
      );
      setRawCompareMode(resolvedCompareMode);
    },
    [trackFilterChanged],
  );

  const setChannelFilter = useCallback<React.Dispatch<React.SetStateAction<string | null>>>(
    (nextChannelFilter) => {
      const currentChannelFilter = channelFilterRef.current;
      const resolvedChannelFilter =
        typeof nextChannelFilter === 'function'
          ? nextChannelFilter(currentChannelFilter)
          : nextChannelFilter;

      if (resolvedChannelFilter === currentChannelFilter) {
        return;
      }

      channelFilterRef.current = resolvedChannelFilter;
      trackFilterChanged(
        'channel',
        getAnalyticsTelemetryProperties(
          rangePresetRef.current,
          compareModeRef.current,
          resolvedChannelFilter,
        ),
      );
      setRawChannelFilter(resolvedChannelFilter);
    },
    [trackFilterChanged],
  );

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('range', rangePreset);

    if (rangePreset === 'custom') {
      params.set('from', startOfDayIso(customFromApplied));
      params.set('to', endOfDayIso(customToApplied));
    }

    if (rangePreset !== 'custom') {
      params.set('interval', rangePreset === 'today' ? 'hour' : 'day');
    }

    if (channelFilter) {
      params.set('channelId', channelFilter);
    }

    if (compareMode) {
      params.set('compare', '1');
    }

    return params.toString();
  }, [channelFilter, compareMode, customFromApplied, customToApplied, rangePreset]);

  const refresh = useCallback(
    async (backgroundRefresh = false) => {
      if (!guildId) return;

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      if (!backgroundRefresh) setLoading(true);
      setError(null);

      try {
        const encodedGuildId = encodeURIComponent(guildId);
        const response = await fetch(`/api/guilds/${encodedGuildId}/analytics?${queryString}`, {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (response.status === 401) {
          trackDashboardEvent(DASHBOARD_ANALYTICS_REFRESH_FAILED_EVENT, {
            ...getAnalyticsTelemetryProperties(rangePreset, compareMode, channelFilter),
            backgroundRefresh,
            failureReason: 'unauthorized',
          });
          window.location.href = '/login';
          return;
        }

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || 'Failed to fetch analytics');
        }

        if (!isDashboardAnalyticsPayload(payload)) {
          throw new Error('Invalid analytics payload from server');
        }

        setAnalytics(payload);
        setLastUpdatedAt(new Date());
        trackDashboardEvent(DASHBOARD_ANALYTICS_REFRESHED_EVENT, {
          ...getAnalyticsTelemetryProperties(rangePreset, compareMode, channelFilter),
          backgroundRefresh,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Unknown error');
        trackDashboardEvent(DASHBOARD_ANALYTICS_REFRESH_FAILED_EVENT, {
          ...getAnalyticsTelemetryProperties(rangePreset, compareMode, channelFilter),
          backgroundRefresh,
          failureReason: getAnalyticsRefreshFailureReason(err),
        });
      } finally {
        if (abortControllerRef.current === controller) {
          setLoading(false);
        }
      }
    },
    [channelFilter, compareMode, guildId, queryString, rangePreset],
  );

  useEffect(() => {
    void refresh();
    return () => abortControllerRef.current?.abort();
  }, [refresh]);

  // Handle Export CSV (Moved from AnalyticsDashboard)
  const exportCsv = useCallback(() => {
    if (!analytics) return;

    const rows: string[] = [];
    rows.push('# Analytics export');
    rows.push(`# Generated at,${escapeCsvCell(new Date().toISOString())}`);
    rows.push(`# Guild ID,${escapeCsvCell(analytics.guildId)}`);
    rows.push(`# Range,${escapeCsvCell(analytics.range.type)}`);
    rows.push(`# From,${escapeCsvCell(analytics.range.from)}`);
    rows.push(`# To,${escapeCsvCell(analytics.range.to)}`);
    rows.push(`# Interval,${escapeCsvCell(analytics.range.interval)}`);
    rows.push(`# Channel filter,${escapeCsvCell(analytics.range.channelId ?? 'all')}`);
    rows.push(`# Compare mode,${escapeCsvCell(compareMode ? 'enabled' : 'disabled')}`);
    rows.push('');

    const kpiCards = [
      {
        label: 'Total messages',
        value: analytics.kpis.totalMessages,
        previous: analytics.comparison?.kpis.totalMessages,
      },
      {
        label: 'AI requests',
        value: analytics.kpis.aiRequests,
        previous: analytics.comparison?.kpis.aiRequests,
      },
      {
        label: 'AI cost (est.)',
        value: analytics.kpis.aiCostUsd,
        previous: analytics.comparison?.kpis.aiCostUsd,
      },
      {
        label: 'Active users',
        value: analytics.kpis.activeUsers,
        previous: analytics.comparison?.kpis.activeUsers,
      },
      {
        label: 'New members',
        value: analytics.kpis.newMembers,
        previous: analytics.comparison?.kpis.newMembers,
      },
    ];

    rows.push('KPI,Current,Previous,DeltaPercent');
    for (const card of kpiCards) {
      const current = card.value;
      const hasComparison = compareMode && analytics.comparison != null;
      const previous = hasComparison ? (card.previous ?? null) : null;
      const delta =
        current !== null && previous !== null ? toDeltaPercent(current, previous) : null;

      rows.push(
        [
          escapeCsvCell(card.label),
          escapeCsvCell(current),
          escapeCsvCell(previous),
          escapeCsvCell(delta === null ? null : Number(delta.toFixed(2))),
        ].join(','),
      );
    }

    rows.push('');
    rows.push('Top Channels');
    rows.push('Channel ID,Channel Name,Messages');
    const topChannels = analytics.topChannels ?? analytics.channelActivity ?? [];
    for (const channel of topChannels) {
      rows.push(
        [
          escapeCsvCell(channel.channelId),
          escapeCsvCell(channel.name),
          escapeCsvCell(channel.messages),
        ].join(','),
      );
    }

    rows.push('');
    rows.push('Command Usage');
    rows.push(`# Source,${escapeCsvCell(analytics.commandUsage?.source ?? 'unavailable')}`);
    rows.push('Command,Uses');
    for (const entry of analytics.commandUsage?.items ?? []) {
      rows.push([escapeCsvCell(entry.command), escapeCsvCell(entry.uses)].join(','));
    }

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `analytics-${analytics.guildId}-${analytics.range.type}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    trackDashboardEvent(DASHBOARD_ANALYTICS_EXPORTED_EVENT, {
      ...getAnalyticsTelemetryProperties(
        analytics.range.type,
        compareMode,
        analytics.range.channelId,
      ),
      format: 'csv',
    });
  }, [analytics, compareMode]);

  const exportPdf = useCallback(() => {
    if (!analytics) return;
    exportAnalyticsPdf(analytics);
    trackDashboardEvent(DASHBOARD_ANALYTICS_EXPORTED_EVENT, {
      ...getAnalyticsTelemetryProperties(
        analytics.range.type,
        compareMode,
        analytics.range.channelId,
      ),
      format: 'pdf',
    });
  }, [analytics, compareMode]);

  const value = useMemo(
    () => ({
      analytics,
      loading,
      error,
      rangePreset,
      setRangePreset,
      customFromApplied,
      customToApplied,
      setCustomRange,
      compareMode,
      setCompareMode,
      channelFilter,
      setChannelFilter,
      lastUpdatedAt,
      refresh,
      exportCsv,
      exportPdf,
    }),
    [
      analytics,
      loading,
      error,
      rangePreset,
      customFromApplied,
      customToApplied,
      setCustomRange,
      setRangePreset,
      compareMode,
      setCompareMode,
      channelFilter,
      setChannelFilter,
      lastUpdatedAt,
      refresh,
      exportCsv,
      exportPdf,
    ],
  );

  return <AnalyticsContext.Provider value={value}>{children}</AnalyticsContext.Provider>;
}
