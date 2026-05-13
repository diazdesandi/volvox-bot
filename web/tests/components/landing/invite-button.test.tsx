import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetBotInviteUrl } = vi.hoisted(() => ({
  mockGetBotInviteUrl: vi.fn(),
}));

vi.mock('@/lib/discord', () => ({
  getBotInviteUrl: () => mockGetBotInviteUrl(),
}));

import { InviteButton } from '@/components/landing/InviteButton';

const inviteUrl = 'https://discord.com/api/oauth2/authorize?client_id=test&scope=bot';

describe('InviteButton', () => {
  beforeEach(() => {
    mockGetBotInviteUrl.mockReturnValue(inviteUrl);
  });

  it('renders a direct invite link that opens in a new tab', () => {
    render(<InviteButton />);

    const link = screen.getByRole('link', { name: /Add to Server/i });
    expect(link).toHaveAttribute('href', inviteUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders nothing when no invite URL is configured', () => {
    mockGetBotInviteUrl.mockReturnValue(null);
    const { container } = render(<InviteButton />);

    expect(screen.queryByRole('link', { name: /Add to Server/i })).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
