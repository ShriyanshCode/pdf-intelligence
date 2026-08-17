/**
 * Dev utility: show the current state of the ingest pipeline.
 *
 *   npx tsx --env-file=.env.local scripts/inspect-documents.mts
 *
 * Useful for watching a document move uploading -> extracting -> summarizing ->
 * indexing -> ready, and for confirming chunks and embeddings actually landed.
 */
import { sql } from 'drizzle-orm';
import { db } from '../lib/db';

const rows = await db.execute<{
  filename: string;
  status: string;
  page_count: number | null;
  token_estimate: number | null;
  has_extractable_text: boolean | null;
  error: string | null;
  summary: string;
  chunks: number;
  embedded: number;
}>(sql`
  SELECT d.filename, d.status, d.page_count, d.token_estimate,
         d.has_extractable_text, d.error,
         coalesce(left(d.summary, 500), '(none)') AS summary,
         (SELECT count(*)::int FROM chunks c WHERE c.document_id = d.id) AS chunks,
         (SELECT count(*)::int FROM chunks c
           WHERE c.document_id = d.id AND c.embedding IS NOT NULL) AS embedded
    FROM documents d
   ORDER BY d.created_at DESC
   LIMIT 5
`);

for (const row of rows) {
  console.log('---');
  console.log({
    filename: row.filename,
    status: row.status,
    pages: row.page_count,
    tokens: row.token_estimate,
    usableText: row.has_extractable_text,
    chunks: row.chunks,
    embedded: row.embedded,
    error: row.error,
  });
  console.log('summary:', row.summary);
}

if (rows.length === 0) console.log('(no documents yet)');
process.exit(0);
