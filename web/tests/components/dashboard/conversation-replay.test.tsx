import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationReplay } from '@/components/dashboard/conversation-replay';

const { mockTrackDashboardEvent } = vi.hoisted(() => ({
  mockTrackDashboardEvent: vi.fn(),
}));

vi.mock('@/lib/amplitude', () => ({
  DASHBOARD_AI_FEEDBACK_FAILED_EVENT: 'dashboard_ai_feedback_failed',
  DASHBOARD_AI_FEEDBACK_SUBMITTED_EVENT: 'dashboard_ai_feedback_submitted',
  trackDashboardEvent: mockTrackDashboardEvent,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
}));

vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  const SelectContext = React.createContext<(value: string) => void>(() => undefined);

  return {
    Select: ({
      children,
      onValueChange,
    }: {
      children: React.ReactNode;
      onValueChange: (value: string) => void;
    }) => <SelectContext.Provider value={onValueChange}>{children}</SelectContext.Provider>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => {
      const onValueChange = React.useContext(SelectContext);
      return (
        <button type="button" onClick={() => onValueChange(value)}>
          {children}
        </button>
      );
    },
    SelectTrigger: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  };
});

vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

const messages = [
  {
    id: 101,
    role: 'user' as const,
    content: 'Can you explain this?',
    username: 'member',
    userId: 'user-1',
    createdAt: '2026-05-08T12:00:00.000Z',
  },
  {
    id: 102,
    role: 'assistant' as const,
    content: 'Sure.',
    username: 'Volvox',
    createdAt: '2026-05-08T12:00:10.000Z',
  },
];

describe('ConversationReplay', () => {
  beforeEach(() => {
    mockTrackDashboardEvent.mockClear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })));
  });

  it('tracks AI feedback submissions without raw guild, channel, conversation, or message ids', async () => {
    const user = userEvent.setup();
    const onFlagSubmitted = vi.fn();

    render(
      <ConversationReplay
        channelId="channel-123"
        channelName="support"
        duration={65}
        guildId="guild-123"
        messages={messages}
        onFlagSubmitted={onFlagSubmitted}
        tokenEstimate={1200}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Flag AI response' }));
    await user.click(screen.getByRole('button', { name: 'Inaccurate information' }));
    await user.type(screen.getByLabelText('Notes (optional)'), 'wrong answer');
    await user.click(screen.getByRole('button', { name: 'Flag Response' }));

    await waitFor(() => expect(onFlagSubmitted).toHaveBeenCalled());
    expect(mockTrackDashboardEvent).toHaveBeenCalledWith('dashboard_ai_feedback_submitted', {
      hasNotes: true,
      messageRole: 'assistant',
      reason: 'inaccurate',
    });
    expect(JSON.stringify(mockTrackDashboardEvent.mock.calls)).not.toContain('guild-123');
    expect(JSON.stringify(mockTrackDashboardEvent.mock.calls)).not.toContain('channel-123');
    expect(JSON.stringify(mockTrackDashboardEvent.mock.calls)).not.toContain('101');
    expect(JSON.stringify(mockTrackDashboardEvent.mock.calls)).not.toContain('102');
  });

  it('tracks feedback submission with hasNotes false when no notes provided', async () => {
    const user = userEvent.setup();
    const onFlagSubmitted = vi.fn();

    render(
      <ConversationReplay
        channelId="channel-123"
        channelName="support"
        duration={30}
        guildId="guild-123"
        messages={messages}
        onFlagSubmitted={onFlagSubmitted}
        tokenEstimate={500}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Flag AI response' }));
    await user.click(screen.getByRole('button', { name: 'Off-topic response' }));
    // Do not type any notes
    await user.click(screen.getByRole('button', { name: 'Flag Response' }));

    await waitFor(() => expect(onFlagSubmitted).toHaveBeenCalled());
    expect(mockTrackDashboardEvent).toHaveBeenCalledWith('dashboard_ai_feedback_submitted', {
      hasNotes: false,
      messageRole: 'assistant',
      reason: 'off-topic',
    });
  });

  it('tracks DASHBOARD_AI_FEEDBACK_FAILED_EVENT when the flag request fails', async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      }),
    );

    render(
      <ConversationReplay
        channelId="channel-123"
        channelName="support"
        duration={65}
        guildId="guild-123"
        messages={messages}
        tokenEstimate={1200}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Flag AI response' }));
    await user.click(screen.getByRole('button', { name: 'Inappropriate content' }));
    await user.click(screen.getByRole('button', { name: 'Flag Response' }));

    await waitFor(() =>
      expect(mockTrackDashboardEvent).toHaveBeenCalledWith('dashboard_ai_feedback_failed', {
        failureReason: 'request_failed',
        hasNotes: false,
        messageRole: 'assistant',
        reason: 'inappropriate',
      }),
    );
    expect(mockTrackDashboardEvent).not.toHaveBeenCalledWith(
      'dashboard_ai_feedback_submitted',
      expect.anything(),
    );
  });

  it('tracks DASHBOARD_AI_FEEDBACK_FAILED_EVENT with messageRole "unknown" when message id is not found', async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({}),
      }),
    );

    const { rerender } = render(
      <ConversationReplay
        channelId="channel-123"
        channelName="support"
        duration={65}
        guildId="guild-123"
        messages={messages}
        tokenEstimate={1200}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Flag AI response' }));
    rerender(
      <ConversationReplay
        channelId="channel-123"
        channelName="support"
        duration={65}
        guildId="guild-123"
        messages={messages.slice(0, 1)}
        tokenEstimate={1200}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Potentially harmful' }));
    await user.click(screen.getByRole('button', { name: 'Flag Response' }));

    await waitFor(() =>
      expect(mockTrackDashboardEvent).toHaveBeenCalledWith('dashboard_ai_feedback_failed', {
        failureReason: 'request_failed',
        hasNotes: false,
        messageRole: 'unknown',
        reason: 'harmful',
      }),
    );
  });
});
