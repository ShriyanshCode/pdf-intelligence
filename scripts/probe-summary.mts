/**
 * Dev utility: exercise the real summary prompt against the live Gemini API.
 *
 *   npx tsx --env-file=.env.local scripts/probe-summary.mts
 *
 * Checks the properties the prompt is written to guarantee: specifics present,
 * no "This document" opener, 3-5 sentences. Cheap enough to re-run after any
 * prompt edit.
 */
import { summarizeDocument } from '../lib/ai/summarize';

const text = `MASTER SERVICES AGREEMENT

This Agreement is entered into on 4 April 2026 between Northwind Ltd, a company
registered in England (the "Supplier"), and Contoso GmbH of Munich (the "Customer").

The Supplier will provide managed database hosting and 24/7 incident response for
an initial term of 36 months at EUR 12,500 per calendar month, invoiced quarterly
in advance.

Either party may terminate for material breach on 30 days written notice. The
Customer may terminate for convenience after month 18 on 90 days notice, subject
to an early exit fee of EUR 25,000.

The Supplier's aggregate liability is capped at the total fees paid in the 12
months preceding the claim. Neither party is liable for indirect or consequential
loss. Governing law is the law of England and Wales.`;

const summary = await summarizeDocument({
  fullText: text,
  chunks: [{ content: text, pageStart: 1, pageEnd: 1 }],
  tokenEstimate: Math.ceil(text.length / 4),
});

console.log('--- summary ---\n' + summary + '\n');

const sentences = summary.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
const specifics = ['Northwind', 'Contoso', '12,500', '36'];

console.log('--- prompt compliance ---');
console.log({
  sentenceCount: sentences.length,
  sentenceCountInRange: sentences.length >= 3 && sentences.length <= 5,
  avoidsGenericOpener: !/^(This document|This paper|The following|In this report)/i.test(summary.trim()),
  specificsPresent: specifics.filter((s) => summary.includes(s)),
  specificsMissing: specifics.filter((s) => !summary.includes(s)),
  noBullets: !summary.includes('\n-') && !summary.includes('\n*'),
});
