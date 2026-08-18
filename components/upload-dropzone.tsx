'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { UploadCloud } from 'lucide-react';
import { createUploadTarget } from '@/app/(app)/dashboard/actions';

const MAX_BYTES = 25 * 1024 * 1024;

export function UploadDropzone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [, startTransition] = useTransition();

  async function handleFile(file: File) {
    setError(null);

    // First-line validation for fast feedback. The server independently verifies
    // the %PDF- magic bytes, which is the check that actually matters.
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are accepted.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('That file is larger than 25MB.');
      return;
    }

    setBusy(true);
    try {
      const { documentId, signedUrl } = await createUploadTarget(file.name, file.size);

      // Straight to Supabase Storage: Vercel caps request bodies at 4.5MB.
      const upload = await fetch(signedUrl, {
        method: 'PUT',
        body: file,
        headers: { 'content-type': 'application/pdf' },
      });
      if (!upload.ok) throw new Error('Upload failed. Please try again.');

      // Kick off stage one, then let the card drive the remaining stages.
      void fetch(`/api/documents/${documentId}/ingest`, { method: 'POST' });
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Upload a PDF"
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition ${
          dragging ? 'border-ember bg-ember-surface' : 'border-line hover:border-bark/50'
        } ${busy ? 'pointer-events-none opacity-60' : ''}`}
      >
        <UploadCloud className="size-6 text-ember" aria-hidden />
        <p className="text-sm font-medium">
          {busy ? 'Uploading…' : 'Drop a PDF here, or click to choose'}
        </p>
        <p className="text-xs text-bark/80">PDF only, up to 25MB</p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
    </div>
  );
}
