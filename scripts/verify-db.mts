/**
 * Confirms the live schema matches what the app expects.
 *
 *   npx tsx --env-file=.env.local scripts/verify-db.mts
 */
import { sql } from 'drizzle-orm';
import { db } from '../lib/db';

const expectedTables = [
  'users', 'documents', 'chunks', 'shares', 'comments', 'chat_messages',
  'password_reset_tokens',
];

const tableRows = await db.execute<{ table_name: string }>(
  sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
);
const found = tableRows.map((r) => r.table_name);
const missing = expectedTables.filter((t) => !found.includes(t));

const extRows = await db.execute<{ extname: string }>(
  sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`,
);

const vectorCol = await db.execute<{ udt_name: string }>(
  sql`SELECT udt_name FROM information_schema.columns
       WHERE table_name = 'chunks' AND column_name = 'embedding'`,
);

const indexRows = await db.execute<{ indexname: string; indexdef: string }>(
  sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'chunks'`,
);

const checkRows = await db.execute<{ conname: string }>(
  sql`SELECT conname FROM pg_constraint WHERE conname = 'comments_author_present'`,
);

const fkRows = await db.execute<{ conname: string }>(
  sql`SELECT conname FROM pg_constraint
       WHERE conrelid = 'comments'::regclass AND contype = 'f'`,
);

console.log({
  tablesFound: found.filter((t) => expectedTables.includes(t)).sort(),
  tablesMissing: missing,
  pgvectorInstalled: extRows.length > 0,
  embeddingColumnType: vectorCol[0]?.udt_name ?? '(absent)',
  hnswIndex: indexRows.some((i) => i.indexdef.includes('hnsw')),
  chunkIndexes: indexRows.map((i) => i.indexname),
  authorPresentCheck: checkRows.length > 0,
  commentForeignKeys: fkRows.map((f) => f.conname),
});

if (missing.length) {
  console.error(`\nFAIL: missing tables: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('\nOK: schema is in place');
process.exit(0);
