'use client';

import * as amplitude from '@amplitude/analytics-browser';
import { hasAnalyticsConsent } from './cookie-consent';
import { isSensitiveKey, redactInlineSecrets } from './redaction';

export const DASHBOARD_PAGE_VIEW_EVENT = 'dashboard_page_viewed';
export const DASHBOARD_GUILD_SELECTED_EVENT = 'dashboard_guild_selected';
export const DASHBOARD_AUTH_STARTED_EVENT = 'dashboard_auth_started';
export const DASHBOARD_CONFIG_SAVE_ATTEMPTED_EVENT = 'dashboard_config_save_attempted';
export const DASHBOARD_CONFIG_SAVED_EVENT = 'dashboard_config_saved';
export const DASHBOARD_CONFIG_SAVE_FAILED_EVENT = 'dashboard_config_save_failed';
export const DASHBOARD_ANALYTICS_REFRESHED_EVENT = 'dashboard_analytics_refreshed';
export const DASHBOARD_ANALYTICS_REFRESH_FAILED_EVENT = 'dashboard_analytics_refresh_failed';
export const DASHBOARD_ANALYTICS_EXPORTED_EVENT = 'dashboard_analytics_exported';
export const DASHBOARD_ANALYTICS_FILTER_CHANGED_EVENT = 'dashboard_analytics_filter_changed';
export const DASHBOARD_WELCOME_PUBLISHED_EVENT = 'dashboard_welcome_published';
export const DASHBOARD_WELCOME_PUBLISH_FAILED_EVENT = 'dashboard_welcome_publish_failed';
export const DASHBOARD_AI_FEEDBACK_SUBMITTED_EVENT = 'dashboard_ai_feedback_submitted';
export const DASHBOARD_AI_FEEDBACK_FAILED_EVENT = 'dashboard_ai_feedback_failed';

type BrowserAmplitudeOptions = NonNullable<Parameters<typeof amplitude.init>[2]>;
type BrowserAmplitudeProperties = Record<string, unknown>;

const AMPLITUDE_MIN_ID_LENGTH = 5;
const AMPLITUDE_STORAGE_KEY_PREFIXES = [
  'AMP_',
  'amplitude_unsent_',
  'amplitude_unsent_identify_',
] as const;
const AMPLITUDE_COOKIE_REMOVAL_BASE_PATHS = ['/', '/dashboard', '/community'] as const;

let hasInitialized = false;
let activeUserId: string | undefined;

/**
 * Read the public Amplitude API key from the environment and return it trimmed.
 *
 * @returns The trimmed value of `NEXT_PUBLIC_AMPLITUDE_API_KEY` if it is a non-empty string, `undefined` otherwise.
 */
function getPublicApiKey(): string | undefined {
  const value = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Convert an environment-like string into a boolean flag.
 *
 * @param value - The input string, typically from an environment variable
 * @returns `true` only when `value` is exactly `'true'`, `false` otherwise
 */
function parseBoolean(value: string | undefined): boolean {
  return value === 'true';
}

/**
 * Gets the Amplitude server zone used by this deployment.
 *
 * @returns The string `"US"`.
 */
function getAmplitudeServerZone(): 'US' {
  return 'US';
}

/**
 * Determines whether a storage key name belongs to Amplitude by checking it against known prefixes.
 *
 * @param key - The storage key name to test
 * @returns `true` if `key` starts with any configured Amplitude storage prefix (case-insensitive), `false` otherwise
 */
function isAmplitudeStorageKey(key: string): boolean {
  const normalizedKey = key.toLowerCase();
  return AMPLITUDE_STORAGE_KEY_PREFIXES.some((prefix) =>
    normalizedKey.startsWith(prefix.toLowerCase()),
  );
}

/**
 * Removes Amplitude-related keys from available browser localStorage and sessionStorage.
 *
 * Attempts to access localStorage and sessionStorage (silently skipping any that throw),
 * then iterates each storage's keys and removes entries whose names match known Amplitude
 * storage-key prefixes. Failures during access or removal are ignored so cleanup can proceed
 * in restricted browser modes.
 */
function clearAmplitudeWebStorage(): void {
  const storages: Storage[] = [];

  for (const storageKey of ['localStorage', 'sessionStorage'] as const) {
    try {
      const storage = globalThis[storageKey];

      if (typeof storage !== 'undefined') {
        storages.push(storage);
      }
    } catch {
      // Ignore storage access failures in restricted browser modes.
    }
  }

  for (const storage of storages) {
    try {
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);

        if (key && isAmplitudeStorageKey(key)) {
          storage.removeItem(key);
        }
      }
    } catch {
      // Storage can throw in restricted browser modes; consent revocation should still continue.
    }
  }
}

