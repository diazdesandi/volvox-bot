import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CookieConsentBanner } from '@/components/cookie-consent-banner';
import {
  COOKIE_CONSENT_STORAGE_KEY,
  openCookiePreferences,
  readCookieConsent,
  saveCookieConsent,
} from '@/lib/cookie-consent';

describe('CookieConsentBanner', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('shows a first-visit banner and accepts all cookies', async () => {
    const user = userEvent.setup();

    render(<CookieConsentBanner />);

    expect(await screen.findByRole('region', { name: /cookie consent/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /accept all/i }));

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: /cookie consent/i })).not.toBeInTheDocument();
    });
    expect(readCookieConsent()?.categories).toEqual({
      essential: true,
      analytics: true,
    });
  });

  it('persists rejection of non-essential cookies', async () => {
    const user = userEvent.setup();

    render(<CookieConsentBanner />);

    await user.click(await screen.findByRole('button', { name: /reject non-essential/i }));

    expect(readCookieConsent()?.categories).toEqual({
      essential: true,
      analytics: false,
    });
    expect(screen.queryByRole('region', { name: /cookie consent/i })).not.toBeInTheDocument();
  });

  it('keeps the banner open and explains when preferences cannot be saved', async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'QuotaExceededError');
    });

    render(<CookieConsentBanner />);

    await user.click(await screen.findByRole('button', { name: /accept all/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i);
    expect(screen.getByRole('region', { name: /cookie consent/i })).toBeInTheDocument();
  });

  it('customizes analytics consent from the preferences dialog', async () => {
    const user = userEvent.setup();

    render(<CookieConsentBanner />);

    await user.click(await screen.findByRole('button', { name: /customize/i }));
    expect(screen.getByRole('dialog', { name: /cookie preferences/i })).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: /analytics/i }));
    await user.click(screen.getByRole('button', { name: /save preferences/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /cookie preferences/i })).not.toBeInTheDocument();
    });
    expect(readCookieConsent()?.categories.analytics).toBe(true);
  });

  it('does not show the banner after a saved decision and can reopen preferences later', async () => {
    const user = userEvent.setup();
    saveCookieConsent({ analytics: false }, new Date('2026-05-16T12:00:00.000Z'));

    render(<CookieConsentBanner />);

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: /cookie consent/i })).not.toBeInTheDocument();
    });

    openCookiePreferences();

    expect(await screen.findByRole('dialog', { name: /cookie preferences/i })).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: /analytics/i }));
    await user.click(screen.getByRole('button', { name: /save preferences/i }));

    expect(JSON.parse(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY) ?? '{}')).toMatchObject({
      categories: {
        essential: true,
        analytics: true,
      },
    });
  });
});
