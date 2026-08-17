import bcrypt from 'bcryptjs';

/**
 * Password hashing and email normalization, deliberately kept free of any
 * dependency on the session framework.
 *
 * This split is not cosmetic: lib/auth.ts imports next-auth, which reaches for
 * next/server and therefore cannot be loaded outside the Next bundler. Keeping
 * these primitives here means the security-critical code stays unit-testable in
 * plain Node, and consumers that only need hashing do not drag in an auth stack.
 */

/**
 * Cost 12: roughly 250ms per hash on Vercel's Hobby CPU. High enough to make
 * offline cracking expensive, low enough to stay well inside the function timeout.
 */
const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  // bcrypt.compare throws on a structurally invalid hash. A corrupted row must
  // read as "wrong password", never as a 500 that reveals which accounts exist.
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
