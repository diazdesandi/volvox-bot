import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/dashboard/welcome-server-picker', () => ({
  ConnectedWelcomeServerPicker: () => (
    <div data-testid="connected-welcome-server-picker">Connected welcome server picker</div>
  ),
}));

vi.mock('@/lib/page-titles', () => ({
  createPageMetadata: (title: string, description: string) => ({ title, description }),
}));

import DashboardWelcomePage from '@/app/dashboard/welcome/page';

describe('DashboardWelcomePage', () => {
  it('renders ConnectedWelcomeServerPicker', () => {
    render(<DashboardWelcomePage />);

    expect(screen.getByTestId('connected-welcome-server-picker')).toBeInTheDocument();
  });

  it('renders the expected page content', () => {
    render(<DashboardWelcomePage />);

    expect(screen.getByText('Connected welcome server picker')).toBeInTheDocument();
  });
});