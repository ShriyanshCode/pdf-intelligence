import { describe, it, expect } from 'vitest';
import { looksLikePdf, storagePathFor, MAX_UPLOAD_BYTES } from '@/lib/storage';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('looksLikePdf', () => {
  it('accepts a normal PDF header', () => {
    expect(looksLikePdf(bytes('%PDF-1.7\nrest of file'))).toBe(true);
  });

  it('accepts a header preceded by junk, as real readers do', () => {
    expect(looksLikePdf(bytes('\n\n   %PDF-1.4 trailing'))).toBe(true);
  });

  it('rejects a PNG', () => {
    expect(looksLikePdf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(false);
  });

  it('rejects HTML renamed to .pdf', () => {
    expect(looksLikePdf(bytes('<!doctype html><html></html>'))).toBe(false);
  });

  it('rejects an empty buffer', () => {
    expect(looksLikePdf(new Uint8Array())).toBe(false);
  });

  it('rejects a header appearing only after the first 1024 bytes', () => {
    expect(looksLikePdf(bytes('x'.repeat(2000) + '%PDF-1.7'))).toBe(false);
  });
});

describe('storagePathFor', () => {
  it('namespaces objects by user then document', () => {
    expect(storagePathFor('u1', 'd1')).toBe('u1/d1.pdf');
  });
});

describe('MAX_UPLOAD_BYTES', () => {
  it('is 25MB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
  });
});
