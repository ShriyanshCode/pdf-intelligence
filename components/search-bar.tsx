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
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-bark/60"
          aria-hidden
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            mode === 'filename' ? 'Search filenames…' : 'Search by what documents are about…'
          }
          aria-label="Search documents"
          className="w-full rounded-md border border-line py-2 pl-9 pr-3 outline-none focus:border-ember"
        />
      </div>

      <div className="flex rounded-md border border-line p-0.5 text-sm" role="group" aria-label="Search mode">
        {(['filename', 'meaning'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`rounded px-3 py-1.5 capitalize transition ${
              mode === m ? 'bg-bark text-cream' : 'text-bark'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <button
        type="submit"
        className="rounded-md bg-bark px-4 py-2 text-sm text-cream hover:bg-cocoa"
      >
        Search
      </button>
    </form>
  );
}
