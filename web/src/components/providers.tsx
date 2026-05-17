'use client';

import * as Sentry from '@sentry/nextjs';
import { usePathname } from 'next/navigation';
import { SessionProvider, useSession } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Toaster } from 'sonner';
import { CookieConsentBanner } from '@/components/cookie-consent-banner';
import { ThemeProvider } from '@/components/theme-provider';
import { useGuildSelection } from '@/hooks/use-guild-selection';
import {
  DASHBOARD_GUILD_SELECTED_EVENT,
  DASHBOARD_PAGE_VIEW_EVENT,
  initDashboardAmplitude,
  resetDashboardAmplitude,
  trackDashboardEvent,
} from '@/lib/amplitude';
import {
  COOKIE_CONSENT_CHANGED_EVENT,
  hasAnalyticsConsent,
  type StoredCookieConsent,
} from '@/lib/cookie-consent';

function isDashboardRoute(pathname: string | null): pathname is string {
  return pathname === '/dashboard' || pathname?.startsWith('/dashboard/') === true;
}

const DASHBOARD_ROUTE_PARAMETERS: Record<string, string> = {
  conversations: '[conversationId]',
  members: '[userId]',
  settings: '[category]',
  tickets: '[ticketId]',
};

const COMMUNITY_ROUTE_PARAMETERS = ['[guildId]', '[userId]'] as const;

function getCommunityTelemetryRoute(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);

  if (segments[0] !== 'community' || segments.length < 2) {
    return pathname;
  }

  return `/${[
    'community',
    ...segments.slice(1).map((segment, index) => COMMUNITY_ROUTE_PARAMETERS[index] ?? segment),
  ].join('/')}`;
}

function getDashboardTelemetryRoute(pathname: string | null): string {
  if (!pathname) {
    return 'unknown';
  }

  if (!isDashboardRoute(pathname)) {
    return getCommunityTelemetryRoute(pathname);
  }

  const segments = pathname.split('/').filter(Boolean);
  const routeSection = segments[1];

  if (!routeSection || segments.length < 3) {
    return pathname;
  }

  const routeParameter = DASHBOARD_ROUTE_PARAMETERS[routeSection];

  if (!routeParameter) {
    return pathname;
  }

  return `/${['dashboard', routeSection, routeParameter, ...segments.slice(3)].join('/')}`;
}

function getGuildTelemetryScope(guildId: string | null): 'none' | 'selected' {
  return guildId ? 'selected' : 'none';
}

function useAnalyticsConsent() {
  const [analyticsConsent, setAnalyticsConsent] = useState<boolean | null>(null);

  useEffect(() => {
    setAnalyticsConsent(hasAnalyticsConsent());

    const handleConsentChanged = (event: Event) => {
      if (event instanceof CustomEvent) {
        const consent = event.detail as StoredCookieConsent | null;
        setAnalyticsConsent(consent?.categories.analytics === true);
        return;
      }

      setAnalyticsConsent(hasAnalyticsConsent());
    };

    globalThis.window.addEventListener(COOKIE_CONSENT_CHANGED_EVENT, handleConsentChanged);
    return () => {
      globalThis.window.removeEventListener(COOKIE_CONSENT_CHANGED_EVENT, handleConsentChanged);
    };
  }, []);

  return analyticsConsent;
}

/**
 * Render a global Toaster that follows the resolved application theme.
 *
 * @returns A React element mounting a Toaster at the bottom-right with its theme set to 'light' or 'dark' when available, otherwise 'dark'; `richColors` enabled.
 */
function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      position="bottom-right"
      theme={(resolvedTheme as 'light' | 'dark') ?? 'dark'}
      richColors
    />
  );
}

/**
 * Synchronizes Sentry context with the current route and dashboard guild scope.
 *
 * Updates Sentry's `routing` context with the current pathname (or `unknown`) and
 * only attaches `guild` context for authenticated dashboard routes with a selected
 * guild. The guild context is cleared everywhere else so persisted dashboard state
 * does not leak into public routes.
 *
 * @returns `null` — the component does not render any UI.
 */
