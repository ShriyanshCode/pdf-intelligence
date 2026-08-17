import { geminiGenerate, type Generate } from './gemini';
import { SUMMARY_SYSTEM, MAP_SYSTEM, summaryUser, reduceUser } from './prompts';

/** Documents at or above this estimate go through map-reduce instead of one call. */
export const LONG_DOC_TOKEN_THRESHOLD = 40_000;

/**
 * A 1,000-page PDF would otherwise issue ~1,500 map calls and exhaust the free
 * tier. Above this many chunks we sample evenly across the document, which keeps
 * coverage of the beginning, middle, and end rather than truncating.
 */
export const MAX_MAP_CALLS = 60;

type SummarizeInput = {
  fullText: string;
  chunks: { content: string; pageStart: number; pageEnd: number }[];
  tokenEstimate: number;
};

/** Evenly spaced sample that always includes the first and last element. */
function sampleEvenly<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  const step = (items.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, i) => items[Math.round(i * step)]);
}

/** Small concurrency pool — fast enough, low enough not to trip rate limits. */
async function mapWithConcurrency<T, R>(
  items: T[], limit: number, fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

export async function summarizeDocument(
  input: SummarizeInput,
  generate: Generate = geminiGenerate,
): Promise<string> {
  if (input.tokenEstimate < LONG_DOC_TOKEN_THRESHOLD) {
    const summary = await generate({
      system: SUMMARY_SYSTEM,
      user: summaryUser(input.fullText),
      maxOutputTokens: 700,
    });
    return summary.trim();
  }

  const sampled = sampleEvenly(input.chunks, MAX_MAP_CALLS);

  const mapped = await mapWithConcurrency(sampled, 4, (chunk) =>
    generate({
      system: MAP_SYSTEM,
      user: `EXCERPT (pages ${chunk.pageStart}-${chunk.pageEnd}):\n\n${chunk.content}`,
      maxOutputTokens: 700,
    }),
  );

  const facts = mapped
    .map((m) => m.trim())
    .filter((m) => m && m.toUpperCase() !== 'NONE')
    .join('\n');

  if (!facts) {
    return 'This document could not be summarized: no substantive text was found in the sampled excerpts.';
  }

  const summary = await generate({
    system: SUMMARY_SYSTEM,
    user: reduceUser(facts),
    maxOutputTokens: 700,
  });
  return summary.trim();
}
