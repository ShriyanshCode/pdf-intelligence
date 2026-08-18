/**
 * Verifies password reset behaviour against live data.
 *
 *   npx tsx --env-file=.env.local scripts/verify-reset.mts <email> <newPassword> [oldPassword]
 */
import { eq, desc } from 'drizzle-orm';
import { db } from '../lib/db';
import { users, passwordResetTokens } from '../lib/db/schema';
import { verifyPassword } from '../lib/password';

const [email, newPassword, oldPassword] = process.argv.slice(2);
if (!email || !newPassword) {
  console.error('Usage: verify-reset.mts <email> <newPassword> [oldPassword]');
  process.exit(1);
}

const [user] = await db
  .select({ id: users.id, hash: users.passwordHash })
  .from(users)
  .where(eq(users.email, email))
  .limit(1);

if (!user) {
  console.error(`No user for ${email}`);
  process.exit(1);
}

const tokens = await db
  .select({
    hashPrefix: passwordResetTokens.tokenHash,
    expiresAt: passwordResetTokens.expiresAt,
    usedAt: passwordResetTokens.usedAt,
  })
  .from(passwordResetTokens)
  .where(eq(passwordResetTokens.userId, user.id))
  .orderBy(desc(passwordResetTokens.createdAt));

console.log('--- password ---');
console.log({
  storedIsBcryptCost12: /^\$2[aby]\$12\$/.test(user.hash),
  newPasswordWorks: await verifyPassword(newPassword, user.hash),
  oldPasswordRejected: oldPassword ? !(await verifyPassword(oldPassword, user.hash)) : '(not checked)',
});

console.log('\n--- reset tokens for this user ---');
for (const t of tokens) {
  console.log({
    // Confirms the raw token is not recoverable from the table.
    storedValueIsSha256Hash: /^[0-9a-f]{64}$/.test(t.hashPrefix),
    tokenPrefix: t.hashPrefix.slice(0, 12) + '…',
    used: t.usedAt !== null,
    expiresAt: t.expiresAt,
  });
}

const live = tokens.filter((t) => t.usedAt === null && t.expiresAt > new Date());
console.log('\nlive (reusable) tokens remaining:', live.length, live.length === 0 ? '— single-use enforced' : '— PROBLEM');

process.exit(0);
