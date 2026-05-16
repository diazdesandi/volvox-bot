export const COOKIE_CONSENT_STORAGE_KEY = 'volvox.cookieConsent.v1';
export const COOKIE_CONSENT_CHANGED_EVENT = 'volvox:cookie-consent-changed';
export const COOKIE_PREFERENCES_OPEN_EVENT = 'volvox:cookie-preferences-open';
export const COOKIE_CONSENT_VERSION = 1;
export const COOKIE_CONSENT_EXPIRY_DAYS = 365;

export interface CookieConsentCategories {
  readonly essential: true;
  readonly analytics: boolean;
}

export interface StoredCookieConsent {
  readonly version: number;
  readonly decidedAt: string;
  readonly expiresAt: string;
  readonly categories: CookieConsentCategories;
}

export interface CookieConsentInput {
  readonly analytics: boolean;
}

function isBrowserStorageAvailable(): boolean {
  return typeof globalThis.window !== 'undefined' && typeof globalThis.localStorage !== 'undefined';
}

function addDays(date: Date, days: number): Date {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function isValidStoredConsent(value: unknown): value is StoredCookieConsent {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const consent = value as Partial<StoredCookieConsent>;
  const categories = consent.categories as Partial<CookieConsentCategories> | undefined;

  return (
    consent.version === COOKIE_CONSENT_VERSION &&
    typeof consent.decidedAt === 'string' &&
    Number.isFinite(Date.parse(consent.decidedAt)) &&
    typeof consent.expiresAt === 'string' &&
    Number.isFinite(Date.parse(consent.expiresAt)) &&
    categories?.essential === true &&
    typeof categories.analytics === 'boolean'
  );
}

function emitConsentChanged(consent: StoredCookieConsent | null): void {
  if (typeof globalThis.window === 'undefined') {
    return;
  }

  globalThis.window.dispatchEvent(
    new CustomEvent<StoredCookieConsent | null>(COOKIE_CONSENT_CHANGED_EVENT, { detail: consent }),
  );
}

export function readCookieConsent(now = new Date()): StoredCookieConsent | null {
  if (!isBrowserStorageAvailable()) {
    return null;
  }

  try {
    const rawConsent = globalThis.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);

    if (!rawConsent) {
      return null;
    }

    const parsedConsent = JSON.parse(rawConsent) as unknown;

    if (
      !isValidStoredConsent(parsedConsent) ||
      Date.parse(parsedConsent.expiresAt) <= now.getTime()
    ) {
      globalThis.localStorage.removeItem(COOKIE_CONSENT_STORAGE_KEY);
      return null;
    }

    return parsedConsent;
  } catch {
    globalThis.localStorage.removeItem(COOKIE_CONSENT_STORAGE_KEY);
    return null;
  }
}

export function hasAnalyticsConsent(now = new Date()): boolean {
  return readCookieConsent(now)?.categories.analytics === true;
}

export function saveCookieConsent(
  categories: CookieConsentInput,
  now = new Date(),
): StoredCookieConsent | null {
  if (!isBrowserStorageAvailable()) {
    return null;
  }

  const consent: StoredCookieConsent = {
    version: COOKIE_CONSENT_VERSION,
    decidedAt: now.toISOString(),
    expiresAt: addDays(now, COOKIE_CONSENT_EXPIRY_DAYS).toISOString(),
    categories: {
      essential: true,
      analytics: categories.analytics,
    },
  };

  try {
    globalThis.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(consent));
    emitConsentChanged(consent);
    return consent;
  } catch {
    return null;
  }
}

export function clearCookieConsent(): void {
  if (!isBrowserStorageAvailable()) {
    return;
  }

  globalThis.localStorage.removeItem(COOKIE_CONSENT_STORAGE_KEY);
  emitConsentChanged(null);
}

export function openCookiePreferences(): void {
  if (typeof globalThis.window === 'undefined') {
    return;
  }

  globalThis.window.dispatchEvent(new Event(COOKIE_PREFERENCES_OPEN_EVENT));
}
