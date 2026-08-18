import { createHash, randomBytes } from 'node:crypto';

/** How long a reset link stays valid. Short enough to limit exposure if forwarded. */
export const RESET_TOKEN_TTL_MINUTES = 60;

/** 32 random bytes, base64url. This value is emailed and never stored. */
export function generateResetToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Only the hash goes in the database, so a leaked table cannot be used to reset
 * anyone's password. SHA-256 is the right choice over bcrypt here: the input is
 * 256 bits of randomness rather than a guessable secret, and lookup has to be a
 * deterministic index hit.
 */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function resetUrlFor(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}