function SentryContextBridge() {
  const pathname = usePathname();
  const guildId = useGuildSelection();
  const { status } = useSession();
  const isAuthenticatedDashboardRoute = status === 'authenticated' && isDashboardRoute(pathname);
  const telemetryRoute = getDashboardTelemetryRoute(pathname);

  useEffect(() => {
    Sentry.setContext('routing', { route: telemetryRoute });

    if (isAuthenticatedDashboardRoute && guildId) {
      Sentry.setContext('guild', { selection: getGuildTelemetryScope(guildId) });
      return;
    }

    Sentry.setContext('guild', null);
  }, [guildId, isAuthenticatedDashboardRoute, telemetryRoute]);

  return null;
}

/**
 * Synchronizes Amplitude: initializes it with the current authenticated user and records dashboard page-view events once per route.
 *
 * The emitted event includes the current `authStatus`, coarse `guildSelection`, and `route` (defaults to `'unknown'` when not set).
 *
 * @returns `null` (this component does not render UI)
 */
function AmplitudeContextBridge() {
  const pathname = usePathname();
  const guildId = useGuildSelection();
  const { data: session, status } = useSession();
  const hasConsentedToAnalytics = useAnalyticsConsent();
  const userId = status === 'authenticated' ? session?.user?.id : null;
  const lastTrackedGuildIdRef = useRef<string | null | undefined>(undefined);
  const lastTrackedRouteRef = useRef<string | null>(null);
  const telemetryRoute = getDashboardTelemetryRoute(pathname);
  const isAuthenticatedDashboardRoute = status === 'authenticated' && isDashboardRoute(pathname);

  useEffect(() => {
    if (hasConsentedToAnalytics === null) {
      return;
    }

    if (!hasConsentedToAnalytics) {
      resetDashboardAmplitude();
      return;
    }

    initDashboardAmplitude(userId);
  }, [hasConsentedToAnalytics, userId]);

  useEffect(() => {
    if (hasConsentedToAnalytics === null) {
      return;
    }

    if (!hasConsentedToAnalytics) {
      lastTrackedRouteRef.current = null;
      return;
    }

    if (!isDashboardRoute(pathname)) {
      lastTrackedRouteRef.current = null;
      return;
    }

    if (status === 'loading') {
      return;
    }

    if (lastTrackedRouteRef.current === telemetryRoute) {
      return;
    }

    lastTrackedRouteRef.current = telemetryRoute;
    trackDashboardEvent(DASHBOARD_PAGE_VIEW_EVENT, {
      authStatus: status,
      guildSelection: getGuildTelemetryScope(guildId),
      route: telemetryRoute,
    });
  }, [guildId, hasConsentedToAnalytics, pathname, status, telemetryRoute]);

  useEffect(() => {
    if (hasConsentedToAnalytics === null) {
      return;
    }

    if (!hasConsentedToAnalytics) {
      lastTrackedGuildIdRef.current = undefined;
      return;
    }

    if (!isAuthenticatedDashboardRoute) {
      lastTrackedGuildIdRef.current = undefined;
      return;
    }

    const previousGuildId = lastTrackedGuildIdRef.current;
    lastTrackedGuildIdRef.current = guildId;

    if (previousGuildId === undefined || previousGuildId === guildId || !guildId) {
      return;
    }

    trackDashboardEvent(DASHBOARD_GUILD_SELECTED_EVENT, {
      guildSelection: getGuildTelemetryScope(guildId),
      route: telemetryRoute,
    });
  }, [guildId, hasConsentedToAnalytics, isAuthenticatedDashboardRoute, telemetryRoute]);

  return null;
}

/**
 * Composes application context providers (authentication and theme), mounts telemetry bridges, and renders global UI chrome.
 *
 * @param children - The application UI to render inside the provider tree
 * @returns A React element containing the provider tree that wraps `children`, mounts Sentry and Amplitude context bridges, and renders the themed global Toaster
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
        <SentryContextBridge />
        <AmplitudeContextBridge />
        {children}
        <CookieConsentBanner />
        <ThemedToaster />
      </ThemeProvider>
    </SessionProvider>
  );
}
