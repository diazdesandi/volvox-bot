'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { normalizeGuildMemberCount } from '@/lib/workspace-access';
import type { GuildCommunityConfig, MutualGuild } from '@/types/discord';

interface GuildDirectoryContextValue {
  error: boolean;
  guilds: MutualGuild[];
  loading: boolean;
  refreshGuilds: () => Promise<void>;
}

const GuildDirectoryContext = createContext<GuildDirectoryContextValue | null>(null);

const VALID_ACCESS_LEVELS = new Set(['owner', 'admin', 'moderator', 'viewer']);

type ParsedMutualGuild = MutualGuild;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseGuildConfig(value: unknown): GuildCommunityConfig | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const config: GuildCommunityConfig = {};
  const { communityHubs } = value;
  if (isRecord(communityHubs) && typeof communityHubs.enabled === 'boolean') {
    config.communityHubs = { enabled: communityHubs.enabled };
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

function parseMutualGuild(value: unknown): ParsedMutualGuild | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id, name, botPresent } = value;
  if (typeof id !== 'string' || typeof name !== 'string' || typeof botPresent !== 'boolean') {
    return null;
  }

  const guild: ParsedMutualGuild = {
    id,
    name,
    botPresent,
    botPresenceAuthoritative:
      typeof value.botPresenceAuthoritative === 'boolean'
        ? value.botPresenceAuthoritative
        : undefined,
    icon: typeof value.icon === 'string' || value.icon === null ? value.icon : null,
    iconHash: typeof value.iconHash === 'string' || value.iconHash === null ? value.iconHash : null,
    memberCount: normalizeGuildMemberCount(value),
    owner: typeof value.owner === 'boolean' ? value.owner : false,
    permissions: typeof value.permissions === 'string' ? value.permissions : '0',
    features: Array.isArray(value.features)
      ? value.features.filter((feature): feature is string => typeof feature === 'string')
      : [],
  };

  if (typeof value.access === 'string' && VALID_ACCESS_LEVELS.has(value.access)) {
    guild.access = value.access as MutualGuild['access'];
  }

  const config = parseGuildConfig(value.config);
  if (config) {
    guild.config = config;
  }

  return guild;
}

function parseMutualGuilds(data: unknown): MutualGuild[] {
  if (!Array.isArray(data)) {
    throw new TypeError('Invalid guild response');
  }

  return data.flatMap((entry) => {
    const guild = parseMutualGuild(entry);
    return guild ? [guild] : [];
  });
}

export function GuildDirectoryProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [guilds, setGuilds] = useState<MutualGuild[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const refreshGuilds = useCallback(async () => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(false);

    try {
      const response = await fetch('/api/guilds', { signal: controller.signal });
      if (response.status === 401) {
        globalThis.location.href = '/login';
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to fetch guilds');
      }

      const data: unknown = await response.json();
      setGuilds(parseMutualGuilds(data));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      setError(true);
    } finally {
      if (abortControllerRef.current === controller) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    refreshGuilds();
    return () => abortControllerRef.current?.abort();
  }, [refreshGuilds]);

  const value = useMemo(
    () => ({
      error,
      guilds,
      loading,
      refreshGuilds,
    }),
    [error, guilds, loading, refreshGuilds],
  );

  return <GuildDirectoryContext.Provider value={value}>{children}</GuildDirectoryContext.Provider>;
}

export function useGuildDirectory() {
  const context = useContext(GuildDirectoryContext);
  if (!context) {
    throw new Error('useGuildDirectory must be used within GuildDirectoryProvider');
  }
  return context;
}
