import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/dashboard/dashboard-home', () => ({
  DashboardHome: () => <div data-testid="dashboard-home">Dashboard home</div>,
}));

vi.mock('@/lib/page-titles', () => ({
  createPageMetadata: (title: string, description: string) => ({ title, description }),
}));

import DashboardPage from '@/app/dashboard/page';

describe('DashboardPage', () => {
  it('renders DashboardHome', () => {
    render(<DashboardPage />);

    expect(screen.getByTestId('dashboard-home')).toBeInTheDocument();
  });

  it('does not render AnalyticsDashboard directly', () => {
    render(<DashboardPage />);

    // The old implementation wrapped AnalyticsDashboard in an ErrorBoundary;
    // after the PR, DashboardHome handles that internally.
    expect(screen.queryByText('Analytics failed to load')).not.toBeInTheDocument();
  });
});