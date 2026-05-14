import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConnectedWelcomeServerPicker,
  WelcomeServerPicker,
} from '@/components/dashboard/welcome-server-picker';
import type { MutualGuild } from '@/types/discord';

const { mockGuildDirectory, mockInviteBot, mockIsInviteConfigured, mockPush, mockSearchParams } =
  vi.hoisted(() => ({
    mockGuildDirectory: {
      value: {
        error: false,
        guilds: [] as MutualGuild[],
        loading: false,
        refreshGuilds: vi.fn(),
      },
    },
    mockInviteBot: vi.fn(),
    mockIsInviteConfigured: { value: true },
    mockPush: vi.fn(),
    mockSearchParams: { value: new URLSearchParams() },
  }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  useSearchParams: () => mockSearchParams.value,
}));

vi.mock('@/components/layout/guild-directory-context', () => ({
  useGuildDirectory: () => mockGuildDirectory.value,
}));

vi.mock('@/hooks/use-bot-invite', () => ({
  useBotInvite: () => ({
    inviteBot: mockInviteBot,
    isInviteConfigured: mockIsInviteConfigured.value,
  }),
}));

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

describe('WelcomeServerPicker', () => {
  beforeEach(() => {
    mockInviteBot.mockReset();
    mockIsInviteConfigured.value = true;
    mockPush.mockReset();
    mockSearchParams.value = new URLSearchParams();
    mockGuildDirectory.value = {
      error: false,
      guilds: [],
      loading: false,
      refreshGuilds: vi.fn(),
    };
    window.localStorage.clear();
  });

  it('renders manageable server rows with member counts and direct actions', () => {
    render(
      <WelcomeServerPicker
        error={false}
        guilds={[
          makeGuild({
            access: 'owner',
            botPresent: true,
            id: 'guild-managed',
            memberCount: 128,
            name: 'Managed HQ',
            owner: true,
            permissions: '8',
          }),
          makeGuild({
            access: 'admin',
            id: 'guild-add',
            memberCount: 42,
            name: 'Needs Volvox',
            permissions: '8',
          }),
          makeGuild({
            id: 'guild-viewer',
            memberCount: 12,
            name: 'Viewer Cave',
          }),
        ]}
        loading={false}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Set up Volvox.Bot' })).toBeInTheDocument();
    expect(screen.getByLabelText('Server summary')).toHaveTextContent(
      '3 servers found, 1 installed, 1 needs bot',
    );
    expect(screen.queryByText('Server access')).not.toBeInTheDocument();
    expect(screen.queryByText('Add ready')).not.toBeInTheDocument();

    const managedRow = screen.getByTestId('server-picker-row-guild-managed');
    expect(within(managedRow).getByText('Managed HQ')).toBeInTheDocument();
    expect(within(managedRow).getAllByText('128 members')).toHaveLength(2);
    expect(within(managedRow).getByRole('button', { name: /manage managed hq/i })).toBeInTheDocument();

    const addRow = screen.getByTestId('server-picker-row-guild-add');
    expect(within(addRow).getByText('Needs Volvox')).toBeInTheDocument();
    expect(within(addRow).getAllByText('42 members')).toHaveLength(2);
    expect(within(addRow).getByRole('button', { name: /add bot to needs volvox/i })).toBeInTheDocument();

    expect(screen.queryByText('Status')).not.toBeInTheDocument();
    expect(screen.queryByText('Bot installed')).not.toBeInTheDocument();
    expect(screen.queryByText('Needs bot')).not.toBeInTheDocument();
    expect(screen.getByText('Viewer-only access')).toBeInTheDocument();
    expect(screen.getByText('Viewer Cave')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^add bot/i })).toHaveLength(1);
  });

  it('sorts manageable and viewer-only servers alphabetically', () => {
    render(
      <WelcomeServerPicker
        error={false}
        guilds={[
          makeGuild({
            access: 'owner',
            botPresent: true,
            id: 'guild-zeta',
            name: 'Zeta Server',
            owner: true,
            permissions: '8',
          }),
          makeGuild({
            access: 'admin',
            id: 'guild-alpha',
            name: 'alpha Server',
            permissions: '8',
          }),
          makeGuild({
            access: 'admin',
            id: 'guild-beta',
            name: 'Beta Server',
            permissions: '8',
          }),
          makeGuild({
            id: 'viewer-zeta',
            name: 'Zeta Viewer',
          }),
          makeGuild({
            id: 'viewer-alpha',
            name: 'Alpha Viewer',
          }),
        ]}
        loading={false}
        onRefresh={vi.fn()}
      />,
    );

    const manageableServerNames = screen
      .getAllByTestId(/^server-picker-row-/)
      .map((row) => within(row).getByRole('heading').textContent);

    expect(manageableServerNames).toEqual(['alpha Server', 'Beta Server', 'Zeta Server']);

    const alphaViewer = screen.getByText('Alpha Viewer');
    const zetaViewer = screen.getByText('Zeta Viewer');
    expect(alphaViewer.compareDocumentPosition(zetaViewer)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('starts a combined OAuth invite through the shared invite hook', async () => {
    const user = userEvent.setup();

    render(
      <WelcomeServerPicker
        error={false}
        guilds={[
          makeGuild({
            access: 'admin',
            id: 'guild-add',
            memberCount: 42,
            name: 'Needs Volvox',
            permissions: '8',
          }),
        ]}
        loading={false}
        onRefresh={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /add bot to needs volvox/i }));

    expect(mockInviteBot).toHaveBeenCalledWith('guild-add');
  });

  it('does not expose add bot actions when invite flow is not configured', () => {
    mockIsInviteConfigured.value = false;

    render(
      <WelcomeServerPicker
        error={false}
        guilds={[
          makeGuild({
            access: 'admin',
            id: 'guild-add',
            memberCount: 42,
            name: 'Needs Volvox',
            permissions: '8',
          }),
        ]}
        loading={false}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /add bot to needs volvox/i })).not.toBeInTheDocument();
    expect(screen.getByText(/invite link unavailable/i)).toBeInTheDocument();
    expect(screen.getByText('NEXT_PUBLIC_DISCORD_CLIENT_ID')).toBeInTheDocument();
    expect(mockInviteBot).not.toHaveBeenCalled();
  });

  it('persists the selected guild before opening the management dashboard', async () => {
    const user = userEvent.setup();

    render(
      <WelcomeServerPicker
        error={false}
        guilds={[
          makeGuild({
            access: 'owner',
            botPresent: true,
            id: 'guild-managed',
            memberCount: 128,
            name: 'Managed HQ',
            owner: true,
            permissions: '8',
          }),
        ]}
        loading={false}
        onRefresh={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /manage managed hq/i }));

    expect(window.localStorage.getItem('volvox-bot-selected-guild')).toBe('guild-managed');
    expect(mockPush).toHaveBeenCalledWith('/dashboard');
  });

  it('auto-selects a target guild from the callback query once it is manageable and installed', async () => {
    const { rerender } = render(
      <WelcomeServerPicker
        autoSelectGuildId="guild-managed"
        error={false}
        guilds={[
          makeGuild({
            access: 'owner',
            botPresent: true,
            id: 'guild-managed',
            memberCount: 128,
            name: 'Managed HQ',
            owner: true,
            permissions: '8',
          }),
        ]}
        loading={false}
        onRefresh={vi.fn()}
      />,
    );

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
    expect(window.localStorage.getItem('volvox-bot-selected-guild')).toBe('guild-managed');

    rerender(
      <WelcomeServerPicker
        autoSelectGuildId="guild-managed"
        error={false}
        guilds={[
          makeGuild({
            access: 'owner',
            botPresent: true,
            id: 'guild-managed',
            memberCount: 128,
            name: 'Managed HQ',
            owner: true,
            permissions: '8',
          }),
        ]}
        loading={false}
        onRefresh={vi.fn()}
      />,
    );

    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('waits on the welcome page until the callback guild is manageable with bot access', async () => {
    const { rerender } = render(
      <WelcomeServerPicker
        autoSelectGuildId="guild-add"
        error={false}
        guilds={[
          makeGuild({
            access: 'admin',
            botPresent: false,
            botPresenceAuthoritative: true,
            id: 'guild-add',
            name: 'Needs Volvox',
            permissions: '8',
          }),
        ]}
        loading={false}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('Needs Volvox')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();

    rerender(
      <WelcomeServerPicker
        autoSelectGuildId="guild-add"
        error={false}
        guilds={[
          makeGuild({
            access: 'admin',
            botPresent: true,
            id: 'guild-add',
            name: 'Needs Volvox',
            permissions: '8',
          }),
        ]}
        loading={false}
        onRefresh={vi.fn()}
      />,
    );

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
    expect(window.localStorage.getItem('volvox-bot-selected-guild')).toBe('guild-add');
  });

  it('treats degraded bot presence as sufficient for direct management', async () => {
    render(
      <WelcomeServerPicker
        error={false}
        guilds={[
          makeGuild({
            access: 'moderator',
            botPresent: false,
            botPresenceAuthoritative: false,
            id: 'guild-degraded',
            name: 'Degraded HQ',
            permissions: '32',
          }),
        ]}
        loading={false}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Server summary')).toHaveTextContent(
      '1 server found, 1 installed, 0 need bot',
    );
    expect(screen.getByRole('button', { name: /manage degraded hq/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add bot to degraded hq/i })).not.toBeInTheDocument();
  });

  it('treats degraded bot presence as sufficient for callback guild selection', async () => {
    render(
      <WelcomeServerPicker
        autoSelectGuildId="guild-degraded"
        error={false}
        guilds={[
          makeGuild({
            access: 'moderator',
            botPresent: false,
            botPresenceAuthoritative: false,
            id: 'guild-degraded',
            name: 'Degraded HQ',
            permissions: '32',
          }),
        ]}
        loading={false}
        onRefresh={vi.fn()}
      />,
    );

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
    expect(window.localStorage.getItem('volvox-bot-selected-guild')).toBe('guild-degraded');
  });

  it('reads the callback guildId from search params in the connected picker', async () => {
    mockSearchParams.value = new URLSearchParams('guildId=guild-managed');
    mockGuildDirectory.value = {
      error: false,
      guilds: [
        makeGuild({
          access: 'owner',
          botPresent: true,
          id: 'guild-managed',
          name: 'Managed HQ',
          owner: true,
          permissions: '8',
        }),
      ],
      loading: false,
      refreshGuilds: vi.fn(),
    };

    render(<ConnectedWelcomeServerPicker />);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
    expect(window.localStorage.getItem('volvox-bot-selected-guild')).toBe('guild-managed');
  });

  it('handles viewer-only access with a refresh action instead of exposing invite controls', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();

    render(
      <WelcomeServerPicker
        error={false}
        guilds={[makeGuild({ id: 'guild-viewer', name: 'Viewer Cave' })]}
        loading={false}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Set up Volvox.Bot' })).toBeInTheDocument();
    expect(screen.getByText('No servers you can manage')).toBeInTheDocument();
    expect(screen.getByText('Viewer-only access')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^add bot/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /refresh/i }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
