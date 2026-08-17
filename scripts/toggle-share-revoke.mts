/**
 * Dev utility: revoke or restore the most recent share, to test that a revoked
 * link stops working.
 *
 *   npx tsx --env-file=.env.local scripts/toggle-share-revoke.mts revoke
 *   npx tsx --env-file=.env.local scripts/toggle-share-revoke.mts restore
 */
import { sql } from 'drizzle-orm';
import { db } from '../lib/db';

const mode = process.argv[2];
if (mode !== 'revoke' && mode !== 'restore') {
  console.error('Usage: toggle-share-revoke.mts <revoke|restore>');
  process.exit(1);
}

const value = mode === 'revoke' ? sql`now()` : sql`NULL`;

const rows = await db.execute<{ token: string; revoked_at: string | null }>(sql`
  UPDATE shares SET revoked_at = ${value}
   WHERE id = (SELECT id FROM shares ORDER BY created_at DESC LIMIT 1)
  RETURNING token, revoked_at
`);

console.log({ mode, token: rows[0]?.token.slice(0, 12) + '...', revokedAt: rows[0]?.revoked_at });
process.exit(0);
