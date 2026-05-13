import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetBotInviteAuthorizationParams, mockGetBotInviteUrl, mockSignIn } = vi.hoisted(() => ({
  mockGetBotInviteAuthorizationParams: vi.fn(),
  mockGetBotInviteUrl: vi.fn(),
  mockSignIn: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
  signIn: mockSignIn,
}));

vi.mock('@/lib/discord', () => ({
  getBotInviteAuthorizationParams: mockGetBotInviteAuthorizationParams,
  getBotInviteUrl: mockGetBotInviteUrl,
}));

import { useBotInvite } from '@/hooks/use-bot-invite';

describe('useBotInvite', () => {
  beforeEach(() => {
    mockGetBotInviteAuthorizationParams.mockReset();
    mockGetBotInviteUrl.mockReset();
    mockSignIn.mockReset();
    mockGetBotInviteUrl.mockReturnValue('https://discord.example/invite');
    mockGetBotInviteAuthorizationParams.mockReturnValue({ prompt: 'consent' });
  });

  it('appends guildId with ampersand when callback URL already has query params', () => {
    const { result } = renderHook(() => useBotInvite('/dashboard/welcome?from=settings'));

    act(() => {
      result.current.inviteBot(' guild 1 ');
    });

    expect(mockGetBotInviteAuthorizationParams).toHaveBeenCalledWith({
      disableGuildSelect: true,
      guildId: 'guild 1',
    });
    expect(mockSignIn).toHaveBeenCalledWith(
      'discord',
      { callbackUrl: '/dashboard/welcome?from=settings&guildId=guild%201' },
      { prompt: 'consent' },
    );
  });

  it('preserves callback URL unchanged when no guild is provided', () => {
    const { result } = renderHook(() => useBotInvite('/dashboard/welcome?from=settings'));

    act(() => {
      result.current.inviteBot('   ');
    });

    expect(mockGetBotInviteAuthorizationParams).toHaveBeenCalledWith({
      disableGuildSelect: false,
      guildId: '',
    });
    expect(mockSignIn).toHaveBeenCalledWith(
      'discord',
      { callbackUrl: '/dashboard/welcome?from=settings' },
      { prompt: 'consent' },
    );
  });
});
