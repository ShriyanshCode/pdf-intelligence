import { NextResponse } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { chunks } from '@/lib/db/schema';
import { requireOwnedDocument, AccessError } from '@/lib/authz';
import { toErrorResponse } from '@/lib/api-error';

/** Polling target for the dashboard card while a document is still processing. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const session = await auth();
    if (!session?.user?.id) throw new AccessError(404, 'Not found');
    const doc = await requireOwnedDocument(id, session.user.id);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(chunks)
      .where(and(eq(chunks.documentId, id), isNull(chunks.embedding)));

    return NextResponse.json({
      status: doc.status,
      summary: doc.summary,
      error: doc.error,
      pageCount: doc.pageCount,
      hasExtractableText: doc.hasExtractableText,
      remainingChunks: count,
      updatedAt: doc.updatedAt,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
