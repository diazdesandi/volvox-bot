'use client';

import { AnalyticsDashboard } from '@/components/dashboard/analytics-dashboard';
import { ErrorBoundary } from '@/components/ui/error-boundary';

export function DashboardHome() {
  return (
    <ErrorBoundary
      title={'Analytics failed to load'}
      description={
        'There was a problem loading the dashboard analytics. Select a different server or try again.'
      }
    >
      <AnalyticsDashboard />
    </ErrorBoundary>
  );
}
