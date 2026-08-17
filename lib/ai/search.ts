import { and, cosineDistance, desc, eq, gt, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { chunks, documents, shares } from '@/lib/db/schema';
import { embedQuery } from './embed';
import type { CardDocument } from '@/components/document-card';

/**
 * Calibrated against the live API, not guessed. gemini-embedding-001 similarities
 * sit in a compressed high range: a measured query scored 0.69 against genuinely
 * related text but still 0.50 against a completely unrelated passage. A low floor
 * would therefore return every document for every query.
 *
 * Applies to dashboard search only — chat retrieval takes top-k unconditionally.
 */
export const SIMILARITY_FLOOR = 0.6;
export const MAX_CHUNK_HITS = 60;

export type ChunkHit = {
  documentId: string;
  filename: string;
  summary: string | null;
  status: string;
  error: string | null;
  pageCount: number | null;
  sizeBytes: number;
  hasExtractableText: boolean | null;
  createdAt: Date;
  updatedAt: Date;
  shareCount: number;
  idx: number;
  content: string;
  similarity: number;
};

export function snippetFor(content: string, maxChars = 180): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxChars) return flat;
  const cut = flat.lastIndexOf(' ', maxChars);
  return flat.slice(0, cut > 0 ? cut : maxChars).trim();
}

/**
 * Collapses chunk hits to documents, each ranked by its single best chunk.
 * Ranking by best chunk rather than by hit count stops a long document from
 * outranking a short, precisely relevant one purely on volume.
 */
export function groupHitsByDocument(hits: ChunkHit[]): CardDocument[] {
  const best = new Map<string, ChunkHit>();

  for (const hit of hits) {
    const existing = best.get(hit.documentId);
    if (!existing || hit.similarity > existing.similarity) best.set(hit.documentId, hit);
  }

  return [...best.values()]
    .sort((a, b) => b.similarity - a.similarity)
    .map((hit) => ({
      id: hit.documentId,
      filename: hit.filename,
      status: hit.status,
      summary: hit.summary,
      error: hit.error,
      pageCount: hit.pageCount,
      sizeBytes: hit.sizeBytes,
      hasExtractableText: hit.hasExtractableText,
      shareCount: hit.shareCount,
      createdAt: hit.createdAt,
      updatedAt: hit.updatedAt,
      matchSnippet: snippetFor(hit.content),
    }));
}

export async function semanticSearch(userId: string, query: string): Promise<CardDocument[]> {
  const vector = await embedQuery(query);
  const similarity = sql<number>`1 - (${cosineDistance(chunks.embedding, vector)})`;

  const shareCount = sql<number>`(
    SELECT count(*)::int FROM ${shares}
     WHERE ${shares.documentId} = ${documents.id} AND ${shares.revokedAt} IS NULL
  )`;

  const hits = await db
    .select({
      documentId: chunks.documentId, idx: chunks.idx, content: chunks.content, similarity,
      filename: documents.filename, summary: documents.summary, status: documents.status,
      error: documents.error, pageCount: documents.pageCount, sizeBytes: documents.sizeBytes,
      hasExtractableText: documents.hasExtractableText,
      createdAt: documents.createdAt, updatedAt: documents.updatedAt, shareCount,
    })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(and(eq(documents.ownerId, userId), gt(similarity, SIMILARITY_FLOOR)))
    .orderBy(desc(similarity))
    .limit(MAX_CHUNK_HITS);

  return groupHitsByDocument(hits as ChunkHit[]);
}
