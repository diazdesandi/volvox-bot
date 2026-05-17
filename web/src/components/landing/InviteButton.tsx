'use client';

import { Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBotInvite } from '@/hooks/use-bot-invite';

interface InviteButtonProps {
  size?: 'sm' | 'lg';
  className?: string;
}

/**
 * Render an "Add to Server" button that initiates the bot invite when invite configuration is available.
 *
 * @param size - Button size; `'lg'` renders a leading bot icon before the label
 * @param className - Additional CSS classes to apply to the button
 * @returns The button element, or `null` if inviting the bot is not configured
 */
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
