import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MutualGuild } from '@/types/discord';

const { mockReplace, mockUseGuildDirectory, mockUsePathname } = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockUseGuildDirectory: vi.fn(),
  mockUsePathname: vi.fn(() => '/dashboard'),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('@/components/layout/guild-directory-context', () => ({
  useGuildDirectory: () => mockUseGuildDirectory(),
}));

vi.mock('@/contexts/analytics-context', () => ({
  AnalyticsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/layout/header', () => ({
  Header: () => <header data-testid="header">Header</header>,
}));

vi.mock('@/components/layout/dashboard-title-sync', () => ({
  DashboardTitleSync: () => <div data-testid="dashboard-title-sync" />,
}));

vi.mock('@/components/layout/sidebar', () => ({
  Sidebar: () => <nav data-testid="sidebar">Sidebar</nav>,
}));

vi.mock('@/components/layout/server-selector', () => ({
  ServerSelector: () => <div data-testid="server-selector">Servers</div>,
}));

vi.mock('@/components/layout/site-footer', () => ({
  SiteFooter: () => <footer data-testid="site-footer">Footer</footer>,
}));

import { DashboardShell } from '@/components/layout/dashboard-shell';

function makeGuild(overrides: Partial<MutualGuild> & Pick<MutualGuild, 'id' | 'name'>): MutualGuild {
  return {
    access: 'viewer',
    botPresent: false,
    features: [],
    icon: null,
    iconHash: null,
    memberCount: null,
    owner: false,
    permissions: '0',
    ...overrides,
  };
}

function mockGuildDirectory(
  guilds: MutualGuild[],
  options: { readonly error?: boolean; readonly loading?: boolean } = {},
) {
  mockUseGuildDirectory.mockReturnValue({
    error: options.error ?? false,
    guilds,
    loading: options.loading ?? false,
    refreshGuilds: vi.fn(),
  });
}

describe('DashboardShell', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockUsePathname.mockReturnValue('/dashboard');
    mockGuildDirectory([
      makeGuild({
        access: 'admin',
        botPresent: true,
        id: 'guild-installed',
        name: 'Installed Server',
        permissions: '8',
      }),
    ]);
  });

  it('renders header, sidebar, and content when an installed manageable workspace exists', () => {
    render(
      <DashboardShell>
        <div data-testid="content">Content</div>
      </DashboardShell>,
    );
    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-title-sync')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('site-footer')).toBeInTheDocument();
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('keeps dashboard chrome for viewer access to an installed community hub', () => {
    mockGuildDirectory([
      makeGuild({
        access: 'viewer',
        botPresent: true,
        config: { communityHubs: { enabled: true } },
        id: 'guild-community-hub',
        name: 'Community Hub',
      }),
    ]);

    render(
      <DashboardShell>
        <div data-testid="content">Community hub content</div>
      </DashboardShell>,
    );

    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-title-sync')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('site-footer')).toBeInTheDocument();
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('renders the welcome route as a standalone setup page without dashboard chrome', () => {
    mockUsePathname.mockReturnValue('/dashboard/welcome');
    mockGuildDirectory([]);

    render(
      <DashboardShell>
        <div data-testid="content">Server picker</div>
      </DashboardShell>,
    );

    expect(screen.getByTestId('content')).toBeInTheDocument();
    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    expect(screen.getByTestId('site-footer')).toBeInTheDocument();
    expect(screen.queryByText('Opening server setup...')).not.toBeInTheDocument();
  });

  it('renders nested welcome routes as standalone setup pages without redirecting', () => {
    mockUsePathname.mockReturnValue('/dashboard/welcome/server');
    mockGuildDirectory([]);

    render(
      <DashboardShell>
        <div data-testid="content">Nested server picker</div>
      </DashboardShell>,
    );

    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByTestId('content')).toBeInTheDocument();
    expect(screen.queryByText('Opening server setup...')).not.toBeInTheDocument();
    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
  });

  it('routes users without installed manageable workspaces to the standalone welcome page', () => {
    mockGuildDirectory([
      makeGuild({
        access: 'admin',
        id: 'guild-needs-bot',
        name: 'Needs Volvox',
        permissions: '8',
      }),
    ]);

    render(
      <DashboardShell>
        <div data-testid="content">Dashboard content</div>
      </DashboardShell>,
    );

    expect(mockReplace).toHaveBeenCalledWith('/dashboard/welcome');
    expect(screen.getByText('Opening server setup...')).toBeInTheDocument();
    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
  });

  it('keeps normal dashboard chrome when bot presence is not authoritative', () => {
    mockGuildDirectory([
      makeGuild({
        access: 'admin',
        botPresenceAuthoritative: false,
        id: 'guild-fallback',
        name: 'Fallback Guild',
        permissions: '8',
      }),
    ]);

    render(
      <DashboardShell>
        <div data-testid="content">Dashboard content</div>
      </DashboardShell>,
    );

    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('renders standalone loading without dashboard chrome while guilds load', () => {
    mockGuildDirectory([], { loading: true });

    render(
      <DashboardShell>
        <div data-testid="content">Dashboard content</div>
      </DashboardShell>,
    );

    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByText('Opening server setup...')).toBeInTheDocument();
    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('content')).not.toBeInTheDocument();
  });
});
