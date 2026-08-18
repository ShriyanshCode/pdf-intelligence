'use client';

import { useRef, useState } from 'react';
import { Bold, Italic, List } from 'lucide-react';

export function CommentComposer({
  onSubmit, placeholder = 'Add a comment…', compact = false,
}: {
  onSubmit: (body: string) => Promise<string | null>;
  placeholder?: string;
  compact?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Wraps the selection, or inserts markers at the caret when nothing is selected. */
  function wrap(marker: string) {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const selected = body.slice(start, end);
    setBody(body.slice(0, start) + marker + selected + marker + body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + marker.length, start + marker.length + selected.length);
    });
  }

  function bulletList() {
    const el = ref.current;
    if (!el) return;
    const lineStart = body.lastIndexOf('\n', Math.max(0, el.selectionStart - 1)) + 1;
    setBody(body.slice(0, lineStart) + '- ' + body.slice(lineStart));
    requestAnimationFrame(() => el.focus());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError(null);
    const failure = await onSubmit(trimmed);
    if (failure) setError(failure);
    else setBody('');
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-1" role="group" aria-label="Formatting">
        <button type="button" onClick={() => wrap('**')} aria-label="Bold"
          className="rounded-full p-1.5 hover:bg-mist"><Bold className="size-3.5" /></button>
        <button type="button" onClick={() => wrap('*')} aria-label="Italic"
          className="rounded-full p-1.5 hover:bg-mist"><Italic className="size-3.5" /></button>
        <button type="button" onClick={bulletList} aria-label="Bullet list"
          className="rounded-full p-1.5 hover:bg-mist"><List className="size-3.5" /></button>
      </div>

      <textarea
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={compact ? 2 : 3}
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={5000}
        className="w-full resize-none rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-clay"
      />

      {error && <p role="alert" className="text-sm text-error">{error}</p>}

      <button
        type="submit"
        disabled={busy || !body.trim()}
        className="rounded-full bg-ink px-4 py-2 text-sm text-white transition hover:bg-clay-deep disabled:opacity-40"
      >
        {busy ? 'Posting…' : 'Post'}
      </button>
    </form>
  );
}
