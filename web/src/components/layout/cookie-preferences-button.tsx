'use client';

import type { ReactNode } from 'react';
import { openCookiePreferences } from '@/lib/cookie-consent';
import { cn } from '@/lib/utils';

interface CookiePreferencesButtonProps {
  readonly children?: ReactNode;
  readonly className?: string;
}

export function CookiePreferencesButton({
  children = 'Cookie Preferences',
  className,
}: CookiePreferencesButtonProps) {
  return (
    <button
      className={cn(
        'text-xs font-medium text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
      type="button"
      onClick={openCookiePreferences}
    >
      {children}
    </button>
  );
}
