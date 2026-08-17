import { describe, it, expect, vi } from 'vitest';
import { summarizeDocument, LONG_DOC_TOKEN_THRESHOLD, MAX_MAP_CALLS } from '@/lib/ai/summarize';
import { SUMMARY_SYSTEM, MAP_SYSTEM } from '@/lib/ai/prompts';
import type { GenerateArgs } from '@/lib/ai/gemini';

function fakeGenerate(reply: (a: GenerateArgs, n: number) => string) {
  const calls: GenerateArgs[] = [];
  const fn = vi.fn(async (args: GenerateArgs) => {
    calls.push(args);
    return reply(args, calls.length);
  });
  return { fn, calls };
}

const chunk = (i: number, content: string) => ({ content, pageStart: i + 1, pageEnd: i + 1 });

describe('summarizeDocument - short documents', () => {
  it('makes exactly one call below the threshold', async () => {
    const { fn, calls } = fakeGenerate(() => 'A crisp three sentence summary.');
    const summary = await summarizeDocument(
      { fullText: 'short text', chunks: [chunk(0, 'short text')], tokenEstimate: 500 },
      fn,
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls[0].system).toBe(SUMMARY_SYSTEM);
    expect(calls[0].user).toContain('short text');
    expect(summary).toBe('A crisp three sentence summary.');
  });

  it('trims surrounding whitespace from the model reply', async () => {
    const { fn } = fakeGenerate(() => '\n  Summary text.  \n');
    const summary = await summarizeDocument(
      { fullText: 'x', chunks: [chunk(0, 'x')], tokenEstimate: 10 },
      fn,
    );
    expect(summary).toBe('Summary text.');
  });
});

describe('summarizeDocument - long documents', () => {
  const longChunks = Array.from({ length: 5 }, (_, i) => chunk(i, `chunk body ${i}`));

  it('maps every chunk then reduces, in that order', async () => {
    const { fn, calls } = fakeGenerate((a) =>
      a.system === MAP_SYSTEM ? `- fact from ${a.user.slice(0, 20)}` : 'Final summary.',
    );

    const summary = await summarizeDocument(
      { fullText: 'irrelevant', chunks: longChunks, tokenEstimate: LONG_DOC_TOKEN_THRESHOLD + 1 },
      fn,
    );

    expect(fn).toHaveBeenCalledTimes(longChunks.length + 1);
    expect(calls.slice(0, -1).every((c) => c.system === MAP_SYSTEM)).toBe(true);
    expect(calls.at(-1)!.system).toBe(SUMMARY_SYSTEM);
    expect(summary).toBe('Final summary.');
  });

  it('feeds the mapped facts into the reduce call, not the raw text', async () => {
    const { fn, calls } = fakeGenerate((a) =>
      a.system === MAP_SYSTEM ? '- distinctive-extracted-fact' : 'Done.',
    );
    await summarizeDocument(
      { fullText: 'raw-document-body', chunks: longChunks, tokenEstimate: 90_000 },
      fn,
    );
    const reduce = calls.at(-1)!;
    expect(reduce.user).toContain('distinctive-extracted-fact');
    expect(reduce.user).not.toContain('raw-document-body');
  });

  it('drops chunks the mapper reports as NONE', async () => {
    const { fn, calls } = fakeGenerate((a, n) => {
      if (a.system !== MAP_SYSTEM) return 'Done.';
      return n === 1 ? '- kept fact' : 'NONE';
    });
    await summarizeDocument(
      { fullText: 'x', chunks: longChunks, tokenEstimate: 90_000 },
      fn,
    );
    const reduce = calls.at(-1)!;
    expect(reduce.user).toContain('kept fact');
    expect(reduce.user).not.toContain('NONE');
  });

  it('caps map calls on a very long document by sampling evenly', async () => {
    const many = Array.from({ length: 400 }, (_, i) => chunk(i, `body ${i}`));
    const { fn } = fakeGenerate((a) => (a.system === MAP_SYSTEM ? '- f' : 'Done.'));
    await summarizeDocument({ fullText: 'x', chunks: many, tokenEstimate: 900_000 }, fn);
    expect(fn).toHaveBeenCalledTimes(MAX_MAP_CALLS + 1);
  });

  it('still samples the first and last chunk when capping', async () => {
    const many = Array.from({ length: 400 }, (_, i) => chunk(i, `body ${i}`));
    const { fn, calls } = fakeGenerate((a) => (a.system === MAP_SYSTEM ? '- f' : 'Done.'));
    await summarizeDocument({ fullText: 'x', chunks: many, tokenEstimate: 900_000 }, fn);
    const mapped = calls.filter((c) => c.system === MAP_SYSTEM);
    expect(mapped.some((c) => c.user.includes('body 0'))).toBe(true);
    expect(mapped.some((c) => c.user.includes('body 399'))).toBe(true);
  });

  it('falls back to a plain notice if every chunk maps to NONE', async () => {
    const { fn } = fakeGenerate((a) => (a.system === MAP_SYSTEM ? 'NONE' : 'unused'));
    const summary = await summarizeDocument(
      { fullText: 'x', chunks: longChunks, tokenEstimate: 90_000 },
      fn,
    );
    expect(summary).toMatch(/could not be summarized|no substantive/i);
  });
});
