import { renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { GUILD_SELECTED_EVENT, SELECTED_GUILD_KEY } from '@/lib/guild-selection';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const { mockTrackDashboardEvent } = vi.hoisted(() => ({
  mockTrackDashboardEvent: vi.fn(),
}));

const { mockGuildDirectory } = vi.hoisted(() => ({
  mockGuildDirectory: vi.fn(),
}));

vi.mock('@/lib/amplitude', () => ({
  DASHBOARD_CONFIG_SAVE_ATTEMPTED_EVENT: 'dashboard_config_save_attempted',
  DASHBOARD_CONFIG_SAVE_FAILED_EVENT: 'dashboard_config_save_failed',
  DASHBOARD_CONFIG_SAVED_EVENT: 'dashboard_config_saved',
  trackDashboardEvent: mockTrackDashboardEvent,
}));

vi.mock('@/components/layout/guild-directory-context', () => ({
  useGuildDirectory: () => mockGuildDirectory(),
}));

const mockPush = vi.fn();
const mockPathname = vi.fn(() => '/dashboard/settings');
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({ push: mockPush }),
}));

const minimalConfig = {
  ai: { enabled: false, systemPrompt: '', blockedChannelIds: [] },
  moderation: { enabled: false },
  welcome: {
    enabled: false,
    dmSequence: { enabled: false, steps: [] },
  },
  triage: { enabled: false },
  starboard: { enabled: false },
  permissions: { enabled: false, botOwners: [] },
  memory: { enabled: false },
};

