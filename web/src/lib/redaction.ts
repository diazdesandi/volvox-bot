/**
 * Shared redaction utilities for scrubbing sensitive data from telemetry payloads.
 *
 * Provides pattern-based detection of sensitive object keys and inline secret tokens.
 * Used by both Amplitude analytics and Sentry error reporting modules.
 */

const SENSITIVE_KEY_FRAGMENTS = [
  'authorization',
  'cookie',
  'csrf',
  'e-mail',
  'email',
  'secret',
  'password',
  'token',
  'session',
  'stack',
] as const;

const SENSITIVE_COMPACT_KEYS = new Set(['ip', 'ipaddress', 'xforwardedfor', 'apikey', 'xapikey']);

const SENSITIVE_IP_KEY_PREFIXES = new Set(
  'actor client destination external forwarded host internal lastlogin local origin peer private public real remote request response server socket source user visitor'.split(
    ' ',
  ),
);

/**
 * Pattern matching word separators in object keys (spaces, dots, underscores, hyphens).
 */
export const SENSITIVE_KEY_SEPARATOR_PATTERN = /[\s._-]+/g;

/**
 * Pre-computed compact (separator-stripped) versions of key fragments for matching keys
 * where separators have been removed (e.g. "apitoken" matches "token" fragment).
 */
const SENSITIVE_KEY_FRAGMENT_COMPACTS = SENSITIVE_KEY_FRAGMENTS.map((fragment) =>
  fragment.replaceAll(SENSITIVE_KEY_SEPARATOR_PATTERN, ''),
);

/**
 * Ordered list of inline secret patterns and their replacements.
 *
 * Uses explicit `[A-Za-z0-9]` character classes instead of `\w` for stricter matching
 * (excludes underscore from leading character positions where it would cause false positives).
 */
export const INLINE_SECRET_REPLACEMENTS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bBearer\s+[A-Za-z0-9_.~+/=-]+/gi, replacement: '[REDACTED]' },
  { pattern: /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{10,}/g, replacement: '[REDACTED]' },
  { pattern: /\b(?:xox[baprs]|gh[pousr])_[A-Za-z0-9_/-]{10,}/g, replacement: '[REDACTED]' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{10,}/g, replacement: '[REDACTED]' },
  {
    pattern:
      /([?&#]\s*(?:access[-_]?token|refresh[-_]?token|api[-_]?key|token|secret|password)\s*=)\s*[^\s&#]+/gi,
    replacement: '$1[REDACTED]',
  },
  {
    pattern:
      /(^|[\s,;])((?:access[-_]?token|refresh[-_]?token|api[-_]?key|token|secret|password)\s*=)\s*[^\s,;&#]+/gi,
    replacement: '$1$2[REDACTED]',
  },
  {
    pattern:
      /["'](?:api[-_]?key|token|secret|password|access[-_]?token|refresh[-_]?token)["']\s*[:=]\s*["'][A-Za-z0-9_.~+/=-]{8,}["']/gi,
    replacement: '"[REDACTED_KEY]":"[REDACTED]"',
  },
];

/**
 * Determines whether an object key may contain sensitive data.
 *
 * Checks against known sensitive key fragments (with and without separators),
 * exact compact key matches, IP-related patterns (including camelCase variants),
 * and IP-prefix combinations.
 *
 * @param key - Object key to inspect.
 * @returns True when the key should be removed from telemetry payloads.
 */
export function isSensitiveKey(key: string): boolean {
  const normalizedKey = key.toLowerCase();
  const compactKey = normalizedKey.replaceAll(SENSITIVE_KEY_SEPARATOR_PATTERN, '');

  if (
    SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalizedKey.includes(fragment)) ||
    SENSITIVE_KEY_FRAGMENT_COMPACTS.some((fragment) => compactKey.includes(fragment))
  ) {
    return true;
  }

  return (
    SENSITIVE_COMPACT_KEYS.has(compactKey) ||
    /(?:^|[._\-\s])ip$/i.test(key) ||
    /[a-z0-9]I[Pp]$/.test(key) ||
    (compactKey.endsWith('ip') && SENSITIVE_IP_KEY_PREFIXES.has(compactKey.slice(0, -2)))
  );
}

/**
 * Redacts inline secret tokens and keys from a string value.
 *
 * @param value - Input string potentially containing inline secrets (e.g., bearer tokens, API keys).
 * @returns The input string with matches of inline-secret patterns replaced by `"[REDACTED]"`.
 */
export function redactInlineSecrets(value: string): string {
  return INLINE_SECRET_REPLACEMENTS.reduce(
    (scrubbed, { pattern, replacement }) => scrubbed.replaceAll(pattern, replacement),
    value,
  );
}
