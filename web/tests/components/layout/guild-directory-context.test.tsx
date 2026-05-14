import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GuildDirectoryProvider,
  useGuildDirectory,
} from '@/components/layout/guild-directory-context';

function GuildDirectoryConsumer() {
  const { error, guilds, loading, refreshGuilds } = useGuildDirectory();

  return (
    <div>
      <div data-testid="guild-directory-status">
        {loading ? 'loading' : 'idle'}:{error ? 'error' : 'ok'}:
        {guilds.map((guild) => guild.name).join(', ') || 'none'}
      </div>
      <button type="button" onClick={() => refreshGuilds()}>
        Refresh guilds
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <GuildDirectoryProvider>
      <GuildDirectoryConsumer />
    </GuildDirectoryProvider>,
  );
}

describe('GuildDirectoryProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('filters malformed guild rows while keeping valid mutual guilds', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { id: '1', name: 'Alpha', botPresent: true, icon: null },
        { id: '2', name: 'Missing bot flag' },
        null,
        { id: 3, name: 'Bad id', botPresent: true },
      ],
    } as Response);

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('guild-directory-status')).toHaveTextContent('idle:ok:Alpha');
    });
    expect(fetchSpy).toHaveBeenCalledWith('/api/guilds', { signal: expect.any(AbortSignal) });
  });

  it('surfaces invalid payloads as errors and can refresh successfully', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ guilds: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ id: '2', name: 'Beta', botPresent: true }],
      } as Response);

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('guild-directory-status')).toHaveTextContent('idle:error:none');
    });

    await user.click(screen.getByRole('button', { name: 'Refresh guilds' }));

    await waitFor(() => {
      expect(screen.getByTestId('guild-directory-status')).toHaveTextContent('idle:ok:Beta');
    });
  });

  it('ignores abort errors without entering an error state', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('cancelled', 'AbortError'));

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('guild-directory-status')).toHaveTextContent('idle:ok:none');
    });
  });

  it('redirects to login on unauthorized responses', async () => {
    const originalLocation = window.location;
    // @ts-expect-error jsdom location replacement for redirect assertion
    delete window.location;
    // @ts-expect-error minimal location mock for href assignment
    window.location = { href: '' };

    try {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 401,
        json: vi.fn(),
      } as unknown as Response);

      renderProvider();

      await waitFor(() => {
        expect(window.location.href).toBe('/login');
        expect(screen.getByTestId('guild-directory-status')).toHaveTextContent('idle:ok:none');
      });
    } finally {
      // @ts-expect-error restore jsdom location
      window.location = originalLocation;
    }
  });

  it('throws when consumed outside the provider boundary', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    function OutsideProvider() {
      useGuildDirectory();
      return null;
    }

    expect(() => render(<OutsideProvider />)).toThrow(
      'useGuildDirectory must be used within GuildDirectoryProvider',
    );

    errorSpy.mockRestore();
  });

  it('preserves bot presence authority from guild API response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { id: '1', name: 'Fallback Guild', botPresent: false, botPresenceAuthoritative: false },
      ],
    } as Response);

    function PresenceConsumer() {
      const { guilds } = useGuildDirectory();
      const g = guilds[0];
      if (!g) return <div data-testid="status">none</div>;
      return (
        <div data-testid="status">
          {g.botPresenceAuthoritative === false ? 'presence-degraded' : 'presence-authoritative'}
        </div>
      );
    }

    render(
      <GuildDirectoryProvider>
        <PresenceConsumer />
      </GuildDirectoryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('presence-degraded');
    });
  });

  it('parses iconHash and config from guild API response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: '1',
          name: 'Hub',
          botPresent: true,
          icon: 'https://cdn.example.com/hub.webp',
          iconHash: 'abc123',
          config: { communityHubs: { enabled: true } },
        },
      ],
    } as Response);

    function GuildConfigConsumer() {
      const { guilds } = useGuildDirectory();
      const g = guilds[0];
      if (!g) return <div data-testid="status">none</div>;
      return (
        <div data-testid="status">
          {g.iconHash}:{g.config?.communityHubs?.enabled ? 'hubs-on' : 'hubs-off'}
        </div>
      );
    }

    render(
      <GuildDirectoryProvider>
        <GuildConfigConsumer />
      </GuildDirectoryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('abc123:hubs-on');
    });
  });

  it('parses valid access levels from guild API response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { id: '1', name: 'Owner Guild', botPresent: true, access: 'owner' },
        { id: '2', name: 'Admin Guild', botPresent: true, access: 'admin' },
        { id: '3', name: 'Mod Guild', botPresent: true, access: 'moderator' },
        { id: '4', name: 'Viewer Guild', botPresent: true, access: 'viewer' },
      ],
    } as Response);

    function AccessConsumer() {
      const { guilds } = useGuildDirectory();
      return (
        <ul>
          {guilds.map((g) => (
            <li key={g.id} data-testid={`guild-${g.id}`}>
              {g.name}:{g.access ?? 'none'}
            </li>
          ))}
        </ul>
      );
    }

    render(
      <GuildDirectoryProvider>
        <AccessConsumer />
      </GuildDirectoryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('guild-1')).toHaveTextContent('Owner Guild:owner');
      expect(screen.getByTestId('guild-2')).toHaveTextContent('Admin Guild:admin');
      expect(screen.getByTestId('guild-3')).toHaveTextContent('Mod Guild:moderator');
      expect(screen.getByTestId('guild-4')).toHaveTextContent('Viewer Guild:viewer');
    });
  });

  it('ignores invalid access level strings', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { id: '1', name: 'Bad Access', botPresent: true, access: 'superadmin' },
      ],
    } as Response);

    function AccessConsumer() {
      const { guilds } = useGuildDirectory();
      const g = guilds[0];
      if (!g) return <div data-testid="status">none</div>;
      return <div data-testid="status">{g.access === undefined ? 'no-access' : g.access}</div>;
    }

    render(
      <GuildDirectoryProvider>
        <AccessConsumer />
      </GuildDirectoryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('no-access');
    });
  });

  it('defaults permissions to "0" and features to [] when not provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { id: '1', name: 'Sparse Guild', botPresent: true },
      ],
    } as Response);

    function FieldConsumer() {
      const { guilds } = useGuildDirectory();
      const g = guilds[0];
      if (!g) return <div data-testid="status">none</div>;
      return (
        <div data-testid="status">
          {g.permissions}:{g.features.length}
        </div>
      );
    }

    render(
      <GuildDirectoryProvider>
        <FieldConsumer />
      </GuildDirectoryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('0:0');
    });
  });

  it('preserves owner=false when not provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { id: '1', name: 'Test', botPresent: true },
      ],
    } as Response);

    function OwnerConsumer() {
      const { guilds } = useGuildDirectory();
      const g = guilds[0];
      if (!g) return <div data-testid="status">none</div>;
      return <div data-testid="status">{g.owner ? 'owner' : 'not-owner'}</div>;
    }

    render(
      <GuildDirectoryProvider>
        <OwnerConsumer />
      </GuildDirectoryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('not-owner');
    });
  });

  it('ignores invalid communityHubs config shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: '1',
          name: 'Bad Config',
          botPresent: true,
          config: { communityHubs: { enabled: 'yes' } },
        },
      ],
    } as Response);

    function ConfigConsumer() {
      const { guilds } = useGuildDirectory();
      const g = guilds[0];
      if (!g) return <div data-testid="status">none</div>;
      return (
        <div data-testid="status">
          {g.config?.communityHubs === undefined ? 'no-hub-config' : 'has-hub-config'}
        </div>
      );
    }

    render(
      <GuildDirectoryProvider>
        <ConfigConsumer />
      </GuildDirectoryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('no-hub-config');
    });
  });

  it('normalizes invalid member counts to null', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { id: '1', name: 'Direct', botPresent: true, memberCount: 42 },
        { id: '2', name: 'Zero', botPresent: true, memberCount: 0 },
        { id: '3', name: 'Approx', botPresent: true, approximate_member_count: 7 },
        {
          id: '4',
          name: 'Fallback',
          botPresent: true,
          memberCount: -1,
          approximate_member_count: 9,
        },
        { id: '5', name: 'Negative', botPresent: true, memberCount: -10 },
        { id: '6', name: 'NaN', botPresent: true, memberCount: Number.NaN },
        { id: '7', name: 'Infinity', botPresent: true, approximate_member_count: Infinity },
        { id: '8', name: 'Decimal', botPresent: true, memberCount: 1.5 },
      ],
    } as Response);

    function MemberCountConsumer() {
      const { guilds } = useGuildDirectory();
      return (
        <div data-testid="counts">
          {guilds
            .map((guild) => (guild.memberCount === null ? 'null' : String(guild.memberCount)))
            .join(',')}
        </div>
      );
    }

    render(
      <GuildDirectoryProvider>
        <MemberCountConsumer />
      </GuildDirectoryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('counts')).toHaveTextContent('42,0,7,9,null,null,null,null');
    });
  });
});
