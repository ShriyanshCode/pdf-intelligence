/**
 * Dev utility: show comments with their authorship and threading, plus share state.
 *
 *   npx tsx --env-file=.env.local scripts/inspect-collab.mts
 */
import { sql } from 'drizzle-orm';
import { db } from '../lib/db';

const comments = await db.execute<{
  author_label: string;
  is_reply: boolean;
  by_owner: boolean;
  by_guest: boolean;
  body: string;
}>(sql`
  SELECT author_label,
         parent_id IS NOT NULL       AS is_reply,
         author_user_id IS NOT NULL  AS by_owner,
         author_share_id IS NOT NULL AS by_guest,
         left(body, 80) AS body
    FROM comments
   ORDER BY created_at
`);

console.log('--- comments ---');
for (const c of comments) {
  console.log({
    author: c.author_label,
    attribution: c.by_owner ? 'owner (user row)' : c.by_guest ? 'guest (share row)' : 'UNATTRIBUTED',
    threaded: c.is_reply ? 'reply' : 'top-level',
    body: c.body,
  });
}

const shares = await db.execute<{
  invitee_name: string;
  invitee_email: string;
  can_comment: boolean;
  opened: boolean;
  revoked: boolean;
  token_length: number;
}>(sql`
  SELECT invitee_name, invitee_email, can_comment,
         last_viewed_at IS NOT NULL AS opened,
         revoked_at IS NOT NULL     AS revoked,
         length(token)              AS token_length
    FROM shares
   ORDER BY created_at
`);

console.log('\n--- shares ---');
for (const s of shares) console.log(s);

const threads = await db.execute<{ session_key: string; n: number }>(
  sql`SELECT session_key, count(*)::int AS n FROM chat_messages GROUP BY session_key`,
);
console.log('\n--- chat threads (isolation check) ---');
for (const t of threads) console.log(t);

process.exit(0);