/**
 * Build a list of cookie domain attribute values to try when removing cookies for a given hostname.
 *
 * Includes the empty string and the exact hostname; if the hostname is not an IPv4 address and
 * contains multiple dot-separated segments, also includes parent domains prefixed with a leading dot
 * (e.g., `.example.com`, `.sub.example.com`).
 *
 * @param hostname - The request hostname (e.g., `sub.example.com` or `127.0.0.1`)
 * @returns An array of unique domain attribute strings to use when clearing cookies for `hostname`
 */
function getCookieRemovalDomains(hostname: string): string[] {
  const hostSegments = hostname.split('.').filter(Boolean);
  const domains = new Set<string>(['']);

  domains.add(hostname);

  if (hostSegments.length > 1 && !/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    for (let index = 0; index < hostSegments.length - 1; index += 1) {
      domains.add(`.${hostSegments.slice(index).join('.')}`);
    }
  }

  return [...domains];
}

/**
 * Build a set of cookie path variants from a URL pathname.
 *
 * @param pathname - The URL pathname (e.g., `/a/b/c`) used to derive path variants
 * @returns An array containing common app paths plus each cumulative path segment (e.g., `'/a'`, `'/a/b'`, `'/a/b/c'`)
 */
function getCookieRemovalPaths(pathname: string): string[] {
  const paths = new Set<string>(AMPLITUDE_COOKIE_REMOVAL_BASE_PATHS);

  const normalizedPathname = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const pathSegments = normalizedPathname.split('/').filter(Boolean);

  for (let index = 1; index <= pathSegments.length; index += 1) {
    paths.add(`/${pathSegments.slice(0, index).join('/')}`);
  }

  return [...paths];
}

/**
 * Removes (expires) cookies whose names match known Amplitude storage keys across likely domain and path variants.
 *
 * Attempts to parse `document.cookie` for Amplitude-related cookie names and sets them to an expired value for each computed domain and path variant. Silently ignores failures (e.g., restricted browser modes) and is a no-op when `document` is unavailable.
 */
function clearAmplitudeCookies(): void {
  if (typeof globalThis.document === 'undefined') {
    return;
  }

  try {
    const cookieNames = globalThis.document.cookie
      .split(';')
      .map((cookie) => cookie.trim().split('=')[0])
      .filter((name) => name && isAmplitudeStorageKey(name));

    const domains = getCookieRemovalDomains(globalThis.location?.hostname ?? '');
    const paths = getCookieRemovalPaths(globalThis.location?.pathname ?? '/');

    for (const name of cookieNames) {
      for (const domain of domains) {
        for (const cookiePath of paths) {
          const cookieAttributes = [
            `${name}=`,
            'Max-Age=0',
            'expires=Thu, 01 Jan 1970 00:00:00 GMT',
            `path=${cookiePath}`,
            ...(domain ? [`domain=${domain}`] : []),
            'SameSite=Lax',
          ];

          // biome-ignore lint/suspicious/noDocumentCookie: Expire legacy Amplitude cookies.
          globalThis.document.cookie = cookieAttributes.join('; ');
        }
      }
    }
  } catch {
    // Ignore cookie access failures in restricted browser modes.
  }
}

/**
 * Normalize an arbitrary value into a valid Amplitude user id.
 *
 * Trims the input when it's a string and returns it only if its length is at least the minimum allowed id length.
 *
 * @param value - The value to normalize into an Amplitude user id
 * @returns The trimmed id when `value` is a string with length greater than or equal to the minimum allowed; `undefined` otherwise
 */
function normalizeAmplitudeId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length >= AMPLITUDE_MIN_ID_LENGTH ? trimmed : undefined;
}

/**
 * Recursively prepares a value for Amplitude event properties by redacting sensitive data and normalizing types.
 *
 * Strings have inline secret patterns replaced with "[REDACTED]". Arrays and objects are processed recursively. Object keys that match the sensitive-key pattern are omitted. Circular references are replaced with the string "[Circular]". Date objects are converted to ISO strings. Error objects are converted to `{ message, name }` with the message redacted.
 *
 * @param value - The value to scrub into a safe shape for Amplitude event properties.
 * @param seen - Internal WeakSet used to track visited objects and detect circular references; callers should not need to provide this.
 * @returns The scrubbed value, preserving the original structure where possible (primitive, array, or object) with sensitive data redacted or omitted.
 */
