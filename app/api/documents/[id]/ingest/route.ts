import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { documents, chunks as chunksTable } from '@/lib/db/schema';
import { requireOwnedDocument, AccessError } from '@/lib/authz';
import { downloadObject, looksLikePdf, deleteObject } from '@/lib/storage';
import { extractPdfText, chunkPages, hasUsableText } from '@/lib/pdf';
import { estimateTokens } from '@/lib/tokens';
import { summarizeDocument } from '@/lib/ai/summarize';
import { toErrorResponse } from '@/lib/api-error';

export const maxDuration = 60;

/**
 * Stage one: extract text, then summarize. Ends at status 'indexing', from which
 * the /embed route takes over in batches. Splitting the work this way is what
 * keeps any single request clear of the 60s function ceiling.
 *
 * Idempotent: re-running overwrites the same fields and chunk inserts are
 * conflict-tolerant, so a retry after a timeout is always safe.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const session = await auth();
    if (!session?.user?.id) throw new AccessError(404, 'Not found');
    const doc = await requireOwnedDocument(id, session.user.id);

    const fail = async (message: string) => {
      await db.update(documents)
        .set({ status: 'failed', error: message, updatedAt: new Date() })
        .where(eq(documents.id, id));
      return NextResponse.json({ status: 'failed', error: message }, { status: 400 });
    };

    await db.update(documents)
      .set({ status: 'extracting', error: null, updatedAt: new Date() })
      .where(eq(documents.id, id));

    const bytes = await downloadObject(doc.storagePath);

    // Authoritative format check. MIME type and extension are client-supplied
    // and forgeable; the magic bytes are not.
    if (!looksLikePdf(bytes)) {
      await deleteObject(doc.storagePath).catch(() => {});
      return fail('That file is not a valid PDF.');
    }

    const { pages, pageCount, fullText, charCount } = await extractPdfText(bytes);

    // Scanned documents: record the fact, skip the AI stages, finish as ready.
    // Summarizing an empty extraction would invent content.
    if (!hasUsableText(fullText, pageCount)) {
      await db.update(documents).set({
        status: 'ready', pageCount, charCount,
        tokenEstimate: 0, hasExtractableText: false,
        summary: null, updatedAt: new Date(),
      }).where(eq(documents.id, id));
      return NextResponse.json({ status: 'ready', scanned: true });
    }

    const tokenEstimate = estimateTokens(fullText);
    await db.update(documents).set({
      status: 'summarizing', pageCount, charCount, fullText,
      tokenEstimate, hasExtractableText: true, updatedAt: new Date(),
    }).where(eq(documents.id, id));

    const docChunks = chunkPages(pages);
    const summary = await summarizeDocument({ fullText, chunks: docChunks, tokenEstimate });

    // Chunks land with embedding NULL; /embed fills them in batches.
    if (docChunks.length > 0) {
      await db.insert(chunksTable).values(
        docChunks.map((c) => ({
          documentId: id, idx: c.idx, content: c.content,
          pageStart: c.pageStart, pageEnd: c.pageEnd, tokenCount: c.tokenCount,
        })),
      ).onConflictDoNothing();
    }

    await db.update(documents)
      .set({ summary, status: 'indexing', updatedAt: new Date() })
      .where(eq(documents.id, id));

    return NextResponse.json({ status: 'indexing', chunkCount: docChunks.length });
  } catch (error) {
    // An AccessError must not mark someone else's document failed.
    if (!(error instanceof AccessError)) {
      // The raw message is logged, never stored. Drizzle's errors embed the full
      // SQL plus bound parameters, so storing them put the document's own text
      // into a field rendered straight into the page.
      console.error(`ingest failed for document ${id}`, error);

      await db.update(documents)
        .set({
          status: 'failed',
          error: 'We could not process this PDF. Retrying may help; if it keeps failing the file may be malformed.',
          updatedAt: new Date(),
        })
        .where(eq(documents.id, id))
        .catch(() => {});
    }
    return toErrorResponse(error);
  }
}
