'use client';

import { signIn } from 'next-auth/react';
import { useCallback } from 'react';
import { getBotInviteAuthorizationParams, getBotInviteUrl } from '@/lib/discord';
import { WELCOME_ROUTE } from '@/lib/routes';

function appendGuildId(callbackUrl: string, guildId: string): string {
  const hashIndex = callbackUrl.indexOf('#');
  const beforeHash = hashIndex === -1 ? callbackUrl : callbackUrl.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : callbackUrl.slice(hashIndex);
  const separator = beforeHash.includes('?')
    ? beforeHash.endsWith('?') || beforeHash.endsWith('&')
      ? ''
      : '&'
    : '?';

  return `${beforeHash}${separator}guildId=${encodeURIComponent(guildId)}${hash}`;
}

export function useBotInvite(defaultCallbackUrl = WELCOME_ROUTE): {
  inviteBot: (guildId?: string) => void;
  isInviteConfigured: boolean;
} {
  const isInviteConfigured = getBotInviteUrl() !== null;

  const inviteBot = useCallback(
    (guildId?: string) => {
      const normalizedGuildId = guildId?.trim();
      const callbackUrl = normalizedGuildId
        ? appendGuildId(defaultCallbackUrl, normalizedGuildId)
        : defaultCallbackUrl;

      void signIn(
        'discord',
        { callbackUrl },
        getBotInviteAuthorizationParams({
          disableGuildSelect: Boolean(normalizedGuildId),
          guildId: normalizedGuildId,
        }),
      );
    },
    [defaultCallbackUrl],
  );

  return {
    inviteBot,
    isInviteConfigured,
  };
}
