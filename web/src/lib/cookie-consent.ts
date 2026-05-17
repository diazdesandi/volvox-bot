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
 * Remove the persisted cookie-consent entry without notifying listeners.
 *
 * @param storage - The Storage instance from which the consent entry will be removed
 */
function removeStoredConsent(storage: Storage): void {
  try {
    storage.removeItem(COOKIE_CONSENT_STORAGE_KEY);
  } catch {
    // Storage cleanup can fail in restricted browser modes; state must still revoke consent.
  }
}

/**
 * Remove the persisted cookie-consent entry and notify listeners that consent has been cleared.
 *
 * @param storage - The Storage instance from which the consent entry will be removed
 */
function removeStoredConsentAndNotify(storage: Storage): void {
  removeStoredConsent(storage);
  emitConsentChanged(null);
}

/**
 * Reads the stored cookie consent decision for the current browser.
 *
 * Expired or structurally invalid consent is removed and emits a consent-change event with
 * `null`; malformed JSON is removed without dispatching a nested event.
 *
 * @param now - Clock value used to evaluate expiry.
 * @returns The stored consent record when present and valid, otherwise `null`.
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
    removeStoredConsent(storage);
    return null;
  }
}

/**
 * Checks whether analytics consent is currently granted for this browser.
 *
 * @param now - Clock value used to evaluate expiry.
 * @returns `true` only when a valid stored decision explicitly enables analytics.
 */
export function hasAnalyticsConsent(now = new Date()): boolean {
  return readCookieConsent(now)?.categories.analytics === true;
}

/**
 * Persists a cookie consent decision and notifies in-tab listeners.
 *
 * If storage is unavailable or the write fails, no decision is persisted and listeners are
 * notified with `null` so analytics state revokes conservatively for the current tab.
 *
 * @param categories - Optional-cookie categories selected by the user.
 * @param now - Clock value used for decision and expiry timestamps.
 * @returns The persisted consent record, or `null` when storage cannot save it.
 */
export function saveCookieConsent(
  categories: CookieConsentInput,
  now = new Date(),
): StoredCookieConsent | null {
  const storage = getBrowserStorage();

  if (!storage) {
    emitConsentChanged(null);
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
    emitConsentChanged(null);
    return null;
  }
}

/**
 * Clears the persisted consent decision and notifies in-tab listeners.
 *
 * @returns Nothing.
 */
export function clearCookieConsent(): void {
  const storage = getBrowserStorage();

  if (!storage) {
    return;
  }

  removeStoredConsentAndNotify(storage);
}

/**
 * Opens the cookie preferences dialog in the current tab.
 *
 * @returns Nothing.
 */
export function openCookiePreferences(): void {
  if (typeof globalThis.window === 'undefined') {
    return;
  }

  globalThis.window.dispatchEvent(new Event(COOKIE_PREFERENCES_OPEN_EVENT));
}
