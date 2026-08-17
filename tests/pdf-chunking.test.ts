import { describe, it, expect } from 'vitest';
import {
  chunkPages, hasUsableText, MAX_CHUNK_TOKENS, TARGET_TOKENS, type PageText,
} from '@/lib/pdf';

/** Builds a page of `paras` paragraphs, each roughly `tokensEach` tokens. */
function page(n: number, paras: number, tokensEach: number): PageText {
  const unit = 'lorem ipsum dolor sit amet ';
  const para = unit.repeat(Math.ceil((tokensEach * 4) / unit.length)).trim();
  return { page: n, text: Array.from({ length: paras }, () => para).join('\n\n') };
}

describe('chunkPages', () => {
  it('returns no chunks for no pages', () => {
    expect(chunkPages([])).toEqual([]);
  });

  it('returns no chunks when every page is blank', () => {
    expect(chunkPages([{ page: 1, text: '   \n\n  ' }])).toEqual([]);
  });

  it('keeps a short document in a single chunk on one page', () => {
    const chunks = chunkPages([{ page: 1, text: 'A short paragraph of text.' }]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ idx: 0, pageStart: 1, pageEnd: 1 });
    expect(chunks[0].content).toContain('short paragraph');
  });

  it('numbers chunks sequentially from zero with no gaps', () => {
    const chunks = chunkPages([page(1, 6, 300), page(2, 6, 300), page(3, 6, 300)]);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((c) => c.idx)).toEqual(chunks.map((_, i) => i));
  });

  it('never emits a chunk above the hard ceiling', () => {
    const chunks = chunkPages([page(1, 20, 250), page(2, 20, 250)]);
    for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(MAX_CHUNK_TOKENS);
  });

  it('splits a single paragraph that alone exceeds the ceiling', () => {
    const chunks = chunkPages([page(1, 1, 5000)]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(MAX_CHUNK_TOKENS);
  });

  it('overlaps consecutive chunks so context is not severed', () => {
    const chunks = chunkPages([page(1, 10, 200), page(2, 10, 200)]);
    expect(chunks.length).toBeGreaterThan(1);
    // Some suffix of chunk N must reappear at the head of chunk N+1.
    const tail = chunks[0].content.slice(-80).trim();
    expect(chunks[1].content.includes(tail.slice(0, 40))).toBe(true);
  });

  it('records a page range that is ordered and inside the source pages', () => {
    const chunks = chunkPages([page(1, 8, 250), page(2, 8, 250), page(3, 8, 250)]);
    for (const c of chunks) {
      expect(c.pageStart).toBeLessThanOrEqual(c.pageEnd);
      expect(c.pageStart).toBeGreaterThanOrEqual(1);
      expect(c.pageEnd).toBeLessThanOrEqual(3);
    }
  });

  it('advances page ranges monotonically through the document', () => {
    const chunks = chunkPages([page(1, 8, 250), page(2, 8, 250), page(3, 8, 250)]);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].pageStart).toBeGreaterThanOrEqual(chunks[i - 1].pageStart);
    }
  });

  it('packs near the target instead of emitting many tiny chunks', () => {
    const chunks = chunkPages([page(1, 12, 250), page(2, 12, 250)]);
    const body = chunks.slice(0, -1); // the final chunk is legitimately short
    for (const c of body) expect(c.tokenCount).toBeGreaterThan(TARGET_TOKENS * 0.5);
  });
});

describe('hasUsableText', () => {
  it('accepts a normal text PDF', () => {
    expect(hasUsableText('word '.repeat(500), 3)).toBe(true);
  });

  it('rejects an empty extraction, meaning a scanned document', () => {
    expect(hasUsableText('', 12)).toBe(false);
  });

  it('rejects a scan yielding only stray characters per page', () => {
    expect(hasUsableText('a\n b\n c', 40)).toBe(false);
  });

  it('accepts a genuinely tiny one-page document', () => {
    expect(hasUsableText('This is a receipt for $40 paid on 3 March 2026.', 1)).toBe(true);
  });
});
