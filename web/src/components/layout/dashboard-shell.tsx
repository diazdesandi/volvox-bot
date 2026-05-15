'use client';

import { Loader2 } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect, useMemo } from 'react';
import { SiteFooter } from '@/components/layout/site-footer';
import { AnalyticsProvider } from '@/contexts/analytics-context';
import {
  DASHBOARD_WELCOME_ROUTE,
  isDashboardWelcomeRoute,
  shouldOpenDashboardWelcome,
} from '@/lib/workspace-access';
import { DashboardTitleSync } from './dashboard-title-sync';
import { useGuildDirectory } from './guild-directory-context';
import { Header } from './header';
import { Sidebar } from './sidebar';

interface DashboardShellProps {
  children: ReactNode;
}

function OpeningServerSetup() {
  return (
    <div
      role="status"
      className="flex min-h-[40vh] items-center justify-center rounded-lg border border-border/60 bg-card p-6 text-sm text-muted-foreground"
    >
      <Loader2 className="mr-3 h-4 w-4 animate-spin" />
      Opening server setup...
    </div>
  );
}

function StandaloneDashboardFrame({ children }: DashboardShellProps) {
  return (
    <div className="relative isolate flex h-[100dvh] w-full flex-col overflow-hidden bg-background text-foreground">
      <DashboardTitleSync />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.08),transparent_34rem)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.18] [background-image:linear-gradient(hsl(var(--border)/0.55)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.45)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:linear-gradient(to_bottom,black,transparent_75%)] dark:opacity-[0.12]"
      />
      <Header />
      <main className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-8">{children}</div>
        <SiteFooter />
      </main>
    </div>
  );
}

function DashboardChrome({ children }: DashboardShellProps) {
  return (
    <div className="dashboard-canvas relative flex h-[100dvh] w-full max-h-screen overflow-hidden bg-background">
      <DashboardTitleSync />

      {/* Desktop sidebar */}
      <aside className="hidden h-full min-h-0 w-[260px] shrink-0 flex-col border-r border-border/40 bg-background md:flex">
        <div className="relative min-h-0 flex-1 overflow-y-auto scrollbar-none">
          <Sidebar />
        </div>
      </aside>

      {/* Right side: Header + Content */}
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Header />

        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-thin">
          <div className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-8 lg:px-10">
            <div className="dashboard-fade-in pb-12">{children}</div>
          </div>
          <SiteFooter />
        </main>
      </div>
    </div>
  );
}

/**
 * Dashboard frame. Welcome/setup routes intentionally skip server chrome until
 * the bot is installed in a manageable workspace or an accessible community hub.
 */
export function DashboardShell({ children }: DashboardShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { error, guilds, loading } = useGuildDirectory();

  const isWelcomeRoute = isDashboardWelcomeRoute(pathname);
  const shouldOpenWelcome = useMemo(
    () => shouldOpenDashboardWelcome({ error, guilds, loading, pathname }),
    [error, guilds, loading, pathname],
  );

  useEffect(() => {
    if (shouldOpenWelcome) {
      router.replace(DASHBOARD_WELCOME_ROUTE);
    }
  }, [router, shouldOpenWelcome]);

  return (
    <AnalyticsProvider>
      {isWelcomeRoute ? (
        <StandaloneDashboardFrame>{children}</StandaloneDashboardFrame>
      ) : shouldOpenWelcome || loading ? (
        <StandaloneDashboardFrame>
          <OpeningServerSetup />
        </StandaloneDashboardFrame>
      ) : (
        <DashboardChrome>{children}</DashboardChrome>
      )}
    </AnalyticsProvider>
  );
}
