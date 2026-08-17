import { randomBytes } from 'node:crypto';

/**
 * 32 random bytes, base64url encoded. The token IS the credential for a guest,
 * so it must be long enough that guessing is hopeless and safe to paste in a URL.
 */
export function generateShareToken(): string {
  return randomBytes(32).toString('base64url');
}

export function shareUrlFor(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/s/${token}`;
}
