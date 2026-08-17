import { getAi, withRetry, EMBED_MODEL } from './gemini';

export const EMBED_DIMENSIONS = 768;
export const EMBED_BATCH_SIZE = 24;

export type EmbedTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

/**
 * gemini-embedding-001 returns unit-length vectors ONLY at its native 3072
 * dimensions. Because we request 768 (pgvector's HNSW index caps at 2000), the
 * vectors arrive unnormalized and cosine distance would be wrong unless we
 * normalize here.
 */
export function l2Normalize(vector: number[]): number[] {
  let sumSquares = 0;
  for (const value of vector) sumSquares += value * value;
  const magnitude = Math.sqrt(sumSquares);
  if (magnitude === 0) return vector.slice();
  return vector.map((value) => value / magnitude);
}

export async function embedTexts(
  texts: string[],
  taskType: EmbedTaskType,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBED_BATCH_SIZE);

    const response = await withRetry(() =>
      getAi().models.embedContent({
        model: EMBED_MODEL,
        contents: batch,
        config: { taskType, outputDimensionality: EMBED_DIMENSIONS },
      }),
    );

    const embeddings = response.embeddings ?? [];
    if (embeddings.length !== batch.length) {
      throw new Error(`Embedding count mismatch: sent ${batch.length}, got ${embeddings.length}`);
    }
    for (const embedding of embeddings) {
      vectors.push(l2Normalize(embedding.values ?? []));
    }
  }

  return vectors;
}

/**
 * Queries use a different task type than documents. The model is asymmetric, and
 * using the matching pair is a real retrieval gain over embedding both sides
 * identically.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text], 'RETRIEVAL_QUERY');
  return vector;
}
