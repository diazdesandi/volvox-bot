import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SiteFooter } from '@/components/layout/site-footer';

const { mockOpenCookiePreferences } = vi.hoisted(() => ({
  mockOpenCookiePreferences: vi.fn(),
}));

vi.mock('@/lib/cookie-consent', () => ({
  openCookiePreferences: mockOpenCookiePreferences,
}));

describe('SiteFooter', () => {
  it('provides a cookie preferences control', async () => {
    const user = userEvent.setup();

    render(<SiteFooter />);

    await user.click(screen.getByRole('button', { name: /cookie preferences/i }));

    expect(mockOpenCookiePreferences).toHaveBeenCalledOnce();
  });
});
