import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { documents, shares } from '@/lib/db/schema';
import { UploadDropzone } from '@/components/upload-dropzone';
import { DocumentCard, type CardDocument } from '@/components/document-card';
import { SearchBar } from '@/components/search-bar';
import { semanticSearch } from '@/lib/ai/search';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; mode?: string }>;
}) {
  const { q, mode } = await searchParams;
  const session = await auth();
  const userId = session!.user.id;

  const shareCount = sql<number>`(
    SELECT count(*)::int FROM ${shares}
     WHERE ${shares.documentId} = ${documents.id} AND ${shares.revokedAt} IS NULL
  )`;

  let docs: CardDocument[];
  let searchFailed = false;

  if (q && mode === 'meaning') {
    try {
      docs = await semanticSearch(userId, q);
    } catch (error) {
      // An embedding failure must not blank the dashboard.
      console.error('semantic search failed', error);
      docs = [];
      searchFailed = true;
    }
  } else {
    docs = await db
      .select({
        id: documents.id, filename: documents.filename, status: documents.status,
        summary: documents.summary, error: documents.error, pageCount: documents.pageCount,
        sizeBytes: documents.sizeBytes, hasExtractableText: documents.hasExtractableText,
        createdAt: documents.createdAt, updatedAt: documents.updatedAt,
        shareCount,
      })
      .from(documents)
      .where(
        q
          ? and(eq(documents.ownerId, userId), ilike(documents.filename, `%${q}%`))
          : eq(documents.ownerId, userId),
      )
      .orderBy(desc(documents.createdAt));
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <UploadDropzone />
      <SearchBar />

      {q && !searchFailed && (
        <p className="text-sm text-neutral-600">
          {docs.length} result{docs.length === 1 ? '' : 's'} for “{q}”
          {mode === 'meaning' ? ' by meaning' : ' by filename'}
        </p>
      )}

      {searchFailed && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Semantic search is unavailable right now. Try filename search instead.
        </p>
      )}

      {docs.length === 0 && !searchFailed ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-neutral-500">
          {q
            ? 'Nothing matched. Try the other search mode.'
            : 'No documents yet — upload your first PDF above.'}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {docs.map((doc) => (
            <DocumentCard key={doc.id} doc={doc} />
          ))}
        </div>
      )}
    </main>
  );
}
