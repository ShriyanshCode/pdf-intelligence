/**
 * react-pdf pins an exact pdfjs-dist version, and a worker/API version mismatch
 * renders a silently blank page. Copying the worker out of node_modules keeps the
 * two in lockstep automatically and avoids a runtime CDN dependency.
 *
 * Runs on postinstall, including on Vercel, so public/pdf.worker.min.mjs is a
 * build artifact rather than a committed file.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'));
const version = require('pdfjs-dist/package.json').version;

mkdirSync('public', { recursive: true });
copyFileSync(
  join(pdfjsRoot, 'build', 'pdf.worker.min.mjs'),
  join('public', 'pdf.worker.min.mjs'),
);

console.log(`Copied pdf.worker.min.mjs (pdfjs-dist ${version}) to public/`);
