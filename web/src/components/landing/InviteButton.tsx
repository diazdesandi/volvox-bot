'use client';

import { Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBotInvite } from '@/hooks/use-bot-invite';

interface InviteButtonProps {
  size?: 'sm' | 'lg';
  className?: string;
}

/** Render an "Add to Server" button — disabled/hidden when CLIENT_ID is unset. */
export function InviteButton({ size = 'sm', className }: InviteButtonProps) {
  const { inviteBot, isInviteConfigured } = useBotInvite();
  if (!isInviteConfigured) return null;

  return (
    <Button
      type="button"
      variant="discord"
      size={size}
      className={className}
      onClick={() => inviteBot()}
    >
      {size === 'lg' && <Bot className="mr-2 h-5 w-5" />}
      Add to Server
    </Button>
  );
}
