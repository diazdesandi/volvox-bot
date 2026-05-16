import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MemberDetailPage from '@/app/dashboard/members/[userId]/page';

const { mockPush, mockReplace, mockGuildSelection, mockParams } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockReplace: vi.fn(),
  mockGuildSelection: vi.fn(),
  mockParams: { userId: 'user-1' } as Record<string, string>,
}));

vi.mock('next/navigation', () => ({
  useParams: () => mockParams,
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

vi.mock('next/image', () => ({
  default: ({ alt, ...props }: { alt: string; [key: string]: unknown }) => (
    // biome-ignore lint/a11y/useAltText: test double forwards the Next Image alt prop.
    <img alt={alt} {...props} />
  ),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/hooks/use-guild-selection', () => ({
  useGuildSelection: () => mockGuildSelection(),
}));

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

function memberPayload() {
  return {
    id: 'user-1',
    username: 'ada',
    displayName: 'Ada',
    avatar: null,
    roles: [{ id: 'role-1', name: 'Helper', color: '#000000' }],
    joinedAt: '2026-01-01T00:00:00Z',
    stats: {
      messages_sent: 10,
      reactions_given: 2,
      reactions_received: 3,
      days_active: 4,
      first_seen: null,
      last_active: null,
    },
    reputation: {
      xp: 200,
      level: 2,
      messages_count: 10,
      voice_minutes: 0,
      helps_given: 1,
      last_xp_gain: null,
      current_level_xp: 100,
      next_level_xp: 300,
    },
    warnings: {
      count: 1,
      recent: [
        {
          case_number: 99,
          action: 'warn',
          reason: 'Legacy warning should not render',
          moderator_tag: 'LegacyMod#0001',
          created_at: '2026-04-28T08:00:00Z',
        },
      ],
    },
  };
}

function historyPayload(page = 1) {
  return {
    userId: 'user-1',
    cases:
      page === 1
        ? [
            {
              id: 1,
              case_number: 12,
              action: 'warn',
              target_id: 'user-1',
              target_tag: 'Ada#0001',
              moderator_id: 'mod-1',
              moderator_tag: 'Mod#0001',
              reason: null,
              duration: null,
              expires_at: null,
              log_message_id: null,
              created_at: '2026-04-28T08:00:00Z',
            },
            {
              id: 2,
              case_number: 13,
              action: 'ban',
              target_id: 'user-1',
              target_tag: 'Ada#0001',
              moderator_id: 'mod-2',
              moderator_tag: 'Mod#0002',
              reason: 'raid spam',
              duration: null,
              expires_at: null,
              log_message_id: null,
              created_at: '2026-04-29T08:00:00Z',
            },
          ]
        : [
            {
              id: 3,
              case_number: 14,
              action: 'kick',
              target_id: 'user-1',
              target_tag: 'Ada#0001',
              moderator_id: 'mod-3',
              moderator_tag: 'Mod#0003',
              reason: 'page two case',
              duration: null,
              expires_at: null,
              log_message_id: null,
              created_at: '2026-04-30T08:00:00Z',
            },
          ],
    total: 3,
    page,
    limit: 10,
    pages: 2,
    byAction: { warn: 2, ban: 1 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGuildSelection.mockReturnValue('guild-1');
  mockParams.userId = 'user-1';
  vi.stubGlobal('fetch', vi.fn());
});

describe('MemberDetailPage moderation history', () => {
  it('fetches dedicated moderation history, renders breakdown, pagination, and full-history link', async () => {
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/guilds/guild-1/members/user-1')) {
        return Promise.resolve(jsonResponse(memberPayload()));
      }
      if (url.includes('/api/moderation/user/user-1/history')) {
        const page = new URL(url, 'http://localhost').searchParams.get('page');
        return Promise.resolve(jsonResponse(historyPayload(page === '2' ? 2 : 1)));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    render(<MemberDetailPage />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith('/api/guilds/guild-1/members/user-1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/moderation/user/user-1/history?guildId=guild-1&page=1&limit=10',
      { cache: 'no-store' },
    );

    expect(screen.getByRole('heading', { name: /moderation history/i })).toBeInTheDocument();
    expect(screen.getByText(/3 cases total/i)).toBeInTheDocument();
    const breakdown = screen.getByRole('list', { name: 'Moderation action breakdown' });
    expect(breakdown).toHaveTextContent('Warn2');
    expect(breakdown).toHaveTextContent('Ban1');
    expect(screen.getByText('raid spam')).toBeInTheDocument();
    expect(screen.queryByText('Legacy warning should not render')).not.toBeInTheDocument();

    expect(screen.getByRole('link', { name: /view full history/i })).toHaveAttribute(
      'href',
      '/dashboard/moderation?userId=user-1',
    );

    await userEvent.click(screen.getByRole('button', { name: /next history page/i }));
    await waitFor(() => expect(screen.getByText('page two case')).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith(
      '/api/moderation/user/user-1/history?guildId=guild-1&page=2&limit=10',
      { cache: 'no-store' },
    );
  });

  it('handles moderation history errors and redirects on unauthorized history fetches', async () => {
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/guilds/guild-1/members/user-1')) {
        return Promise.resolve(jsonResponse(memberPayload()));
      }
      if (url.includes('/api/moderation/user/user-1/history')) {
        return Promise.resolve(jsonResponse({ error: 'History failed' }, { status: 500 }));
      }
      return Promise.reject(new Error('Unexpected fetch: ' + url));
    });

    const errored = render(<MemberDetailPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('History failed'));
    errored.unmount();

    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.includes('/api/guilds/guild-1/members/user-1')) {
        return Promise.resolve(jsonResponse(memberPayload()));
      }
      if (url.includes('/api/moderation/user/user-1/history')) {
        return Promise.resolve(jsonResponse({}, { status: 401 }));
      }
      return Promise.reject(new Error('Unexpected fetch: ' + url));
    });

    render(<MemberDetailPage />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
  });
});
