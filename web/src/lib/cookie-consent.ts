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

/**
 * Returns the platform's `localStorage` object when it can be accessed, otherwise `null`.
 *
 * This function returns `null` in non-browser environments or when access to `localStorage` is unavailable or throws.
 *
 * @returns The `localStorage` `Storage` object when accessible, `null` otherwise.
 */
function getBrowserStorage(): Storage | null {
  if (typeof globalThis.window === 'undefined') {
    return null;
  }

  try {
    return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Create a new Date shifted by a specified number of days from the given date.
 *
 * @param date - The base date to offset
 * @param days - Number of days to add to `date` (may be negative to subtract days)
 * @returns A new Date representing the resulting day offset from `date`
 */
function addDays(date: Date, days: number): Date {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

/**
 * Checks whether an unknown value conforms to the stored cookie consent schema.
 *
 * @param value - The value to validate
 * @returns `true` if `value` matches the `StoredCookieConsent` structure (correct version, parseable ISO timestamps for `decidedAt` and `expiresAt`, `categories.essential === true`, and a boolean `categories.analytics`), `false` otherwise.
 */
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

/**
 * Dispatches a window `CustomEvent` to notify listeners of the current cookie consent state.
 *
 * No-ops when `globalThis.window` is undefined.
 *
 * @param consent - The stored consent to emit; pass `null` to indicate consent was cleared
 */
function emitConsentChanged(consent: StoredCookieConsent | null): void {
  if (typeof globalThis.window === 'undefined') {
    return;
  }

  globalThis.window.dispatchEvent(
    new CustomEvent<StoredCookieConsent | null>(COOKIE_CONSENT_CHANGED_EVENT, { detail: consent }),
  );
}

/**
 * Remove the persisted cookie-consent entry and notify listeners that consent has been cleared.
 *
 * @param storage - The Storage instance from which the consent entry will be removed
 */
function removeStoredConsentAndNotify(storage: Storage): void {
  try {
    storage.removeItem(COOKIE_CONSENT_STORAGE_KEY);
  } catch {
    // Storage cleanup can fail in restricted browser modes; state must still revoke consent.
  }

  emitConsentChanged(null);
}

/**
 * Reads and returns the stored cookie consent if present, valid, and not expired.
 *
 * @param now - Reference time used to determine whether stored consent is expired. Defaults to the current time.
 * @returns The stored `StoredCookieConsent` when a valid, unexpired record exists; `null` otherwise.
 */
export function readCookieConsent(now = new Date()): StoredCookieConsent | null {
  const storage = getBrowserStorage();

  if (!storage) {
    return null;
  }

  let rawConsent: string | null;

  try {
    rawConsent = storage.getItem(COOKIE_CONSENT_STORAGE_KEY);
  } catch {
    return null;
  }

  if (!rawConsent) {
    return null;
  }

  try {
    const parsedConsent = JSON.parse(rawConsent) as unknown;

    if (
      !isValidStoredConsent(parsedConsent) ||
      Date.parse(parsedConsent.expiresAt) <= now.getTime()
    ) {
      removeStoredConsentAndNotify(storage);
      return null;
    }

    return parsedConsent;
  } catch {
    removeStoredConsentAndNotify(storage);
    return null;
  }
}

/**
 * Determines whether the stored cookie consent currently permits analytics.
 *
 * @param now - Reference time used to evaluate consent expiration; defaults to the current time.
 * @returns `true` if a non-expired stored consent exists and `analytics` is enabled, `false` otherwise.
 */
export function hasAnalyticsConsent(now = new Date()): boolean {
  return readCookieConsent(now)?.categories.analytics === true;
}

/**
 * Persists the user's cookie consent and notifies listeners of the change.
 *
 * Constructs a versioned StoredCookieConsent record (with `essential: true` and the provided `analytics` value),
 * stores it in browser localStorage under the consent key, emits a consent-changed event, and returns the stored record.
 *
 * @param categories - The consent choices; `analytics` controls whether analytics cookies are allowed
 * @param now - Reference time used to set `decidedAt` and compute `expiresAt` (useful for testing)
 * @returns The stored `StoredCookieConsent` on success, `null` if storage is unavailable or saving fails
 */
export function saveCookieConsent(
  categories: CookieConsentInput,
  now = new Date(),
): StoredCookieConsent | null {
  const storage = getBrowserStorage();

  if (!storage) {
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
    storage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(consent));
    emitConsentChanged(consent);
    return consent;
  } catch {
    return null;
  }
}

/**
 * Removes any persisted cookie consent and notifies listeners that consent has been cleared.
 *
 * If browser storage is unavailable, this function does nothing.
 */
export function clearCookieConsent(): void {
  const storage = getBrowserStorage();

  if (!storage) {
    return;
  }

  removeStoredConsentAndNotify(storage);
}

/**
 * Requests that any cookie-preferences UI be opened by dispatching a global event.
 *
 * If `globalThis.window` is undefined (non-browser environment), this function does nothing.
 */
export function openCookiePreferences(): void {
  if (typeof globalThis.window === 'undefined') {
    return;
  }

  globalThis.window.dispatchEvent(new Event(COOKIE_PREFERENCES_OPEN_EVENT));
}
