/**
 * Dev utility: run the real extraction and chunking pipeline over a PDF on disk.
 *
 *   npx tsx scripts/probe-pdf.mts "C:/path/to/file.pdf"
 *
 * The unit suite never exercises unpdf, so this is how an API mismatch or a
 * pathological chunking case gets caught against real input.
 */
import { readFileSync } from 'node:fs';
import { extractPdfText, chunkPages, hasUsableText, MAX_CHUNK_TOKENS } from '../lib/pdf';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npx tsx scripts/probe-pdf.mts <file.pdf>');
  process.exit(1);
}

const bytes = new Uint8Array(readFileSync(file));
const extracted = await extractPdfText(bytes);
const chunks = chunkPages(extracted.pages);

const maxTokens = chunks.reduce((m, c) => Math.max(m, c.tokenCount), 0);

console.log({
  pageCount: extracted.pageCount,
  charCount: extracted.charCount,
  usableText: hasUsableText(extracted.fullText, extracted.pageCount),
  chunkCount: chunks.length,
  maxChunkTokens: maxTokens,
  ceilingRespected: maxTokens <= MAX_CHUNK_TOKENS,
  idxContiguous: chunks.every((c, i) => c.idx === i),
  pagesMonotonic: chunks.every((c, i) => i === 0 || c.pageStart >= chunks[i - 1].pageStart),
  lastPageCited: chunks.reduce((m, c) => Math.max(m, c.pageEnd), 0),
});

console.log('\n--- first chunk ---\n' + (chunks[0]?.content.slice(0, 300) ?? '(none)'));
