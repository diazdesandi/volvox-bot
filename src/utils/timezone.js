const DEFAULT_TIME_ZONE = 'America/New_York';
const GMT_OFFSET_PATTERN = /^(?:GMT|UTC)\s*([+-])\s*(0?\d|1[0-4])(?::00)?$/i;

/**
 * Check whether a timezone identifier is supported by Intl.DateTimeFormat.
 * @param {string} timezone - Timezone identifier to test (for example, 'America/New_York' or 'Etc/GMT+1').
 * @returns {boolean} `true` if `Intl.DateTimeFormat` accepts the timezone identifier, `false` otherwise.
 */
function isSupportedTimeZone(timezone) {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: timezone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a GMT/UTC offset string into a supported IANA timezone identifier.
 *
 * Accepts strings like "GMT+5", "UTC-03", optionally with ":00" and extra whitespace.
 * @param {string} value - The GMT/UTC offset string to normalize.
 * @returns {string|null} IANA timezone identifier (e.g., "UTC" or "Etc/GMT-5") if the input is a valid and supported GMT/UTC offset between 0 and 14 hours, `null` otherwise.
 */
function normalizeGmtOffset(value) {
  const match = GMT_OFFSET_PATTERN.exec(value);
  if (!match) return null;

  const sign = match[1];
  const hours = Number.parseInt(match[2], 10);
  if (!Number.isInteger(hours) || hours < 0 || hours > 14) {
    return null;
  }

  if (hours === 0) {
    return 'UTC';
  }

  const invertedSign = sign === '+' ? '-' : '+';
  const timezone = `Etc/GMT${invertedSign}${hours}`;
  return isSupportedTimeZone(timezone) ? timezone : null;
}

/**
 * Resolve a user-supplied timezone into an Intl-compatible IANA timezone.
 *
 * @param {unknown} value - User-supplied timezone value
 * @returns {string|null} Normalized timezone, or null when unsupported
 */
export function resolveTimeZone(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const timezone = value.trim();
  if (!timezone) {
    return null;
  }

  if (isSupportedTimeZone(timezone)) {
    return timezone;
  }

  return normalizeGmtOffset(timezone);
}

/**
 * Normalize a user-supplied timezone into a supported IANA timezone, using the provided fallback or the default if necessary.
 *
 * @param {unknown} value - User-supplied timezone; may be an IANA name (e.g., "America/New_York") or a GMT/UTC offset string (e.g., "GMT+2").
 * @param {string} [fallback=DEFAULT_TIME_ZONE] - Fallback timezone to use if `value` is unsupported.
 * @returns {string} A supported IANA timezone resolved from `value`, or from `fallback`, or `'America/New_York'` if neither is supported.
 */
export function normalizeTimeZone(value, fallback = DEFAULT_TIME_ZONE) {
  return resolveTimeZone(value) ?? (resolveTimeZone(fallback) || DEFAULT_TIME_ZONE);
}
