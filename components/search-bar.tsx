'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Search } from 'lucide-react';

export function SearchBar() {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [mode, setMode] = useState(params.get('mode') === 'meaning' ? 'meaning' : 'filename');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams();
    if (query.trim()) next.set('q', query.trim());
    next.set('mode', mode);
    router.push(`/dashboard?${next.toString()}`);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-clay"
          aria-hidden
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            mode === 'filename' ? 'Search filenames…' : 'Search by what documents are about…'
          }
          aria-label="Search documents"
          className="w-full rounded-full border border-line bg-surface py-2.5 pl-10 pr-4 outline-none transition focus:border-clay"
        />
      </div>

      <div className="flex rounded-full border border-line bg-surface p-1 text-sm" role="group" aria-label="Search mode">
        {(['filename', 'meaning'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`rounded-full px-3.5 py-1.5 capitalize transition ${
              mode === m ? 'bg-ink text-white' : 'text-ink/80'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <button
        type="submit"
        className="rounded-full bg-ink px-5 py-2 text-sm text-white transition hover:bg-clay-deep"
      >
        Search
      </button>
    </form>
  );
}
