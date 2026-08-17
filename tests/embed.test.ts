import { describe, it, expect } from 'vitest';
import { l2Normalize, EMBED_DIMENSIONS } from '@/lib/ai/embed';

const magnitude = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

describe('l2Normalize', () => {
  it('scales a vector to unit length', () => {
    expect(magnitude(l2Normalize([3, 4]))).toBeCloseTo(1, 10);
  });

  it('leaves an already-normal vector effectively unchanged', () => {
    expect(l2Normalize([1, 0, 0])).toEqual([1, 0, 0]);
  });

  it('preserves direction', () => {
    const v = l2Normalize([3, 4]);
    expect(v[0] / v[1]).toBeCloseTo(3 / 4, 10);
  });

  it('returns a zero vector unchanged rather than producing NaN', () => {
    const v = l2Normalize([0, 0, 0]);
    expect(v).toEqual([0, 0, 0]);
    expect(v.some(Number.isNaN)).toBe(false);
  });

  it('handles negative components', () => {
    expect(magnitude(l2Normalize([-3, -4]))).toBeCloseTo(1, 10);
  });
});

describe('EMBED_DIMENSIONS', () => {
  it('is 768, under pgvector HNSW 2000-dimension index limit', () => {
    expect(EMBED_DIMENSIONS).toBe(768);
    expect(EMBED_DIMENSIONS).toBeLessThan(2000);
  });
});
