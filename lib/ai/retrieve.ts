import { cosineDistance, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { chunks } from '@/lib/db/schema';
import { embedQuery } from './embed';
import { LONG_DOC_TOKEN_THRESHOLD } from './summarize';

export const RETRIEVAL_TOP_K = 8;
export const MAX_HISTORY_TURNS = 5;

export type ChunkRow = { idx: number; content: string; pageStart: number; pageEnd: number };
export type Message = { role: 'user' | 'assistant'; content: string };

/**
 * Expands each hit to include its immediate neighbours, then returns the union in
 * document order. Reading order matters: excerpts served in relevance order read
 * as disconnected fragments, while adjacent chunks in document order read as
 * continuous prose.
 */
export function withNeighbours(hitIdxs: number[], all: ChunkRow[]): ChunkRow[] {
  const byIdx = new Map(all.map((c) => [c.idx, c]));
  const wanted = new Set<number>();

  for (const idx of hitIdxs) {
    if (!byIdx.has(idx)) continue;
    wanted.add(idx);
    if (byIdx.has(idx - 1)) wanted.add(idx - 1);
    if (byIdx.has(idx + 1)) wanted.add(idx + 1);
  }

  return [...wanted].sort((a, b) => a - b).map((idx) => byIdx.get(idx)!);
}

export function formatContext(chunkRows: ChunkRow[]): string {
  return chunkRows
    .map((c) => {
      const label =
        c.pageStart === c.pageEnd ? `page ${c.pageStart}` : `pages ${c.pageStart}-${c.pageEnd}`;
      return `[${label}]\n${c.content}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Keeps the last N turns. A turn is a user message plus its reply, so the slice is
 * 2N messages. Gemini rejects a conversation that opens on a model turn, so a
 * leading assistant message is dropped.
 */
export function trimHistory(messages: Message[], maxTurns = MAX_HISTORY_TURNS): Message[] {
  const trimmed = messages.slice(-maxTurns * 2);
  while (trimmed.length > 0 && trimmed[0].role === 'assistant') trimmed.shift();
  return trimmed;
}

/**
 * The long-document strategy. Below the threshold the whole document goes into the
 * prompt, so no retrieval miss is possible. Above it, top-k chunks plus their
 * neighbours.
 */
export async function buildChatContext(
  doc: { id: string; fullText: string | null; tokenEstimate: number | null },
  question: string,
): Promise<string> {
  const tokens = doc.tokenEstimate ?? 0;

  if (tokens > 0 && tokens < LONG_DOC_TOKEN_THRESHOLD && doc.fullText) {
    return doc.fullText;
  }

  const vector = await embedQuery(question);
  const similarity = sql<number>`1 - (${cosineDistance(chunks.embedding, vector)})`;

  const hits = await db
    .select({ idx: chunks.idx })
    .from(chunks)
    .where(eq(chunks.documentId, doc.id))
    .orderBy(desc(similarity))
    .limit(RETRIEVAL_TOP_K);

  const all = await db
    .select({
      idx: chunks.idx, content: chunks.content,
      pageStart: chunks.pageStart, pageEnd: chunks.pageEnd,
    })
    .from(chunks)
    .where(eq(chunks.documentId, doc.id));

  const selected = withNeighbours(hits.map((h) => h.idx), all);

  // A document with no chunks yet (or all embeddings still null) falls back to
  // whatever full text exists rather than sending an empty context.
  if (selected.length === 0) return doc.fullText ?? '';

  return formatContext(selected);
}
