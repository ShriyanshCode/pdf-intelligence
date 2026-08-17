/**
 * Dev utility: verify embeddings against the live API.
 *
 *   npx tsx --env-file=.env.local scripts/probe-embed.mts
 *
 * Checks dimensionality, that normalization actually happened, and that
 * similarity separates related from unrelated text. A magnitude other than 1
 * means l2Normalize is not being applied and cosine ranking will be wrong.
 */
import { embedTexts, embedQuery, EMBED_DIMENSIONS } from '../lib/ai/embed';

const documents = [
  'The Employee shall serve as Senior Engineer and may terminate this contract on one month notice.',
  'Preheat the oven to 180C and whisk the eggs with the caster sugar until pale.',
];

const vectors = await embedTexts(documents, 'RETRIEVAL_DOCUMENT');
const query = await embedQuery('employment contract');

const magnitude = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

const employmentScore = dot(query, vectors[0]);
const recipeScore = dot(query, vectors[1]);

console.log({
  count: vectors.length,
  dimensions: vectors[0].length,
  dimensionsCorrect: vectors[0].length === EMBED_DIMENSIONS,
  magnitude: Number(magnitude(vectors[0]).toFixed(6)),
  normalized: Math.abs(magnitude(vectors[0]) - 1) < 1e-6,
  queryMagnitude: Number(magnitude(query).toFixed(6)),
});

console.log({
  'similarity: "employment contract" vs employment clause': Number(employmentScore.toFixed(4)),
  'similarity: "employment contract" vs cake recipe': Number(recipeScore.toFixed(4)),
  // This is the property semantic search depends on.
  separatesRelatedFromUnrelated: employmentScore > recipeScore,
  marginAboveFloor: Number((employmentScore - recipeScore).toFixed(4)),
});
