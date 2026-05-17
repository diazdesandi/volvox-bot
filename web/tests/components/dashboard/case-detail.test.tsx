import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CaseDetail } from '@/components/dashboard/case-detail';
import type { ModCase } from '@/components/dashboard/moderation-types';

const baseCase: ModCase = {
  id: 1,
  guild_id: 'guild-1',
  case_number: 42,
  action: 'warn',
  target_id: 'user-1',
  target_tag: 'Ada#0001',
  moderator_id: 'mod-1',
  moderator_tag: 'Mod#0001',
  reason: 'spam',
  duration: null,
  expires_at: null,
  log_message_id: 'log-message-123',
  created_at: '2026-04-28T08:00:00Z',
};

describe('CaseDetail', () => {
  it('renders a Discord log message link when guild, channel, and message ids are available', () => {
    render(<CaseDetail modCase={{ ...baseCase, channel_id: 'channel-1' }} />);

    expect(screen.getByRole('link', { name: 'log-message-123' })).toHaveAttribute(
      'href',
      'https://discord.com/channels/guild-1/channel-1/log-message-123',
    );
  });

  it('renders log_message_id as fallback text when no channel id is available for a deep link', () => {
    render(<CaseDetail modCase={baseCase} />);

    expect(screen.getByText('Log Message')).toBeInTheDocument();
    expect(screen.getByText('log-message-123')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /log-message-123/i })).not.toBeInTheDocument();
  });
});
