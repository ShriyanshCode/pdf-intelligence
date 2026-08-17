/**
 * Dev utility: dump the persisted chat threads.
 *
 *   npx tsx --env-file=.env.local scripts/inspect-chat.mts
 *
 * Each thread is namespaced by session_key ('user:<id>' or 'share:<id>'), which
 * is how guests are kept from seeing each other's questions.
 */
import { sql } from 'drizzle-orm';
import { db } from '../lib/db';

const rows = await db.execute<{
  session_key: string;
  role: string;
  content: string;
  created_at: string;
}>(sql`SELECT session_key, role, content, created_at FROM chat_messages ORDER BY created_at`);

if (rows.length === 0) {
  console.log('(no chat messages)');
  process.exit(0);
}

let currentKey = '';
for (const row of rows) {
  if (row.session_key !== currentKey) {
    currentKey = row.session_key;
    console.log(`\n===== thread: ${currentKey} =====`);
  }
  console.log(`\n[${row.role.toUpperCase()}] ${row.content}`);
}

console.log(`\n\ntotal messages: ${rows.length}`);
process.exit(0);
