/**
 * Triage numeric field metadata — single source of truth for defaults,
 * min/max constraints, and validation across all layers (bot config
 * resolution, server-side API validation, and dashboard UI).
 */

export const TRIAGE_NUMERIC_FIELDS = Object.freeze({
  memoryTimeoutMs: { min: 500, max: 30000, default: 2000 },
  responseCooldownMs: { min: 0, max: 60000, default: 0 },
  triageDebounceMs: { min: 0, max: 2000, default: 500 },
});
