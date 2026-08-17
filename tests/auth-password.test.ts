import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, normalizeEmail } from '@/lib/auth';

describe('password hashing', () => {
  it('never returns the plaintext', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toContain('correct horse battery staple');
  });

  it('produces a bcrypt hash with cost 12', async () => {
    const hash = await hashPassword('hunter2hunter2');
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
  });

  it('salts: the same password hashes differently each time', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });

  it('verifies a correct password', async () => {
    const hash = await hashPassword('s3cret-passphrase');
    await expect(verifyPassword('s3cret-passphrase', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('s3cret-passphrase');
    await expect(verifyPassword('s3cret-passphras', hash)).resolves.toBe(false);
  });

  it('rejects rather than throws on a malformed hash', async () => {
    await expect(verifyPassword('anything', 'not-a-bcrypt-hash')).resolves.toBe(false);
  });

  it('rejects an empty candidate against a real hash', async () => {
    const hash = await hashPassword('s3cret-passphrase');
    await expect(verifyPassword('', hash)).resolves.toBe(false);
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Shriyansh@Example.COM ')).toBe('shriyansh@example.com');
  });
});
