/**
 * Diagnoses a document stuck at status 'failed': re-runs extraction, inspects the
 * text for characters Postgres cannot store, and reproduces the write error
 * without mutating anything.
 *
 *   npx tsx --env-file=.env.local scripts/diagnose-failed.mts
 */
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import { documents } from '../lib/db/schema';
import { downloadObject, looksLikePdf } from '../lib/storage';
import { extractPdfText, chunkPages, hasUsableText } from '../lib/pdf';

const [doc] = await db
  .select()
  .from(documents)
  .where(eq(documents.status, 'failed'))
  .orderBy(desc(documents.createdAt))
  .limit(1);

if (!doc) {
  console.log('No failed documents.');
  process.exit(0);
}

console.log('--- document ---');
console.log({ filename: doc.filename, sizeBytes: doc.sizeBytes, storagePath: doc.storagePath });
console.log('stored error:', doc.error?.slice(0, 200));

const bytes = await downloadObject(doc.storagePath);
console.log('\n--- extraction ---');
console.log({ downloadedBytes: bytes.length, magicBytesOk: looksLikePdf(bytes) });

const { pages, pageCount, fullText, charCount } = await extractPdfText(bytes);
const chunks = chunkPages(pages);
console.log({
  pageCount,
  charCount,
  chunks: chunks.length,
  usable: hasUsableText(fullText, pageCount),
});

/*
 * Char-code scan rather than regex literals, so no escaping can be lost in
 * transit. Tab (9), newline (10), and carriage return (13) are legitimate.
 */
let nulBytes = 0;
let otherControl = 0;
let firstNulAt = -1;
for (let i = 0; i < fullText.length; i++) {
  const code = fullText.charCodeAt(i);
  if (code === 0) {
    nulBytes++;
    if (firstNulAt < 0) firstNulAt = i;
  } else if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
    otherControl++;
  }
}

console.log('\n--- problem characters in extracted text ---');
console.log({ nulBytes, otherControl, firstNulAt });
if (firstNulAt >= 0) {
  console.log('context around first NUL:', JSON.stringify(fullText.slice(Math.max(0, firstNulAt - 40), firstNulAt + 40)));
}

console.log('\n--- reproduce the write, read-only ---');
try {
  const r = await db.execute<{ len: number }>(sql`SELECT length(${fullText}::text) AS len`);
  console.log('OK: Postgres accepted the text, length =', r[0]?.len);
  console.log('=> character encoding is NOT the cause; look at timeout or connection size.');
} catch (error) {
  const e = error as { message?: string; cause?: { message?: string; code?: string } };
  console.log('FAILED, which reproduces the bug. Real Postgres error:');
  console.log({ code: e.cause?.code, message: (e.cause?.message ?? e.message)?.slice(0, 300) });
}

process.exit(0);
