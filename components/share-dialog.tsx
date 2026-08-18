'use client';

import { useState } from 'react';
import { Check, Copy, Share2, X } from 'lucide-react';
import { formatDate } from '@/lib/format';
import {
  createShare, revokeShare, listShares, type ShareListItem,
} from '@/app/(app)/d/[id]/share-actions';

export function ShareDialog({
  documentId, initialShares,
}: {
  documentId: string;
  initialShares: ShareListItem[];
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(initialShares);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [canComment, setCanComment] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [emailed, setEmailed] = useState<boolean | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await createShare(documentId, {
        inviteeEmail: email, inviteeName: name, canComment,
      });
      if ('error' in result && result.error) {
        setError(result.error);
        return;
      }
      setLastUrl(result.url!);
      setEmailed(result.emailed ?? false);
      setRows(await listShares(documentId));
      setEmail('');
      setName('');
    } catch {
      setError('Could not create the share link.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('Could not copy. Select the link and copy it manually.');
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-sand"
      >
        <Share2 className="size-4" aria-hidden /> Share
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-cocoa/50 p-4"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg bg-cream p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Share this PDF"
          >
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-semibold">Share this PDF</h2>
              <button onClick={() => setOpen(false)} aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-1 text-sm text-bark">
              The invitee gets a private link. They do not need an account.
            </p>

            <form onSubmit={submit} className="mt-4 space-y-3">
              <input
                value={name} onChange={(e) => setName(e.target.value)} required maxLength={100}
                placeholder="Their name" aria-label="Invitee name"
                className="w-full rounded-md border border-line px-3 py-2 text-sm"
              />
              <input
                value={email} onChange={(e) => setEmail(e.target.value)} required type="email"
                placeholder="their@email.com" aria-label="Invitee email"
                className="w-full rounded-md border border-line px-3 py-2 text-sm"
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox" checked={canComment}
                  onChange={(e) => setCanComment(e.target.checked)}
                />
                Allow them to comment
              </label>

              {error && <p role="alert" className="text-sm text-error">{error}</p>}

              <button
                type="submit" disabled={busy}
                className="w-full rounded-md bg-bark px-4 py-2 text-sm text-cream disabled:opacity-50"
              >
                {busy ? 'Creating…' : 'Create link and email it'}
              </button>
            </form>

            {lastUrl && (
              <div className="mt-3 rounded-md bg-sand p-2">
                <div className="flex items-center gap-2">
                  <input
                    readOnly value={lastUrl} aria-label="Share link"
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 bg-transparent text-xs"
                  />
                  <button onClick={() => copy(lastUrl)} aria-label="Copy link">
                    {copied === lastUrl ? <Check className="size-4" /> : <Copy className="size-4" />}
                  </button>
                </div>
                {emailed === false && (
                  <p className="mt-1 text-xs text-bark">
                    Link created. Email was not sent — copy the link and send it yourself.
                  </p>
                )}
              </div>
            )}

            {rows.length > 0 && (
              <div className="mt-4 border-t pt-3">
                <h3 className="text-xs font-medium uppercase tracking-wide text-bark/80">
                  Shared with
                </h3>
                <ul className="mt-2 space-y-2">
                  {rows.map((share) => (
                    <li key={share.id} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate">{share.inviteeName}</p>
                        <p className="truncate text-xs text-bark/80">
                          {share.inviteeEmail}
                          {share.lastViewedAt
                            ? ` · viewed ${formatDate(share.lastViewedAt)}`
                            : ' · not opened yet'}
                          {!share.canComment ? ' · read only' : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button onClick={() => copy(share.url)} aria-label={`Copy link for ${share.inviteeName}`}>
                          {copied === share.url ? <Check className="size-4" /> : <Copy className="size-4" />}
                        </button>
                        <button
                          onClick={async () => {
                            await revokeShare(share.id, documentId);
                            setRows(await listShares(documentId));
                          }}
                          className="text-xs text-error underline"
                        >
                          Revoke
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
