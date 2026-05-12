import { describe, expect, it } from 'vitest';

import { TRIAGE_NUMERIC_FIELDS } from '../../src/modules/triage-config-fields.js';

describe('triage-config-fields', () => {
  describe('TRIAGE_NUMERIC_FIELDS', () => {
    it('exports the expected set of field keys', () => {
      expect(Object.keys(TRIAGE_NUMERIC_FIELDS)).toEqual(
        expect.arrayContaining(['memoryTimeoutMs', 'responseCooldownMs', 'triageDebounceMs']),
      );
      expect(Object.keys(TRIAGE_NUMERIC_FIELDS)).toHaveLength(3);
    });

    it('is frozen (immutable)', () => {
      expect(Object.isFrozen(TRIAGE_NUMERIC_FIELDS)).toBe(true);
    });

    describe('responseCooldownMs', () => {
      it('has default of 0 (changed from 10000)', () => {
        expect(TRIAGE_NUMERIC_FIELDS.responseCooldownMs.default).toBe(0);
      });

      it('has min of 0', () => {
        expect(TRIAGE_NUMERIC_FIELDS.responseCooldownMs.min).toBe(0);
      });

      it('has max of 60000', () => {
        expect(TRIAGE_NUMERIC_FIELDS.responseCooldownMs.max).toBe(60000);
      });
    });

    describe('memoryTimeoutMs', () => {
      it('has default of 2000', () => {
        expect(TRIAGE_NUMERIC_FIELDS.memoryTimeoutMs.default).toBe(2000);
      });

      it('has min of 500', () => {
        expect(TRIAGE_NUMERIC_FIELDS.memoryTimeoutMs.min).toBe(500);
      });

      it('has max of 30000', () => {
        expect(TRIAGE_NUMERIC_FIELDS.memoryTimeoutMs.max).toBe(30000);
      });
    });

    describe('triageDebounceMs', () => {
      it('has default of 500', () => {
        expect(TRIAGE_NUMERIC_FIELDS.triageDebounceMs.default).toBe(500);
      });

      it('has min of 0', () => {
        expect(TRIAGE_NUMERIC_FIELDS.triageDebounceMs.min).toBe(0);
      });

      it('has max of 2000', () => {
        expect(TRIAGE_NUMERIC_FIELDS.triageDebounceMs.max).toBe(2000);
      });
    });

    it('each field has min, max, and default properties', () => {
      for (const [key, field] of Object.entries(TRIAGE_NUMERIC_FIELDS)) {
        expect(typeof field.min, `${key}.min should be a number`).toBe('number');
        expect(typeof field.max, `${key}.max should be a number`).toBe('number');
        expect(typeof field.default, `${key}.default should be a number`).toBe('number');
      }
    });

    it('each field default is within its own [min, max] range', () => {
      for (const [key, field] of Object.entries(TRIAGE_NUMERIC_FIELDS)) {
        expect(field.default, `${key}.default >= min`).toBeGreaterThanOrEqual(field.min);
        expect(field.default, `${key}.default <= max`).toBeLessThanOrEqual(field.max);
      }
    });

    it('min is less than or equal to max for every field', () => {
      for (const [key, field] of Object.entries(TRIAGE_NUMERIC_FIELDS)) {
        expect(field.min, `${key}.min <= max`).toBeLessThanOrEqual(field.max);
      }
    });
  });
});
