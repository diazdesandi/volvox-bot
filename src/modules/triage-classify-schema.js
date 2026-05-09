import { z } from 'zod';

export const TRIAGE_CLASSIFICATIONS = ['ignore', 'respond', 'chime-in', 'moderate'];

export const TRIAGE_RECOMMENDED_ACTIONS = ['warn', 'timeout', 'kick', 'ban', 'delete'];

export const triageClassifySchema = z.object({
  classification: z
    .enum(TRIAGE_CLASSIFICATIONS)
    .describe('Routing decision for the messages being evaluated.'),
  confidence: z.number().min(0).max(1).default(1).describe('Classifier confidence from 0 to 1.'),
  directedAtBot: z
    .boolean()
    .default(false)
    .describe('True when the user explicitly mentions or replies to the bot.'),
  reasoning: z.string().default('').describe('Brief reason for the classification decision.'),
  targetMessageIds: z
    .array(z.string())
    .default([])
    .describe('Message IDs that need a response or moderation action. Empty for ignore.'),
  recommendedAction: z
    .enum(TRIAGE_RECOMMENDED_ACTIONS)
    .nullable()
    .default(null)
    .describe('Moderation action to take. Use null unless classification is moderate.'),
  violatedRule: z
    .string()
    .nullable()
    .default(null)
    .describe('Community rule violated. Use null unless classification is moderate.'),
  needsThinking: z
    .boolean()
    .default(false)
    .describe('True when the response needs deeper reasoning or debugging.'),
  needsSearch: z
    .boolean()
    .default(false)
    .describe('True when the response needs current external information or web search.'),
});

/**
 * Validate and normalize classifier output from either structured SDK output
 * or the legacy text/JSON fallback parser.
 *
 * @param {unknown} value
 * @returns {Object|null}
 */
export function normalizeClassifyResult(value) {
  const normalizedInput =
    value && typeof value === 'object' && !Array.isArray(value)
      ? {
          ...value,
          needsThinking: Boolean(value.needsThinking),
          needsSearch: Boolean(value.needsSearch),
        }
      : value;
  const parsed = triageClassifySchema.safeParse(normalizedInput);
  if (!parsed.success) return null;

  const result = parsed.data;

  // respond/chime-in with no target messages is nonsensical — downgrade to ignore
  if (
    (result.classification === 'respond' || result.classification === 'chime-in') &&
    result.targetMessageIds.length === 0
  ) {
    result.classification = 'ignore';
  }

  if (result.classification === 'ignore') {
    return {
      ...result,
      targetMessageIds: [],
      recommendedAction: null,
      violatedRule: null,
      needsThinking: false,
      needsSearch: false,
    };
  }

  if (result.classification !== 'moderate') {
    return {
      ...result,
      recommendedAction: null,
      violatedRule: null,
    };
  }

  return result;
}
