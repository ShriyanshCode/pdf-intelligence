import { describe, it, expect } from 'vitest';
import { estimateTokens } from '@/lib/tokens';

describe('estimateTokens', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('approximates 4 characters per token, rounding up', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('scales roughly linearly for prose', () => {
    const prose = 'The quick brown fox jumps over the lazy dog. '.repeat(100);
    const t = estimateTokens(prose);
    expect(t).toBeGreaterThan(900);
    expect(t).toBeLessThan(1400);
  });

  it('never returns a fractional count', () => {
    expect(Number.isInteger(estimateTokens('seven chars'))).toBe(true);
  });
});
