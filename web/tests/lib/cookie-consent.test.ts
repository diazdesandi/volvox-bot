import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COOKIE_CONSENT_CHANGED_EVENT,
  COOKIE_CONSENT_STORAGE_KEY,
  COOKIE_CONSENT_VERSION,
  clearCookieConsent,
  hasAnalyticsConsent,
  readCookieConsent,
  saveCookieConsent,
} from '@/lib/cookie-consent';

describe('cookie consent storage', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('persists essential and analytics consent with timestamp, version, and expiry', () => {
    const now = new Date('2026-05-16T12:00:00.000Z');
    const listener = vi.fn();
    window.addEventListener(COOKIE_CONSENT_CHANGED_EVENT, listener);

    const consent = saveCookieConsent({ analytics: true }, now);

    expect(consent).toEqual({
      version: COOKIE_CONSENT_VERSION,
      decidedAt: '2026-05-16T12:00:00.000Z',
      expiresAt: '2027-05-16T12:00:00.000Z',
      categories: {
        essential: true,
        analytics: true,
      },
    });
    expect(readCookieConsent(now)).toEqual(consent);
    expect(hasAnalyticsConsent(now)).toBe(true);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: consent }));

    window.removeEventListener(COOKIE_CONSENT_CHANGED_EVENT, listener);
  });

  it('stores rejected analytics consent without disabling essential cookies', () => {
    const now = new Date('2026-05-16T12:00:00.000Z');

    saveCookieConsent({ analytics: false }, now);

    expect(readCookieConsent(now)).toMatchObject({
      categories: {
        essential: true,
        analytics: false,
      },
    });
    expect(hasAnalyticsConsent(now)).toBe(false);
  });

  it('removes expired or invalid stored consent', () => {
    const expiredConsent = saveCookieConsent(
      { analytics: true },
      new Date('2026-05-16T12:00:00.000Z'),
    );
    const listener = vi.fn();

    expect(expiredConsent).not.toBeNull();
    window.addEventListener(COOKIE_CONSENT_CHANGED_EVENT, listener);

    expect(readCookieConsent(new Date('2028-05-16T12:00:00.000Z'))).toBeNull();
    expect(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)).toBeNull();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: null }));

    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, '{bad-json');
    listener.mockClear();

    expect(readCookieConsent()).toBeNull();
    expect(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)).toBeNull();
    expect(listener).not.toHaveBeenCalled();

    window.removeEventListener(COOKIE_CONSENT_CHANGED_EVENT, listener);
  });

  it('treats blocked storage reads as unavailable without retrying cleanup', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked storage', 'SecurityError');
    });
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Blocked storage', 'SecurityError');
    });

    expect(readCookieConsent()).toBeNull();
    expect(getItemSpy).toHaveBeenCalledWith(COOKIE_CONSENT_STORAGE_KEY);
    expect(removeItemSpy).not.toHaveBeenCalled();
  });

  it('emits a revocation event when consent cannot be saved', () => {
    const listener = vi.fn();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked storage', 'QuotaExceededError');
    });
    window.addEventListener(COOKIE_CONSENT_CHANGED_EVENT, listener);

    expect(saveCookieConsent({ analytics: true })).toBeNull();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: null }));

    window.removeEventListener(COOKIE_CONSENT_CHANGED_EVENT, listener);
  });

  it('clears stored consent and emits an update', () => {
    const listener = vi.fn();
    saveCookieConsent({ analytics: true }, new Date('2026-05-16T12:00:00.000Z'));
    window.addEventListener(COOKIE_CONSENT_CHANGED_EVENT, listener);

    clearCookieConsent();

    expect(readCookieConsent()).toBeNull();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: null }));

    window.removeEventListener(COOKIE_CONSENT_CHANGED_EVENT, listener);
  });
});