function scrubAmplitudeProperties(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactInlineSecrets(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';

  seen.add(value);
  let scrubbedValue: unknown;

  if (Array.isArray(value)) {
    scrubbedValue = value.map((item) => scrubAmplitudeProperties(item, seen));
  } else if (value instanceof Date) {
    scrubbedValue = value.toISOString();
  } else if (value instanceof Error) {
    scrubbedValue = { message: redactInlineSecrets(value.message), name: value.name };
  } else {
    scrubbedValue = Object.entries(value).reduce<BrowserAmplitudeProperties>(
      (properties, [key, childValue]) => {
        if (!isSensitiveKey(key)) {
          properties[key] = scrubAmplitudeProperties(childValue, seen);
        }
        return properties;
      },
      {},
    );
  }

  seen.delete(value);
  return scrubbedValue;
}

/**
 * Build the Amplitude browser initialization options using environment variables.
 *
 * The returned object configures autocapture based on NEXT_PUBLIC_AMPLITUDE_AUTOCAPTURE,
 * keeps SDK page-view autocapture disabled so app-owned page tracking is not duplicated,
 * sets log level to `None`, disables remote config fetching, keeps `serverZone`
 * fixed to `US`, and disables IP address tracking.
 *
 * @returns The options object to pass to `amplitude.init`
 */
export function getBrowserAmplitudeOptions(): BrowserAmplitudeOptions {
  return {
    autocapture: parseBoolean(process.env.NEXT_PUBLIC_AMPLITUDE_AUTOCAPTURE)
      ? {
          attribution: true,
          elementInteractions: false,
          fileDownloads: false,
          formInteractions: false,
          frustrationInteractions: false,
          networkTracking: false,
          pageUrlEnrichment: true,
          pageViews: false,
          sessions: true,
          webVitals: false,
        }
      : false,
    logLevel: amplitude.Types.LogLevel.None,
    remoteConfig: {
      fetchRemoteConfig: false,
    },
    optOut: false,
    serverZone: getAmplitudeServerZone(),
    trackingOptions: {
      ipAddress: false,
    },
  };
}

/**
 * Initialize Amplitude for dashboard usage and set or clear the module's active user id.
 *
 * Normalizes the provided `userId` before applying it. If Amplitude has not yet been initialized,
 * this will initialize it with the public API key and the normalized user id. If already initialized,
 * this will set a new normalized user id or reset the client when `userId` is absent.
 *
 * @param userId - Optional raw user id; trimmed and accepted only if it is a string of at least 5 characters
 * @returns `true` when initialization or user update/reset completed successfully, `false` otherwise (for example, when not running in a browser, when no public API key is available, or an error occurs)
 */
export function initDashboardAmplitude(userId?: string | null): boolean {
  const apiKey = getPublicApiKey();
  const normalizedUserId = normalizeAmplitudeId(userId);

  if (globalThis.window === undefined || !apiKey) {
    return false;
  }

  if (!hasAnalyticsConsent()) {
    resetDashboardAmplitude();
    return false;
  }

  try {
    amplitude.setOptOut(false);

    if (!hasInitialized) {
      amplitude.init(apiKey, normalizedUserId, getBrowserAmplitudeOptions());
      hasInitialized = true;
      activeUserId = normalizedUserId;
      return true;
    }

    if (normalizedUserId && normalizedUserId !== activeUserId) {
      amplitude.setUserId(normalizedUserId);
      activeUserId = normalizedUserId;
    } else if (!normalizedUserId && activeUserId) {
      amplitude.reset();
      activeUserId = undefined;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Revokes dashboard Amplitude collection for the current browser session.
 *
 * This opts the SDK out, clears the active user id when the SDK has already been initialized in
 * this page load, and removes queued Amplitude browser storage/cookies so future events cannot
 * flush after consent is revoked. The initialized flag remains intact so a later re-grant can use
 * the existing SDK instance instead of calling `init` twice.
 *
 * @returns `true` when revocation completed without SDK errors, otherwise `false`.
 */
export function resetDashboardAmplitude(): boolean {
  if (globalThis.window === undefined) {
    return false;
  }

  const shouldClearAmplitudeUserId = hasInitialized;
  activeUserId = undefined;

  try {
    amplitude.setOptOut(true);

    if (shouldClearAmplitudeUserId) {
      amplitude.setUserId(undefined);
    }

    clearAmplitudeWebStorage();
    clearAmplitudeCookies();
    return true;
  } catch {
    clearAmplitudeWebStorage();
    clearAmplitudeCookies();
    return false;
  }
}

/**
 * Send a named dashboard event to Amplitude after scrubbing sensitive properties.
 *
 * @param eventName - The event name; leading and trailing whitespace is ignored.
 * @param eventProperties - Event property payload; values will be recursively scrubbed to redact sensitive or inline secrets.
 * @returns `true` if the tracking call was sent successfully, `false` otherwise.
 */
export function trackDashboardEvent(
  eventName: string,
  eventProperties: BrowserAmplitudeProperties = {},
): boolean {
  const normalizedEventName = eventName.trim();

  if (!normalizedEventName || !hasAnalyticsConsent() || !initDashboardAmplitude(activeUserId)) {
    return false;
  }

  try {
    amplitude.track(
      normalizedEventName,
      scrubAmplitudeProperties(eventProperties) as BrowserAmplitudeProperties,
    );
    return true;
  } catch {
    return false;
  }
}
