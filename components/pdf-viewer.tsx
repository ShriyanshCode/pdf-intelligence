'use client';

import { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Served from public/, copied out of node_modules on postinstall so the worker
// version always matches react-pdf's bundled pdfjs-dist. A mismatch renders a
// blank page with no error.
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

export function PdfViewer({ fileUrl }: { fileUrl: string }) {
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-surface px-3 py-2 text-sm">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            aria-label="Previous page"
            className="rounded p-1 hover:bg-mist disabled:opacity-40"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="tabular-nums">{page} / {numPages || '—'}</span>
          <button
            onClick={() => setPage((p) => Math.min(numPages, p + 1))}
            disabled={page >= numPages}
            aria-label="Next page"
            className="rounded p-1 hover:bg-mist disabled:opacity-40"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}
            aria-label="Zoom out"
            className="rounded p-1 hover:bg-mist"
          >
            <ZoomOut className="size-4" />
          </button>
          <span className="tabular-nums">{Math.round(scale * 100)}%</span>
          <button
            onClick={() => setScale((s) => Math.min(2.5, s + 0.2))}
            aria-label="Zoom in"
            className="rounded p-1 hover:bg-mist"
          >
            <ZoomIn className="size-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-mist p-4">
        {error ? (
          <p role="alert" className="text-center text-sm text-error">{error}</p>
        ) : (
          <Document
            file={fileUrl}
            onLoadSuccess={({ numPages: n }) => { setNumPages(n); setError(null); }}
            onLoadError={(e) => setError(`Could not load this PDF: ${e.message}`)}
            loading={<p className="text-center text-sm text-ink/80">Loading PDF…</p>}
            className="flex justify-center"
          >
            <Page
              pageNumber={page}
              scale={scale}
              className="shadow-md [&>canvas]:h-auto [&>canvas]:max-w-full"
            />
          </Document>
        )}
      </div>
    </div>
  );
}
