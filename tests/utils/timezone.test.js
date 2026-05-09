/**
 * Tests for src/utils/timezone.js
 * Covers resolveTimeZone and normalizeTimeZone utility functions.
 */
import { describe, expect, it } from 'vitest';
import { normalizeTimeZone, resolveTimeZone } from '../../src/utils/timezone.js';

describe('resolveTimeZone', () => {
  describe('non-string inputs', () => {
    it('returns null for null', () => {
      expect(resolveTimeZone(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(resolveTimeZone(undefined)).toBeNull();
    });

    it('returns null for a number', () => {
      expect(resolveTimeZone(5)).toBeNull();
    });

    it('returns null for an object', () => {
      expect(resolveTimeZone({ timeZone: 'UTC' })).toBeNull();
    });

    it('returns null for an array', () => {
      expect(resolveTimeZone(['UTC'])).toBeNull();
    });

    it('returns null for a boolean', () => {
      expect(resolveTimeZone(true)).toBeNull();
    });
  });

  describe('empty or whitespace-only strings', () => {
    it('returns null for an empty string', () => {
      expect(resolveTimeZone('')).toBeNull();
    });

    it('returns null for a whitespace-only string', () => {
      expect(resolveTimeZone('   ')).toBeNull();
    });
  });

  describe('valid IANA timezones', () => {
    it('returns the timezone for America/New_York', () => {
      expect(resolveTimeZone('America/New_York')).toBe('America/New_York');
    });

    it('returns the timezone for Europe/London', () => {
      expect(resolveTimeZone('Europe/London')).toBe('Europe/London');
    });

    it('returns the timezone for Asia/Tokyo', () => {
      expect(resolveTimeZone('Asia/Tokyo')).toBe('Asia/Tokyo');
    });

    it('returns UTC directly', () => {
      expect(resolveTimeZone('UTC')).toBe('UTC');
    });

    it('returns Etc/UTC', () => {
      expect(resolveTimeZone('Etc/UTC')).toBe('Etc/UTC');
    });

    it('handles leading/trailing whitespace for valid IANA timezones', () => {
      expect(resolveTimeZone('  UTC  ')).toBe('UTC');
    });
  });

  describe('invalid IANA timezones', () => {
    it('returns null for a completely invalid string', () => {
      expect(resolveTimeZone('Mars/Base')).toBeNull();
    });

    it('returns null for a plausible but unsupported timezone', () => {
      expect(resolveTimeZone('America/Fakecity')).toBeNull();
    });

    it('returns null for a random word', () => {
      expect(resolveTimeZone('Eastern')).toBeNull();
    });
  });

  describe('GMT offset patterns', () => {
    it('converts "GMT+5" to Etc/GMT-5', () => {
      expect(resolveTimeZone('GMT+5')).toBe('Etc/GMT-5');
    });

    it('converts "GMT-5" to Etc/GMT+5', () => {
      expect(resolveTimeZone('GMT-5')).toBe('Etc/GMT+5');
    });

    it('converts "GMT +3" (with space) to Etc/GMT-3', () => {
      expect(resolveTimeZone('GMT +3')).toBe('Etc/GMT-3');
    });

    it('converts "GMT -3" (with space) to Etc/GMT+3', () => {
      expect(resolveTimeZone('GMT -3')).toBe('Etc/GMT+3');
    });

    it('converts "UTC+5" to Etc/GMT-5', () => {
      expect(resolveTimeZone('UTC+5')).toBe('Etc/GMT-5');
    });

    it('converts "UTC-5" to Etc/GMT+5', () => {
      expect(resolveTimeZone('UTC-5')).toBe('Etc/GMT+5');
    });

    it('converts "UTC +3" (with space) to Etc/GMT-3', () => {
      expect(resolveTimeZone('UTC +3')).toBe('Etc/GMT-3');
    });

    it('converts "UTC -3" (with space) to Etc/GMT+3', () => {
      expect(resolveTimeZone('UTC -3')).toBe('Etc/GMT+3');
    });

    it('converts "gmt+5" (lowercase) to Etc/GMT-5', () => {
      expect(resolveTimeZone('gmt+5')).toBe('Etc/GMT-5');
    });

    it('converts "utc+5" (lowercase) to Etc/GMT-5', () => {
      expect(resolveTimeZone('utc+5')).toBe('Etc/GMT-5');
    });

    it('passes "GMT+0" through directly as a valid Intl timezone', () => {
      // GMT+0 is recognized as a valid Intl timezone, returned unchanged (not normalized to UTC)
      expect(resolveTimeZone('GMT+0')).toBe('GMT+0');
    });

    it('passes "GMT-0" through directly as a valid Intl timezone', () => {
      expect(resolveTimeZone('GMT-0')).toBe('GMT-0');
    });

    it('converts UTC+0 to UTC via normalizeGmtOffset (UTC+0 is not a valid Intl timezone name)', () => {
      // UTC+0 is not recognized by Intl, so normalizeGmtOffset handles it: hours=0 -> UTC
      expect(resolveTimeZone('UTC+0')).toBe('UTC');
    });

    it('converts "GMT+14" (boundary)', () => {
      expect(resolveTimeZone('GMT+14')).toBe('Etc/GMT-14');
    });

    it('returns null for out-of-range "GMT+15"', () => {
      expect(resolveTimeZone('GMT+15')).toBeNull();
    });

    it('returns null for out-of-range "GMT-15"', () => {
      expect(resolveTimeZone('GMT-15')).toBeNull();
    });

    it('returns null for malformed "GMT+100"', () => {
      expect(resolveTimeZone('GMT+100')).toBeNull();
    });

    it('returns "GMT" for "GMT" with no offset', () => {
      expect(resolveTimeZone('GMT')).toBe('GMT');
    });

    it('handles "GMT+1:00" colon format', () => {
      expect(resolveTimeZone('GMT+1:00')).toBe('Etc/GMT-1');
    });

    it('handles "UTC+1:00" colon format', () => {
      expect(resolveTimeZone('UTC+1:00')).toBe('Etc/GMT-1');
    });
  });
});

describe('normalizeTimeZone', () => {
  describe('valid inputs', () => {
    it('returns a valid IANA timezone unchanged', () => {
      expect(normalizeTimeZone('America/New_York')).toBe('America/New_York');
    });

    it('returns UTC unchanged', () => {
      expect(normalizeTimeZone('UTC')).toBe('UTC');
    });

    it('normalizes "GMT +3" to Etc/GMT-3', () => {
      expect(normalizeTimeZone('GMT +3')).toBe('Etc/GMT-3');
    });

    it('normalizes "UTC-8" to Etc/GMT+8', () => {
      expect(normalizeTimeZone('UTC-8')).toBe('Etc/GMT+8');
    });
  });

  describe('fallback behavior', () => {
    it('falls back to America/New_York for null', () => {
      expect(normalizeTimeZone(null)).toBe('America/New_York');
    });

    it('falls back to America/New_York for undefined', () => {
      expect(normalizeTimeZone(undefined)).toBe('America/New_York');
    });

    it('falls back to America/New_York for an invalid timezone string', () => {
      expect(normalizeTimeZone('Mars/Base')).toBe('America/New_York');
    });

    it('falls back to America/New_York for an empty string', () => {
      expect(normalizeTimeZone('')).toBe('America/New_York');
    });

    it('falls back to America/New_York for a number', () => {
      expect(normalizeTimeZone(42)).toBe('America/New_York');
    });
  });

  describe('custom fallback', () => {
    it('uses a custom fallback timezone when the value is invalid', () => {
      expect(normalizeTimeZone('Mars/Base', 'Europe/Paris')).toBe('Europe/Paris');
    });

    it('uses a custom GMT-offset fallback when the value is invalid', () => {
      expect(normalizeTimeZone('not-a-tz', 'UTC+2')).toBe('Etc/GMT-2');
    });

    it('falls back to America/New_York when both value and custom fallback are invalid', () => {
      expect(normalizeTimeZone('Mars/Base', 'Pluto/Station')).toBe('America/New_York');
    });

    it('ignores the custom fallback when the primary value is valid', () => {
      expect(normalizeTimeZone('Europe/Berlin', 'UTC')).toBe('Europe/Berlin');
    });
  });
});
