'use client';

import { Cookie } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  COOKIE_CONSENT_CHANGED_EVENT,
  COOKIE_PREFERENCES_OPEN_EVENT,
  readCookieConsent,
  type StoredCookieConsent,
  saveCookieConsent,
} from '@/lib/cookie-consent';
import { cn } from '@/lib/utils';

const COOKIE_SAVE_ERROR_MESSAGE =
  'Cookie preferences could not save in this browser. Check storage permissions and try again.';

/**
 * Determine the initial analytics preference from stored cookie consent.
 *
 * @param consent - The persisted cookie consent object or `null`
 * @returns `true` if stored consent explicitly enables analytics, `false` otherwise
 */
function getInitialAnalyticsPreference(consent: StoredCookieConsent | null): boolean {
  const categories = consent?.categories;

  return typeof categories === 'object' && typeof categories.analytics === 'boolean'
    ? categories.analytics
    : false;
}

/**
 * Renders a cookie consent banner and a preferences dialog for managing essential and analytics cookies.
 *
 * The component reads persisted consent on mount, listens for global cookie consent and preferences-open
 * events to stay in sync, and persists user choices when preferences are saved. It shows a fixed banner
 * when no consent is stored and the preferences dialog is closed, and exposes controls to accept all,
 * reject non-essential, or open a customization dialog that includes an analytics toggle. Displays an
 * inline error message if saving preferences fails.
 *
 * @returns The rendered banner and preferences dialog elements, or `null` while initial client-side state is loading.
 */
export function CookieConsentBanner() {
  const analyticsSwitchId = useId();
  const [hasMounted, setHasMounted] = useState(false);
  const [storedConsent, setStoredConsent] = useState<StoredCookieConsent | null>(null);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);

  useEffect(() => {
    const consent = readCookieConsent();

    setStoredConsent(consent);
    setAnalyticsEnabled(getInitialAnalyticsPreference(consent));
    setHasMounted(true);

    const handleConsentChanged = (event: Event) => {
      const nextConsent =
        event instanceof CustomEvent
          ? (event.detail as StoredCookieConsent | null)
          : readCookieConsent();
      setStoredConsent(nextConsent);
      setAnalyticsEnabled(getInitialAnalyticsPreference(nextConsent));
      setPreferenceError(null);
    };

    const handlePreferencesOpen = () => {
      const latestConsent = readCookieConsent();
      setStoredConsent(latestConsent);
      setAnalyticsEnabled(getInitialAnalyticsPreference(latestConsent));
      setPreferenceError(null);
      setIsPreferencesOpen(true);
    };

    globalThis.window.addEventListener(COOKIE_CONSENT_CHANGED_EVENT, handleConsentChanged);
    globalThis.window.addEventListener(COOKIE_PREFERENCES_OPEN_EVENT, handlePreferencesOpen);

    return () => {
      globalThis.window.removeEventListener(COOKIE_CONSENT_CHANGED_EVENT, handleConsentChanged);
      globalThis.window.removeEventListener(COOKIE_PREFERENCES_OPEN_EVENT, handlePreferencesOpen);
    };
  }, []);

  const savePreferences = (analytics: boolean) => {
    const consent = saveCookieConsent({ analytics });

    if (!consent) {
      setPreferenceError(COOKIE_SAVE_ERROR_MESSAGE);
      return;
    }

    setStoredConsent(consent);
    setAnalyticsEnabled(analytics);
    setPreferenceError(null);
    setIsPreferencesOpen(false);
  };

  if (!hasMounted) {
    return null;
  }

  const shouldShowBanner = !storedConsent && !isPreferencesOpen;

  const resetDraftPreferences = () => {
    setAnalyticsEnabled(getInitialAnalyticsPreference(storedConsent));
    setPreferenceError(null);
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      resetDraftPreferences();
    }

    setIsPreferencesOpen(open);
  };

  return (
    <>
      {shouldShowBanner && (
        <section
          aria-label="Cookie consent"
          className={cn(
            'fixed inset-x-3 bottom-3 z-50 mx-auto max-w-4xl rounded-2xl border',
            'border-border/70 bg-background/95 p-4 shadow-2xl shadow-black/20 backdrop-blur-xl',
            'sm:bottom-5 sm:p-5',
          )}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <div
                aria-hidden="true"
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border',
                  'border-border/50 bg-card/70',
                )}
              >
                <Cookie className="h-4 w-4 text-primary" />
              </div>
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-foreground">Cookie preferences</h2>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  Volvox.Bot uses essential cookies to keep the dashboard working. Analytics cookies
                  help us understand aggregate dashboard usage and stay off until you allow them.
                </p>
                {preferenceError && (
                  <p className="text-xs font-medium text-destructive" role="alert">
                    {preferenceError}
                  </p>
                )}
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-2 sm:min-w-52">
              <Button size="sm" onClick={() => savePreferences(true)}>
                Accept all
              </Button>
              <Button size="sm" variant="outline" onClick={() => savePreferences(false)}>
                Reject non-essential
              </Button>
              <Button
                size="sm"
                variant="ghost-primary"
                onClick={() => {
                  resetDraftPreferences();
                  setIsPreferencesOpen(true);
                }}
              >
                Customize
              </Button>
            </div>
          </div>
        </section>
      )}

      <Dialog open={isPreferencesOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent aria-describedby="cookie-preferences-description" className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Cookie preferences</DialogTitle>
            <DialogDescription id="cookie-preferences-description">
              Manage optional cookies for this browser. Essential cookies are required for security,
              authentication, and saved dashboard state.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-semibold text-foreground">Essential</p>
                  <p className="text-sm leading-6 text-muted-foreground sm:whitespace-nowrap">
                    Required for sign-in, security, and core dashboard behavior.
                  </p>
                </div>
                <span
                  className={cn(
                    'shrink-0 whitespace-nowrap rounded-full border',
                    'border-primary/30 bg-primary/10',
                    'px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary',
                  )}
                >
                  Always on
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <Label htmlFor={analyticsSwitchId} className="text-sm font-semibold">
                    Analytics
                  </Label>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Allows Amplitude analytics for aggregate dashboard usage.
                  </p>
                </div>
                <Switch
                  id={analyticsSwitchId}
                  aria-describedby="cookie-preferences-description"
                  checked={analyticsEnabled}
                  onCheckedChange={setAnalyticsEnabled}
                />
              </div>
            </div>
          </div>

          {preferenceError && (
            <p className="text-xs font-medium text-destructive" role="alert">
              {preferenceError}
            </p>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => savePreferences(false)}>
              Reject non-essential
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                variant="secondary"
                onClick={() => {
                  resetDraftPreferences();
                  setIsPreferencesOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button onClick={() => savePreferences(analyticsEnabled)}>Save preferences</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
