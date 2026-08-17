import { NextResponse } from 'next/server';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { documents, chunks } from '@/lib/db/schema';
import { requireOwnedDocument, AccessError } from '@/lib/authz';
import { embedTexts, EMBED_BATCH_SIZE } from '@/lib/ai/embed';
import { toErrorResponse } from '@/lib/api-error';

export const maxDuration = 60;

/**
 * Stage two: embed one batch of chunks per call, driven by "embedding IS NULL"
 * rather than a caller-held cursor. That makes retries inherently idempotent —
 * a stale cursor cannot skip a batch — and means a 400-page PDF simply takes
 * more calls instead of risking the 60s ceiling.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const session = await auth();
    if (!session?.user?.id) throw new AccessError(404, 'Not found');
    await requireOwnedDocument(id, session.user.id);

    const pending = await db
      .select({ id: chunks.id, content: chunks.content })
      .from(chunks)
      .where(and(eq(chunks.documentId, id), isNull(chunks.embedding)))
      .orderBy(asc(chunks.idx))
      .limit(EMBED_BATCH_SIZE);

    if (pending.length > 0) {
      const vectors = await embedTexts(pending.map((c) => c.content), 'RETRIEVAL_DOCUMENT');
      await Promise.all(
        pending.map((chunk, i) =>
          db.update(chunks).set({ embedding: vectors[i] }).where(eq(chunks.id, chunk.id)),
        ),
      );
    }

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(chunks)
      .where(and(eq(chunks.documentId, id), isNull(chunks.embedding)));

    const done = count === 0;
    if (done) {
      await db.update(documents)
        .set({ status: 'ready', updatedAt: new Date() })
        .where(eq(documents.id, id));
    }

    return NextResponse.json({ embedded: pending.length, remaining: count, done });
  } catch (error) {
    return toErrorResponse(error);
  }
}
