import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockInviteBot, mockUseBotInvite } = vi.hoisted(() => ({
  mockInviteBot: vi.fn(),
  mockUseBotInvite: vi.fn(),
}));

vi.mock('@/hooks/use-bot-invite', () => ({
  useBotInvite: mockUseBotInvite,
}));

import { InviteButton } from '@/components/landing/InviteButton';

describe('InviteButton', () => {
  beforeEach(() => {
    mockInviteBot.mockReset();
    mockUseBotInvite.mockReset();
    mockUseBotInvite.mockReturnValue({
      inviteBot: mockInviteBot,
      isInviteConfigured: true,
    });
  });

  it('starts the dashboard-returning invite flow when clicked', async () => {
    const user = userEvent.setup();
    render(<InviteButton />);

    await user.click(screen.getByRole('button', { name: /Add to Server/i }));

    expect(mockInviteBot).toHaveBeenCalledOnce();
  });

  it('renders nothing when no invite flow is configured', () => {
    mockUseBotInvite.mockReturnValue({
      inviteBot: mockInviteBot,
      isInviteConfigured: false,
    });
    const { container } = render(<InviteButton />);

    expect(screen.queryByRole('button', { name: /Add to Server/i })).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
