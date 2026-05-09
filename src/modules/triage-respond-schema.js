import { z } from 'zod';

export const triageRespondSchema = z.object({
  responses: z
    .array(
      z.object({
        targetMessageId: z.string().min(1),
        targetUser: z.string().min(1),
        response: z.string(),
      }),
    )
    .default([]),
});

/**
 * Validate and normalize responder output from either structured SDK output
 * or the legacy text/JSON fallback parser.
 *
 * @param {unknown} value
 * @returns {{ responses: Array<{ targetMessageId: string, targetUser: string, response: string }> } | null}
 */
export function normalizeRespondResult(value) {
  const parsed = triageRespondSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
}
