import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockInit, mockReset, mockSetOptOut, mockSetUserId, mockTrack } = vi.hoisted(() => ({
  mockInit: vi.fn(),
  mockReset: vi.fn(),
  mockSetOptOut: vi.fn(),
  mockSetUserId: vi.fn(),
  mockTrack: vi.fn(),
}));

vi.mock('@amplitude/analytics-browser', () => ({
  init: mockInit,
  reset: mockReset,
  setOptOut: mockSetOptOut,
  setUserId: mockSetUserId,
  track: mockTrack,
  Types: {
    LogLevel: {
      None: 'none',
    },
  },
}));

describe('dashboard Amplitude analytics', () => {
  afterEach(() => {
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
    document.cookie = 'AMP_cookie=; Max-Age=0; path=/';
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.clearAllMocks();
  });

  function storeAnalyticsConsent(analytics = true) {
    globalThis.localStorage.setItem(
      'volvox.cookieConsent.v1',
      JSON.stringify({
        version: 1,
        decidedAt: '2026-05-16T00:00:00.000Z',
        expiresAt: '2099-05-16T00:00:00.000Z',
        categories: {
          essential: true,
          analytics,
        },
      }),
    );
  }

  it('does not initialize or track events without the public API key', async () => {
    vi.stubEnv('NEXT_PUBLIC_AMPLITUDE_API_KEY', '');

    const { initDashboardAmplitude, trackDashboardEvent } =
      await import('@/lib/amplitude');

    expect(initDashboardAmplitude()).toBe(false);
    expect(trackDashboardEvent('dashboard_page_viewed', { route: '/' })).toBe(false);
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it('builds conservative US-only browser options by default', async () => {
    vi.stubEnv('NEXT_PUBLIC_AMPLITUDE_API_KEY', 'public-key');
    vi.stubEnv('NEXT_PUBLIC_AMPLITUDE_SERVER_ZONE', 'EU');

    const { getBrowserAmplitudeOptions } = await import('@/lib/amplitude');

    expect(getBrowserAmplitudeOptions()).toEqual({
      autocapture: false,
      logLevel: 'none',
      remoteConfig: {
        fetchRemoteConfig: false,
      },
      optOut: false,
      serverZone: 'US',
      trackingOptions: {
        ipAddress: false,
      },
    });
  });

  it('does not enable or initialize when the browser window is unavailable', async () => {
    vi.stubEnv('NEXT_PUBLIC_AMPLITUDE_API_KEY', 'public-key');
    vi.stubGlobal('window', undefined);

    const { initDashboardAmplitude } = await import('@/lib/amplitude');

    expect(initDashboardAmplitude('discord-user-123')).toBe(false);
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('enables only safe autocapture groups when opted in', async () => {
    vi.stubEnv('NEXT_PUBLIC_AMPLITUDE_API_KEY', 'public-key');
    vi.stubEnv('NEXT_PUBLIC_AMPLITUDE_AUTOCAPTURE', 'true');

    const { getBrowserAmplitudeOptions } = await import('@/lib/amplitude');

    expect(getBrowserAmplitudeOptions().autocapture).toEqual({
      attribution: true,
      elementInteractions: false,
      fileDownloads: false,
      formInteractions: false,
      frustrationInteractions: false,
      networkTracking: false,
      pageUrlEnrichment: true,
      pageViews: false,
      sessions: true,
      webVitals: false,
    });
  });

  it('initializes once and updates the authenticated user id safely', async () => {
    vi.stubEnv('NEXT_PUBLIC_AMPLITUDE_API_KEY', 'public-key');
    storeAnalyticsConsent();

    const { initDashboardAmplitude } = await import('@/lib/amplitude');

    expect(initDashboardAmplitude('discord-user-123')).toBe(true);
    expect(initDashboardAmplitude('discord-user-123')).toBe(true);
    expect(initDashboardAmplitude('discord-user-456')).toBe(true);
    expect(initDashboardAmplitude(null)).toBe(true);

    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockInit).toHaveBeenCalledWith(
      'public-key',
      'discord-user-123',
      expect.objectContaining({ autocapture: false }),
    );
    expect(mockSetOptOut).toHaveBeenCalledWith(false);
    expect(mockSetUserId).toHaveBeenCalledWith('discord-user-456');
    expect(mockReset).toHaveBeenCalledOnce();
  });

  it('does not initialize or track events before analytics consent', async () => {
    vi.stubEnv('NEXT_PUBLIC_AMPLITUDE_API_KEY', 'public-key');

    const { initDashboardAmplitude, trackDashboardEvent } =
      await import('@/lib/amplitude');

    expect(initDashboardAmplitude('discord-user-123')).toBe(false);
    expect(trackDashboardEvent('dashboard_page_viewed', { route: '/dashboard' })).toBe(false);
    expect(mockInit).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
    expect(mockSetOptOut).toHaveBeenCalledWith(true);
  });

  it('opts out, clears identity, and blocks future tracking after analytics consent is revoked', async () => {
    vi.stubEnv('NEXT_PUBLIC_AMPLITUDE_API_KEY', 'public-key');
    storeAnalyticsConsent();
    globalThis.localStorage.setItem('AMP_test', 'queued-event');
    globalThis.sessionStorage.setItem('amplitude_unsent_public-key', 'queued-event');
    globalThis.localStorage.setItem('amplitude_dashboard_preferences', 'keep-me');
    document.cookie = 'AMP_cookie=test; path=/';

    const { initDashboardAmplitude, trackDashboardEvent } =
      await import('@/lib/amplitude');

    expect(initDashboardAmplitude('discord-user-123')).toBe(true);
    storeAnalyticsConsent(false);

    expect(initDashboardAmplitude('discord-user-123')).toBe(false);
    expect(trackDashboardEvent('dashboard_page_viewed', { route: '/dashboard' })).toBe(false);

    expect(mockInit).toHaveBeenCalledOnce();
    expect(mockSetOptOut).toHaveBeenCalledWith(false);
    expect(mockSetOptOut).toHaveBeenCalledWith(true);
    expect(mockSetUserId).toHaveBeenCalledWith(undefined);
    expect(mockReset).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalled();
    expect(globalThis.localStorage.getItem('AMP_test')).toBeNull();
    expect(globalThis.sessionStorage.getItem('amplitude_unsent_public-key')).toBeNull();
    expect(globalThis.localStorage.getItem('amplitude_dashboard_preferences')).toBe('keep-me');
    expect(document.cookie).not.toContain('AMP_cookie=');
  });

  it('expires visible Amplitude cookies on the current page path when consent is revoked', async () => {
    vi.stubEnv('NEXT_PUBLIC_AMPLITUDE_API_KEY', 'public-key');
    storeAnalyticsConsent();
    window.history.pushState({}, '', '/dashboard/settings');
    document.cookie = 'AMP_path_cookie=test; path=/dashboard/settings';

    expect(document.cookie).toContain('AMP_path_cookie=');

    const { resetDashboardAmplitude } = await import('@/lib/amplitude');

    expect(resetDashboardAmplitude()).toBe(true);
    expect(document.cookie).not.toContain('AMP_path_cookie=');
  });

  it('exports all required dashboard event name constants', async () => {
    const amplitude = await import('@/lib/amplitude');

    expect(amplitude.DASHBOARD_PAGE_VIEW_EVENT).toBe('dashboard_page_viewed');
    expect(amplitude.DASHBOARD_GUILD_SELECTED_EVENT).toBe('dashboard_guild_selected');
    expect(amplitude.DASHBOARD_AUTH_STARTED_EVENT).toBe('dashboard_auth_started');
    expect(amplitude.DASHBOARD_CONFIG_SAVE_ATTEMPTED_EVENT).toBe('dashboard_config_save_attempted');
    expect(amplitude.DASHBOARD_CONFIG_SAVED_EVENT).toBe('dashboard_config_saved');
    expect(amplitude.DASHBOARD_CONFIG_SAVE_FAILED_EVENT).toBe('dashboard_config_save_failed');
    expect(amplitude.DASHBOARD_ANALYTICS_REFRESHED_EVENT).toBe('dashboard_analytics_refreshed');
    expect(amplitude.DASHBOARD_ANALYTICS_REFRESH_FAILED_EVENT).toBe('dashboard_analytics_refresh_failed');
    expect(amplitude.DASHBOARD_ANALYTICS_EXPORTED_EVENT).toBe('dashboard_analytics_exported');
    expect(amplitude.DASHBOARD_ANALYTICS_FILTER_CHANGED_EVENT).toBe('dashboard_analytics_filter_changed');
    expect(amplitude.DASHBOARD_WELCOME_PUBLISHED_EVENT).toBe('dashboard_welcome_published');
    expect(amplitude.DASHBOARD_WELCOME_PUBLISH_FAILED_EVENT).toBe('dashboard_welcome_publish_failed');
    expect(amplitude.DASHBOARD_AI_FEEDBACK_SUBMITTED_EVENT).toBe('dashboard_ai_feedback_submitted');
    expect(amplitude.DASHBOARD_AI_FEEDBACK_FAILED_EVENT).toBe('dashboard_ai_feedback_failed');
  });

  it('getAmplitudeServerZone always returns US regardless of NEXT_PUBLIC_AMPLITUDE_SERVER_ZONE', async () => {
    vi.stubEnv('NEXT_PUBLIC_AMPLITUDE_API_KEY', 'public-key');
    vi.stubEnv('NEXT_PUBLIC_AMPLITUDE_SERVER_ZONE', 'EU');

    const { getBrowserAmplitudeOptions } = await import('@/lib/amplitude');

    expect(getBrowserAmplitudeOptions().serverZone).toBe('US');
  });

  it('tracks sanitized dashboard events', async () => {
    vi.stubEnv('NEXT_PUBLIC_AMPLITUDE_API_KEY', 'public-key');
    storeAnalyticsConsent();

    const { trackDashboardEvent } = await import('@/lib/amplitude');

    const shared = { ok: true };
    const cyclic = ['root'] as unknown[];
    cyclic.push(cyclic);

    expect(
      trackDashboardEvent(' dashboard_button_clicked ', {
        guildId: 'guild-12345',
        password: 'secret',
        callback: 'callback?access_token=secret-value&safe=1',
        assignment: 'token=secret-value safe=true',
        githubPat: 'token github_pat_abcdefghijk1234567890 leaked',
        clientIp: '127.0.0.1',
        nested: {
          token: 'secret',
          remoteIp: '127.0.0.2',
          ok: true,
        },
        first: shared,
        second: shared,
        cyclic,
      }),
    ).toBe(true);

    expect(mockTrack).toHaveBeenCalledWith('dashboard_button_clicked', {
      guildId: 'guild-12345',
      callback: 'callback?access_token=[REDACTED]&safe=1',
      assignment: 'token=[REDACTED] safe=true',
      githubPat: 'token [REDACTED] leaked',
      nested: {
        ok: true,
      },
      first: { ok: true },
      second: { ok: true },
      cyclic: ['root', '[Circular]'],
    });
  });
});
