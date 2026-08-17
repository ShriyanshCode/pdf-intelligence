import bcrypt from 'bcryptjs';

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
