/**
 * Confirms the security properties the brief grades, against live data.
 *
 *   npx tsx --env-file=.env.local scripts/verify-security.mts
 */
import { sql } from 'drizzle-orm';
import { db } from '../lib/db';
import { verifyPassword } from '../lib/password';

const users = await db.execute<{ email: string; password_hash: string }>(
  sql`SELECT email, password_hash FROM users`,
);

console.log('--- password storage ---');
for (const user of users) {
  const isBcrypt = /^\$2[aby]\$\d{2}\$/.test(user.password_hash);
  const cost = user.password_hash.split('$')[2];
  console.log({
    email: user.email,
    storedIsBcrypt: isBcrypt,
    bcryptCost: cost,
    hashLength: user.password_hash.length,
    // The decisive check: the stored value must not be the password itself.
    looksLikePlaintext: user.password_hash.length < 30 || !isBcrypt,
    preview: user.password_hash.slice(0, 18) + '...',
  });
}

// Prove the stored hash actually validates the real password and rejects a wrong
// one — i.e. it is a working hash, not a coincidentally bcrypt-shaped string.
if (users.length > 0) {
  const hash = users[0].password_hash;
  console.log('--- verification behaviour ---');
  console.log({
    correctPasswordAccepted: await verifyPassword('pdf-intel-test-2026', hash),
    wrongPasswordRejected: !(await verifyPassword('pdf-intel-test-2027', hash)),
    emptyPasswordRejected: !(await verifyPassword('', hash)),
  });
}

console.log('--- email normalization ---');
const oddEmails = users.filter((u) => u.email !== u.email.trim().toLowerCase());
console.log({
  allEmailsNormalized: oddEmails.length === 0,
  offenders: oddEmails.map((u) => u.email),
});

process.exit(0);
