'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, AlertCircle, ScanLine, Trash2 } from 'lucide-react';
import { formatDate, formatBytes } from '@/lib/format';
import { deleteDocument } from '@/app/(app)/dashboard/actions';

export type CardDocument = {
  id: string;
  filename: string;
  status: string;
  summary: string | null;
  error: string | null;
  pageCount: number | null;
  sizeBytes: number;
  hasExtractableText: boolean | null;
  shareCount: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  matchSnippet?: string | null;
};

const STAGE_LABEL: Record<string, string> = {
  uploading: 'Uploading…',
  extracting: 'Extracting text…',
  summarizing: 'Writing summary…',
  indexing: 'Indexing for search…',
};

const TERMINAL = new Set(['ready', 'failed']);
const STALE_MS = 90_000;
const POLL_MS = 2500;

/**
 * Owns advancing a document through its stages, which covers two cases with one
 * code path: the tab that uploaded it, and a tab opened later on a document whose
 * uploader disappeared mid-pipeline. Every stage is idempotent, so re-triggering
 * is always safe.
 */
export function DocumentCard({ doc }: { doc: CardDocument }) {
  const router = useRouter();
  const [state, setState] = useState(doc);
  const driving = useRef(false);

  useEffect(() => setState(doc), [doc]);

  useEffect(() => {
    if (TERMINAL.has(state.status)) return;

    let cancelled = false;

    async function drive(status: string, updatedAt: string | Date) {
      if (driving.current) return;

      if (status === 'indexing') {
        driving.current = true;
        try {
          let done = false;
          while (!done && !cancelled) {
            const res = await fetch(`/api/documents/${doc.id}/embed`, { method: 'POST' });
            if (!res.ok) break;
            done = (await res.json()).done;
          }
        } finally {
          driving.current = false;
        }
        return;
      }

      // Only re-trigger a stage that has visibly stalled — this is what recovers
      // a document whose uploader closed the tab.
      const stalled = Date.now() - new Date(updatedAt).getTime() > STALE_MS;
      if (stalled && ['uploading', 'extracting', 'summarizing'].includes(status)) {
        driving.current = true;
        try {
          await fetch(`/api/documents/${doc.id}/ingest`, { method: 'POST' });
        } finally {
          driving.current = false;
        }
      }
    }

    async function poll() {
      try {
        const res = await fetch(`/api/documents/${doc.id}/status`);
        if (!res.ok || cancelled) return;
        const next = await res.json();

        setState((prev) => ({ ...prev, ...next }));
        if (TERMINAL.has(next.status)) {
          router.refresh();
          return;
        }
        await drive(next.status, next.updatedAt);
      } catch {
        // Transient network failure; the next tick retries.
      }
    }

    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [doc.id, state.status, router]);

  const isScanned = state.status === 'ready' && state.hasExtractableText === false;

  return (
    <article className="flex flex-col gap-3 rounded-lg border p-4 transition hover:border-neutral-400">
      <div className="flex items-start gap-3">
        <FileText className="mt-0.5 size-5 shrink-0 text-neutral-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <Link href={`/d/${doc.id}`} className="block truncate font-medium hover:underline">
            {state.filename}
          </Link>
          <p className="mt-0.5 text-xs text-neutral-500">
            {formatDate(state.createdAt)} · {formatBytes(state.sizeBytes)}
            {state.pageCount ? ` · ${state.pageCount} pages` : ''}
            {state.shareCount > 0 ? ` · shared with ${state.shareCount}` : ''}
          </p>
        </div>
        <form
          action={async () => { await deleteDocument(doc.id); }}
          onSubmit={(e) => {
            if (!confirm(`Delete "${state.filename}"? This cannot be undone.`)) e.preventDefault();
          }}
        >
          <button
            type="submit"
            aria-label={`Delete ${state.filename}`}
            className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-700"
          >
            <Trash2 className="size-4" />
          </button>
        </form>
      </div>

      {state.status === 'failed' ? (
        <div className="flex items-start gap-2 rounded-md bg-red-50 p-2 text-sm text-red-800">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p>{state.error ?? 'Processing failed.'}</p>
            <button
              onClick={async () => {
                setState((p) => ({ ...p, status: 'extracting', error: null }));
                await fetch(`/api/documents/${doc.id}/ingest`, { method: 'POST' });
              }}
              className="mt-1 underline"
            >
              Retry
            </button>
          </div>
        </div>
      ) : isScanned ? (
        <p className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800">
          <ScanLine className="mt-0.5 size-4 shrink-0" aria-hidden />
          No extractable text — this looks like a scanned document, so summary and chat are unavailable.
        </p>
      ) : TERMINAL.has(state.status) ? (
        <p className="text-sm leading-relaxed text-neutral-700">{state.summary}</p>
      ) : (
        <p className="flex items-center gap-2 text-sm text-neutral-500">
          <span
            aria-hidden
            className="size-3 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700"
          />
          {STAGE_LABEL[state.status] ?? 'Processing…'}
        </p>
      )}

      {state.matchSnippet && (
        <p className="border-l-2 border-neutral-300 pl-3 text-xs italic text-neutral-600">
          …{state.matchSnippet}…
        </p>
      )}
    </article>
  );
}
