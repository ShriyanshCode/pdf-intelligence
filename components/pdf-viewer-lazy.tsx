'use client';

import dynamic from 'next/dynamic';

/**
 * Loads the PDF viewer on the client only.
 *
 * `pdfjs-dist` touches browser globals (`DOMMatrix`, `Path2D`) at module scope.
 * Marking pdf-viewer.tsx 'use client' is not enough on its own: Next still
 * server-renders client components, so pdfjs was evaluated in Node and threw
 * `ReferenceError: DOMMatrix is not defined` — a 500 that appears only in a
 * production build, since dev's module handling masked it.
 *
 * ssr:false is only permitted inside a Client Component, which is why this thin
 * wrapper exists rather than the pages calling dynamic() themselves.
 */
export const PdfViewer = dynamic(
  () => import('./pdf-viewer').then((m) => m.PdfViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-neutral-100">
        <p className="text-sm text-neutral-500">Loading viewer…</p>
      </div>
    ),
  },
);
