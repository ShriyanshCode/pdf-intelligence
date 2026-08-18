'use client';

import { useEffect, useRef, useState } from 'react';
import { SendHorizontal } from 'lucide-react';

type Msg = { role: 'user' | 'assistant'; content: string };

export function ChatPanel({
  documentId, shareToken, enabled, disabledReason,
}: {
  documentId: string;
  shareToken?: string;
  enabled: boolean;
  disabledReason?: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const params = new URLSearchParams({ documentId });
    if (shareToken) params.set('shareToken', shareToken);
    fetch(`/api/chat?${params}`)
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d) => setMessages(d.messages ?? []))
      .catch(() => {});
  }, [documentId, shareToken, enabled]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  async function send() {
    const question = input.trim();
    if (!question || streaming) return;

    setInput('');
    setError(null);
    setMessages((m) => [...m, { role: 'user', content: question }, { role: 'assistant', content: '' }]);
    setStreaming(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentId, question, shareToken }),
      });

      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error ?? 'The request failed.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      // Append each decoded chunk to the trailing assistant message as it arrives.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        setMessages((m) => {
          const next = [...m];
          const last = next[next.length - 1];
          next[next.length - 1] = { role: 'assistant', content: last.content + text };
          return next;
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      // Drop the empty placeholder so the transcript is not left with a blank turn.
      setMessages((m) => m.filter((msg, i) => !(i === m.length - 1 && msg.content === '')));
    } finally {
      setStreaming(false);
    }
  }

  if (!enabled) {
    return (
      <p className="p-4 text-sm text-ink/80">
        {disabledReason ?? 'Chat is unavailable for this document.'}
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="text-sm text-ink/80">
            <p className="font-medium text-ink">Ask about this document</p>
            <p className="mt-1">Answers cite page numbers and stay grounded in the text.</p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <div
              className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-left text-sm ${
                m.role === 'user' ? 'bg-ink text-white' : 'bg-mist text-ink'
              }`}
            >
              {m.content || (streaming ? '…' : '')}
            </div>
          </div>
        ))}

        {error && <p role="alert" className="text-sm text-error">{error}</p>}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void send(); }}
        className="flex shrink-0 items-end gap-2 border-t p-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder="Ask a question…"
          aria-label="Ask a question about this document"
          className="flex-1 resize-none rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-clay"
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          aria-label="Send question"
          className="rounded-full bg-ink p-2.5 text-white transition hover:bg-clay-deep disabled:opacity-40"
        >
          <SendHorizontal className="size-4" />
        </button>
      </form>
    </div>
  );
}
