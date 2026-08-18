import { Sparkles, ScanLine, AlertCircle } from 'lucide-react';

type Props = {
  filename: string;
  status: string;
  summary: string | null;
  error: string | null;
  hasExtractableText: boolean | null;
  pageCount: number | null;
};

export function SummaryBanner({
  filename, status, summary, error, hasExtractableText, pageCount,
}: Props) {
  const body =
    status === 'failed' ? (
      <p className="flex items-start gap-2 text-sm text-error">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {error ?? 'This document could not be processed.'}
      </p>
    ) : hasExtractableText === false ? (
      <p className="flex items-start gap-2 text-sm text-ink/80">
        <ScanLine className="mt-0.5 size-4 shrink-0" aria-hidden />
        No extractable text found — this looks like a scanned document, so summary and chat are unavailable.
      </p>
    ) : summary ? (
      <p className="text-sm leading-relaxed text-ink">{summary}</p>
    ) : (
      <p className="text-sm text-ink/80">Generating summary…</p>
    );

  return (
    <div className="shrink-0 border-b bg-surface px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight">{filename}</h1>
        {pageCount ? (
          <span className="text-xs text-ink/80">{pageCount} pages</span>
        ) : null}
      </div>

      {/* Collapsed on small screens so the PDF itself stays the focus. */}
      <details className="mt-2 lg:hidden" open>
        <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-ink/80">
          AI summary
        </summary>
        <div className="mt-1">{body}</div>
      </details>

      <div className="mt-2 hidden items-start gap-2 lg:flex">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-clay" aria-hidden />
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink/80">AI summary</p>
          <div className="mt-0.5">{body}</div>
        </div>
      </div>
    </div>
  );
}
