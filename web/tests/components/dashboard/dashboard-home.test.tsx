import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardHome } from '@/components/dashboard/dashboard-home';

vi.mock('@/components/dashboard/analytics-dashboard', () => ({
  AnalyticsDashboard: () => <div>Analytics dashboard component</div>,
}));

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({
    children,
    description,
    title,
  }: {
    children: React.ReactNode;
    description?: string;
    title?: string;
  }) => (
    <section
      data-description={description}
      data-testid="analytics-error-boundary"
      data-title={title}
    >
      {children}
    </section>
  ),
}));

describe('DashboardHome', () => {
  it('renders the analytics dashboard', () => {
    render(<DashboardHome />);

    expect(screen.getByText('Analytics dashboard component')).toBeInTheDocument();
  });

  it('passes dashboard analytics fallback copy to the error boundary', () => {
    render(<DashboardHome />);

    expect(screen.getByTestId('analytics-error-boundary')).toHaveAttribute(
      'data-title',
      'Analytics failed to load',
    );
    expect(screen.getByTestId('analytics-error-boundary')).toHaveAttribute(
      'data-description',
      'There was a problem loading the dashboard analytics. Select a different server or try again.',
    );
  });
});