function makeGuild(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Guild ${id}`,
    icon: null,
    owner: true,
    permissions: '8',
    features: [],
    botPresent: true,
    ...overrides,
  };
}

function mockInstalledGuildDirectory(ids: string[]) {
  mockGuildDirectory.mockReturnValue({
    error: false,
    guilds: ids.map((id) => makeGuild(id)),
    loading: false,
    refreshGuilds: vi.fn(),
  });
}

type FetchMock = ReturnType<typeof vi.fn>;

function configResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

function stubConfigFetch(config: unknown = minimalConfig): FetchMock {
  const fetchMock = vi.fn().mockResolvedValue(configResponse(config));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderConfigContext() {
  const { ConfigProvider, useConfigContext } = await import(
    '@/components/dashboard/config-context'
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
  );
  return renderHook(() => useConfigContext(), { wrapper });
}

async function renderLoadedConfigContext() {
  const view = await renderConfigContext();
  await waitFor(() => expect(view.result.current.draftConfig).not.toBeNull());
  return view;
}

async function withMockLocation<T>(callback: () => Promise<T> | T): Promise<T> {
  const originalLocation = window.location;
  // @ts-expect-error jsdom location replacement for redirect assertion
  delete window.location;
  // @ts-expect-error minimal location mock for href assignment
  window.location = { href: '' };

  try {
    return await callback();
  } finally {
    // @ts-expect-error restore jsdom location
    window.location = originalLocation;
  }
}

describe('ConfigProvider', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem(SELECTED_GUILD_KEY, 'guild-123');
    mockPathname.mockReturnValue('/dashboard/settings');
    mockPush.mockClear();
    mockTrackDashboardEvent.mockClear();
    mockInstalledGuildDirectory([
      'guild-123',
      'guild-456',
      'guild-event',
      'guild-from-storage',
      'guild-invalid',
      'guild-error',
      'guild-ok',
    ]);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('provides config after fetch', async () => {
    stubConfigFetch();
    const { result } = await renderConfigContext();

    await waitFor(() => {
      expect(result.current.guildId).toBe('guild-123');
      expect(result.current.draftConfig).not.toBeNull();
    });
    expect(result.current.guildId).toBe('guild-123');
    expect(result.current.hasChanges).toBe(false);
    expect(result.current.saving).toBe(false);
  });

  it('does not load config for a stale selected guild where the bot is not installed', async () => {
    localStorage.setItem(SELECTED_GUILD_KEY, 'missing-bot');
    mockGuildDirectory.mockReturnValue({
      error: false,
      guilds: [makeGuild('missing-bot', { botPresent: false })],
      loading: false,
      refreshGuilds: vi.fn(),
    });
    const fetchMock = stubConfigFetch();

    const { result } = await renderConfigContext();

    await waitFor(() => {
      expect(result.current.guildId).toBe('');
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(SELECTED_GUILD_KEY)).toBeNull();
    expect(result.current.draftConfig).toBeNull();
    expect(result.current.error).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('loads config for a manageable selected guild when bot presence is non-authoritative', async () => {
    localStorage.setItem(SELECTED_GUILD_KEY, 'degraded-guild');
    mockGuildDirectory.mockReturnValue({
      error: false,
      guilds: [
        makeGuild('degraded-guild', {
          botPresent: false,
          botPresenceAuthoritative: false,
        }),
      ],
      loading: false,
      refreshGuilds: vi.fn(),
    });
    const fetchMock = stubConfigFetch();

    const { result } = await renderConfigContext();

    await waitFor(() => {
      expect(result.current.guildId).toBe('degraded-guild');
      expect(result.current.draftConfig).not.toBeNull();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/guilds/degraded-guild/config',
      expect.any(Object),
    );
    expect(localStorage.getItem(SELECTED_GUILD_KEY)).toBe('degraded-guild');
  });

  it('does not load or clear config while the guild directory is unresolved', async () => {
    mockGuildDirectory.mockReturnValue({
      error: false,
      guilds: [],
      loading: true,
      refreshGuilds: vi.fn(),
    });
    const fetchMock = stubConfigFetch();

    const { result } = await renderConfigContext();

    await waitFor(() => {
      expect(result.current.guildId).toBe('guild-123');
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(SELECTED_GUILD_KEY)).toBe('guild-123');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('updateDraftConfig marks hasChanges', async () => {
    stubConfigFetch();
    const { result } = await renderLoadedConfigContext();
    act(() => {
      result.current.updateDraftConfig((prev) => ({
        ...prev,
        ai: { ...prev.ai, enabled: true },
      }));
    });
    expect(result.current.hasChanges).toBe(true);
  });

  it('does not refetch or discard draft edits when the guild directory refreshes with the same valid guild', async () => {
    let directoryGuilds = [makeGuild('guild-123')];
    mockGuildDirectory.mockImplementation(() => ({
      error: false,
      guilds: directoryGuilds,
      loading: false,
      refreshGuilds: vi.fn(),
    }));
    const fetchMock = stubConfigFetch();

    const { result, rerender } = await renderLoadedConfigContext();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.updateDraftConfig((prev) => ({
        ...prev,
        ai: { ...prev.ai, systemPrompt: 'unsaved draft prompt' },
      }));
    });
    expect(result.current.hasChanges).toBe(true);

    directoryGuilds = [makeGuild('guild-123', { name: 'Guild guild-123 refreshed' })];
    rerender();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(result.current.draftConfig?.ai?.systemPrompt).toBe('unsaved draft prompt');
    expect(result.current.hasChanges).toBe(true);
  });

  it.each([
    { directoryError: false, directoryLoading: true, state: 'loading' },
    { directoryError: true, directoryLoading: false, state: 'errored' },
  ])(
    'clears validated config when guild changes while the guild directory is $state',
    async ({ directoryError, directoryLoading }) => {
      let directoryState = {
        error: false,
        guilds: [makeGuild('guild-123'), makeGuild('guild-456')],
        loading: false,
      };
      mockGuildDirectory.mockImplementation(() => ({
        ...directoryState,
        refreshGuilds: vi.fn(),
      }));
      const fetchMock = stubConfigFetch();

      const { result } = await renderLoadedConfigContext();
      expect(result.current.guildId).toBe('guild-123');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      act(() => {
        result.current.updateDraftConfig((prev) => ({
          ...prev,
          ai: { ...prev.ai, systemPrompt: 'unsaved draft prompt' },
        }));
      });
      expect(result.current.hasChanges).toBe(true);

      directoryState = {
        error: directoryError,
        guilds: [],
        loading: directoryLoading,
      };
      act(() => {
        window.dispatchEvent(
          new CustomEvent('volvox-bot:guild-selected', { detail: 'guild-456' }),
        );
      });

      await waitFor(() => expect(result.current.guildId).toBe('guild-456'));
      await waitFor(() => expect(result.current.draftConfig).toBeNull());

      expect(result.current.savedConfig).toBeNull();
      expect(result.current.hasChanges).toBe(false);

      await act(async () => result.current.executeSave());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).not.toHaveBeenCalledWith(
        '/api/guilds/guild-456/config',
        expect.objectContaining({ method: 'PUT' }),
      );
    },
  );

  it('clears the selected guild when a directory refresh removes its manageability', async () => {
    let directoryGuilds = [makeGuild('guild-123')];
    mockGuildDirectory.mockImplementation(() => ({
      error: false,
      guilds: directoryGuilds,
      loading: false,
      refreshGuilds: vi.fn(),
    }));
    const fetchMock = stubConfigFetch();

    const { result, rerender } = await renderLoadedConfigContext();
    expect(result.current.guildId).toBe('guild-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const cancelableSwitchGuard = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener(GUILD_SELECTED_EVENT, cancelableSwitchGuard, true);

    try {
      directoryGuilds = [makeGuild('guild-123', { botPresent: false })];
      rerender();

      await waitFor(() => expect(result.current.guildId).toBe(''));
      expect(localStorage.getItem(SELECTED_GUILD_KEY)).toBeNull();
      expect(result.current.draftConfig).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(GUILD_SELECTED_EVENT, cancelableSwitchGuard, true);
    }
  });

  it('discardChanges resets draft to saved', async () => {
    stubConfigFetch();
    const { result } = await renderLoadedConfigContext();
    act(() => {
      result.current.updateDraftConfig((prev) => ({
        ...prev,
        ai: { ...prev.ai, enabled: true },
      }));
    });
    expect(result.current.hasChanges).toBe(true);
    act(() => result.current.discardChanges());
    expect(result.current.hasChanges).toBe(false);
  });

  it('throws when useConfigContext is used outside provider', async () => {
    const { useConfigContext } = await import('@/components/dashboard/config-context');
    expect(() => renderHook(() => useConfigContext())).toThrow(
      'useConfigContext must be used within ConfigProvider',
    );
  });

  it('derives activeCategoryId as null on landing page', async () => {
    mockPathname.mockReturnValue('/dashboard/settings');
    stubConfigFetch();
    const { result } = await renderLoadedConfigContext();
    expect(result.current.activeCategoryId).toBeNull();
  });

  it('derives activeCategoryId from pathname', async () => {
    mockPathname.mockReturnValue('/dashboard/settings/ai-automation');
    stubConfigFetch();
    const { result } = await renderLoadedConfigContext();
    expect(result.current.activeCategoryId).toBe('ai-automation');
  });

  it('returns empty visibleFeatureIds when activeCategoryId is null', async () => {
    mockPathname.mockReturnValue('/dashboard/settings');
    stubConfigFetch();
    const { result } = await renderLoadedConfigContext();
    expect(result.current.visibleFeatureIds.size).toBe(0);
  });

  it('handleSearchSelect navigates to the category page', async () => {
    stubConfigFetch();
    const { result } = await renderLoadedConfigContext();
    act(() => {
      result.current.handleSearchSelect({
        id: 'ai-chat-enabled',
        featureId: 'ai-chat',
        categoryId: 'ai-automation',
        label: 'Enable AI Chat',
        description: 'Turn bot chat responses on or off per guild.',
        keywords: ['ai'],
        isAdvanced: false,
      });
    });
    expect(mockPush).toHaveBeenCalledWith('/dashboard/settings/ai-automation');
  });

  it('handles guild selection, storage updates, and cancelled guild switches', async () => {
    stubConfigFetch();
    const { result } = await renderConfigContext();

    await waitFor(() => expect(result.current.guildId).toBe('guild-123'));

    act(() => {
      const cancelled = new CustomEvent('volvox-bot:guild-selected', {
        detail: 'blocked-guild',
        cancelable: true,
      });
      cancelled.preventDefault();
      window.dispatchEvent(cancelled);
    });
    expect(result.current.guildId).toBe('guild-123');

    act(() => {
      window.dispatchEvent(new CustomEvent('volvox-bot:guild-selected', { detail: 'guild-456' }));
    });
    await waitFor(() => expect(result.current.guildId).toBe('guild-456'));

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'volvox-bot-selected-guild', newValue: null }),
      );
    });
    await waitFor(() => expect(result.current.guildId).toBe(''));
  });

  it('reports fetch failures when reloading config', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(configResponse(minimalConfig))
      .mockResolvedValueOnce(configResponse({ error: 'Nope' }, 500));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = await renderConfigContext();

    await waitFor(() => expect(result.current.draftConfig).not.toBeNull());

    await act(async () => {
      await result.current.fetchConfig('broken-guild');
    });

    expect(result.current.error).toBe('Nope');
    expect(toast.error).toHaveBeenCalledWith('Failed to load config', { description: 'Nope' });
  });

  it('reacts to guild selection and storage events while respecting cancelled switches', async () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementationOnce(() => {
        throw new Error('storage blocked');
      })
      .mockImplementation((key) => (key === 'volvox-bot-selected-guild' ? 'guild-storage' : null));
    const fetchMock = stubConfigFetch();
    const { result } = await renderConfigContext();

    await waitFor(() => expect(result.current.guildId).toBe(''));
    expect(fetchMock).not.toHaveBeenCalled();

    const cancelled = new CustomEvent<string>('volvox-bot:guild-selected', {
      detail: 'guild-cancelled',
      cancelable: true,
    });
    cancelled.preventDefault();
    act(() => window.dispatchEvent(cancelled));
    expect(result.current.guildId).toBe('');

    act(() => {
      window.dispatchEvent(
        new CustomEvent<string>('volvox-bot:guild-selected', { detail: 'guild-event' }),
      );
    });
    await waitFor(() => expect(result.current.guildId).toBe('guild-event'));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/guilds/guild-event/config', expect.any(Object)),
    );

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'volvox-bot-selected-guild',
          newValue: 'guild-from-storage',
        }),
      );
    });
    await waitFor(() => expect(result.current.guildId).toBe('guild-from-storage'));

    getItemSpy.mockRestore();
  });

  it('handles fetch redirects, invalid payloads, and API errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(configResponse({}, 401))
      .mockResolvedValueOnce(configResponse({ nope: true }))
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ error: 'temporarily unavailable' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(minimalConfig),
      });
    vi.stubGlobal('fetch', fetchMock);

    await withMockLocation(async () => {
      const { result } = await renderConfigContext();

      await waitFor(() => expect(window.location.href).toBe('/login'));
      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/guilds/guild-123/config');

      await act(async () => result.current.fetchConfig('guild-invalid'));
      expect(result.current.error).toBe('Invalid config response');

      await act(async () => result.current.fetchConfig('guild-error'));
      expect(result.current.error).toBe('temporarily unavailable');
      expect(toast.error).toHaveBeenCalledWith('Failed to load config', {
        description: 'temporarily unavailable',
      });

      await act(async () => result.current.fetchConfig('guild-ok'));
      await waitFor(() => expect(result.current.draftConfig?.welcome?.enabled).toBe(false));
    });
  });

  it('derives search, active tabs, dirty counts, focus behavior, and category navigation', async () => {
    mockPathname.mockReturnValue('/dashboard/settings/onboarding-growth');
    stubConfigFetch();
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const feature = document.createElement('section');
    feature.id = 'feature-welcome';
    feature.scrollIntoView = vi.fn();
    const focusTarget = document.createElement('button');
    feature.append(focusTarget);
    document.body.append(feature);

    const { result } = await renderConfigContext();

    await waitFor(() => expect(result.current.draftConfig).not.toBeNull());
    expect(result.current.activeCategoryId).toBe('onboarding-growth');
    expect(result.current.activeTabId).toBeTruthy();
    expect(result.current.visibleFeatureIds.size).toBeGreaterThan(0);

    act(() => result.current.handleSearchChange('dm sequence'));
    await waitFor(() => expect(result.current.searchResults.length).toBeGreaterThan(0));
    expect(result.current.visibleFeatureIds.has('welcome')).toBe(true);

    const dmSequenceResult = result.current.searchResults.find(
      (item) => item.id === 'welcome-dm-sequence',
    );
    expect(dmSequenceResult).toBeDefined();
    act(() => result.current.handleSearchSelect(dmSequenceResult!));

    expect(result.current.forceOpenAdvancedFeatureId).toBe('welcome');
    expect(mockPush).toHaveBeenCalledWith('/dashboard/settings/onboarding-growth');
    expect(result.current.activeTabId).toBe('welcome');
    expect(feature.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(document.activeElement).toBe(focusTarget);

    act(() => result.current.setActiveCategoryId(null));
    expect(mockPush).toHaveBeenCalledWith('/dashboard/settings');

    act(() => result.current.setActiveCategoryId('ai-automation'));
    expect(mockPush).toHaveBeenCalledWith('/dashboard/settings/ai-automation');

    act(() => {
      result.current.updateDraftConfig((prev) => ({
        ...prev,
        welcome: { ...prev.welcome, enabled: true },
      }));
    });
    expect(result.current.changedSections).toContain('welcome');
    expect(result.current.dirtyCategoryCounts['onboarding-growth']).toBeGreaterThan(0);
    expect(result.current.changedCategoryCount).toBeGreaterThan(0);

    act(() => result.current.handleSearchChange(''));
    expect(result.current.searchQuery).toBe('');

    feature.remove();
    rafSpy.mockRestore();
    cancelSpy.mockRestore();
  });

  it('opens the diff modal from save actions and blocks invalid or unchanged saves', async () => {
    stubConfigFetch();
    const { result } = await renderLoadedConfigContext();

    act(() => result.current.openDiffModal());
    expect(toast.info).toHaveBeenCalledWith('No changes to save.');

    await act(async () => result.current.executeSave());
    expect(toast.info).toHaveBeenCalledWith('No changes to save.');

    act(() => {
      result.current.updateDraftConfig((prev) => ({
        ...prev,
        ai: { ...prev.ai, systemPrompt: 'x'.repeat(4001) },
      }));
    });
    expect(result.current.hasValidationErrors).toBe(true);
    act(() => result.current.openDiffModal());
    expect(toast.error).toHaveBeenCalledWith('Cannot save', {
      description: 'Fix validation errors before saving.',
    });
    await act(async () => result.current.executeSave());
    expect(toast.error).toHaveBeenCalledWith('Cannot save', {
      description: 'Fix validation errors before saving.',
    });

    act(() => result.current.discardChanges());
    act(() => {
      result.current.updateDraftConfig((prev) => ({
        ...prev,
        ai: { ...prev.ai, enabled: true },
      }));
    });
    act(() => result.current.openDiffModal());
    expect(result.current.showDiffModal).toBe(true);
    act(() => result.current.setShowDiffModal(false));
    expect(result.current.showDiffModal).toBe(false);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    });
    expect(result.current.showDiffModal).toBe(true);

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    });
    expect(result.current.showDiffModal).toBe(true);
    input.remove();
  });

  it('saves, reverts, undoes, clears stale undo state, and reports failed saves', async () => {
    const savedAfterPut = { ...minimalConfig, ai: { ...minimalConfig.ai, enabled: true } };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(configResponse(minimalConfig))
      .mockResolvedValueOnce(configResponse({}))
      .mockResolvedValueOnce(configResponse(savedAfterPut))
      .mockResolvedValueOnce(configResponse({ details: ['bad patch'] }, 400))
      .mockResolvedValueOnce(configResponse({}, 401));
    vi.stubGlobal('fetch', fetchMock);

    await withMockLocation(async () => {
      const { result } = await renderConfigContext();

      await waitFor(() => expect(result.current.draftConfig).not.toBeNull());
      act(() => {
        result.current.updateDraftConfig((prev) => ({
          ...prev,
          ai: { ...prev.ai, enabled: true },
        }));
      });

      await act(async () => result.current.executeSave());
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/guilds/guild-123/config',
        expect.objectContaining({ method: 'PUT', body: expect.stringContaining('ai.enabled') }),
      );
      expect(toast.success).toHaveBeenCalledWith('Config saved successfully!');
      expect(result.current.prevSavedConfig?.guildId).toBe('guild-123');
      expect(mockTrackDashboardEvent).toHaveBeenCalledWith('dashboard_config_save_attempted', {
        activeCategoryId: null,
        changedCategoryCount: 1,
        changedSections: ['ai'],
        patchCount: 1,
      });
      expect(mockTrackDashboardEvent).toHaveBeenCalledWith('dashboard_config_saved', {
        activeCategoryId: null,
        changedCategoryCount: 1,
        changedSections: ['ai'],
        patchCount: 1,
      });

      act(() => result.current.undoLastSave());
      expect(result.current.prevSavedConfig).toBeNull();
      expect(toast.info).toHaveBeenCalledWith('Reverted to previous saved state. Save again to apply.');

      act(() => result.current.revertSection('ai'));
      expect(toast.success).toHaveBeenCalledWith('Reverted ai changes.');

      act(() => {
        result.current.updateDraftConfig((prev) => ({
          ...prev,
          moderation: { ...prev.moderation, enabled: true },
        }));
      });
      await act(async () => result.current.executeSave());
      expect(toast.error).toHaveBeenCalledWith('Failed to save config', { description: 'HTTP 400: bad patch' });
      expect(mockTrackDashboardEvent).toHaveBeenCalledWith(
        'dashboard_config_save_failed',
        expect.objectContaining({
          activeCategoryId: null,
          changedCategoryCount: 1,
          failureReason: 'validation',
          patchCount: 1,
        }),
      );

      await act(async () => result.current.executeSave());
      expect(window.location.href).toBe('/login');
      expect(JSON.stringify(mockTrackDashboardEvent.mock.calls)).not.toContain('guild-123');
    });
  });

  it('handles keyboard search shortcuts and beforeunload only when changes exist', async () => {
    stubConfigFetch();
    const searchInput = document.createElement('input');
    searchInput.id = 'config-search';
    document.body.append(searchInput);

    const { result } = await renderConfigContext();

    await waitFor(() => expect(result.current.draftConfig).not.toBeNull());

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '/' }));
    });
    expect(document.activeElement).toBe(searchInput);

    act(() => result.current.handleSearchChange('github'));
    expect(result.current.searchQuery).toBe('github');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.searchQuery).toBe('');

    act(() => {
      result.current.updateDraftConfig((prev) => ({
        ...prev,
        ai: { ...prev.ai, enabled: true },
      }));
    });
    const beforeUnload = new Event('beforeunload', { cancelable: true });
    act(() => window.dispatchEvent(beforeUnload));
    expect(beforeUnload.defaultPrevented).toBe(true);

    searchInput.remove();
  });

});
