'use client';

import { openCookiePreferences } from '@/lib/cookie-consent';

export function CookiePreferencesButton() {
  return (
    <button
      className="text-xs font-medium text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      type="button"
      onClick={openCookiePreferences}
    >
      Cookie Preferences
    </button>
  );
}
