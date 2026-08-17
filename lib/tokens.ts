/**
 * Cheap token estimate used for routing decisions only — never for billing.
 * Gemini averages ~4 characters per token on English prose. We deliberately
 * avoid a real tokenizer: this runs on every ingest and the 40k threshold has
 * plenty of headroom, so a fast approximation is the right trade.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
