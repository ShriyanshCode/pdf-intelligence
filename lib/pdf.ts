import { extractText, getDocumentProxy } from 'unpdf';
import { estimateTokens } from '@/lib/tokens';

export const TARGET_TOKENS = 1000;
export const OVERLAP_TOKENS = 150;
export const MAX_CHUNK_TOKENS = 1400;

/**
 * A chunk is at most (carried overlap + one segment), because packing flushes
 * before appending the segment that would exceed TARGET_TOKENS. Bounding a
 * segment here keeps that sum under MAX_CHUNK_TOKENS. The margin absorbs the
 * paragraph separators added when segments are joined.
 */
const SEGMENT_LIMIT_TOKENS = MAX_CHUNK_TOKENS - OVERLAP_TOKENS - 8;

export type PageText = { page: number; text: string };
export type Chunk = {
  idx: number;
  content: string;
  pageStart: number;
  pageEnd: number;
  tokenCount: number;
};

export async function extractPdfText(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });

  const pages: PageText[] = (text as string[]).map((t, i) => ({
    page: i + 1,
    text: (t ?? '').replace(/\r\n/g, '\n').trim(),
  }));
  const fullText = pages.map((p) => p.text).filter(Boolean).join('\n\n');

  return { pages, pageCount: totalPages, fullText, charCount: fullText.length };
}

/**
 * A scanned PDF extracts to almost nothing. Rather than summarizing noise we
 * detect it: under 100 characters per page on average means there is no text
 * layer worth processing. Single-page documents get a lower floor so a one-page
 * receipt is not misclassified as a scan.
 */
export function hasUsableText(fullText: string, pageCount: number): boolean {
  const trimmed = fullText.trim();
  if (trimmed.length < 200) return pageCount <= 1 && trimmed.length >= 20;
  return trimmed.length / Math.max(pageCount, 1) >= 100;
}

type Segment = { text: string; page: number; tokens: number };

/** Paragraphs in document order, with any oversized paragraph pre-split on word boundaries. */
function toSegments(pages: PageText[]): Segment[] {
  const segments: Segment[] = [];

  for (const p of pages) {
    const paragraphs = p.text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);

    for (const paragraph of paragraphs) {
      let remaining = paragraph;

      while (estimateTokens(remaining) > SEGMENT_LIMIT_TOKENS) {
        const limit = SEGMENT_LIMIT_TOKENS * 4;
        let cut = remaining.lastIndexOf(' ', limit);
        if (cut <= 0) cut = limit; // an unbroken run of characters
        const head = remaining.slice(0, cut).trim();
        segments.push({ text: head, page: p.page, tokens: estimateTokens(head) });
        remaining = remaining.slice(cut).trim();
      }

      if (remaining) {
        segments.push({ text: remaining, page: p.page, tokens: estimateTokens(remaining) });
      }
    }
  }

  return segments;
}

/**
 * The trailing ~OVERLAP_TOKENS of a just-flushed chunk, as a single synthetic
 * segment to seed the next one.
 *
 * Carrying a bounded text suffix rather than whole segments is deliberate: an
 * earlier version re-queued the last whole segment, which for a pre-split
 * oversized paragraph meant prepending ~1400 tokens and producing chunks at
 * twice the ceiling. A suffix is always within budget.
 */
function overlapFrom(flushed: Segment[]): Segment | null {
  if (flushed.length === 0) return null;

  const text = flushed.map((s) => s.text).join('\n\n');
  let suffix = text.slice(-OVERLAP_TOKENS * 4);

  // Drop a leading partial word so the overlap starts cleanly.
  const firstSpace = suffix.indexOf(' ');
  if (firstSpace > 0) suffix = suffix.slice(firstSpace + 1);
  suffix = suffix.trim();
  if (!suffix) return null;

  return {
    text: suffix,
    page: flushed[flushed.length - 1].page,
    tokens: estimateTokens(suffix),
  };
}

/**
 * Greedy packing to ~TARGET_TOKENS on paragraph boundaries, so a chunk rarely
 * severs a sentence, then carrying ~OVERLAP_TOKENS of the tail into the next
 * chunk. Page numbers ride along on each segment, which is what lets chat cite
 * pages later.
 */
export function chunkPages(pages: PageText[]): Chunk[] {
  const segments = toSegments(pages);
  if (segments.length === 0) return [];

  const chunks: Chunk[] = [];
  let current: Segment[] = [];
  let tokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    const content = current.map((s) => s.text).join('\n\n');
    chunks.push({
      idx: chunks.length,
      content,
      pageStart: current[0].page,
      pageEnd: current[current.length - 1].page,
      tokenCount: estimateTokens(content),
    });
  };

  for (const segment of segments) {
    if (current.length > 0 && tokens + segment.tokens > TARGET_TOKENS) {
      flush();

      const carried = overlapFrom(current);
      current = carried ? [carried] : [];
      tokens = carried?.tokens ?? 0;
    }

    current.push(segment);
    tokens += segment.tokens;
  }

  flush();
  return chunks;
}
