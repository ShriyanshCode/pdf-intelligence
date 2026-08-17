import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { shares } from '@/lib/db/schema';
import { resolveShareToken } from '@/lib/authz';
import { createSignedViewUrl } from '@/lib/storage';
import { PdfViewer } from '@/components/pdf-viewer';
import { SummaryBanner } from '@/components/summary-banner';
import { ViewerLayout } from '@/components/viewer-layout';
import { ChatPanel } from '@/components/chat-panel';
import { CommentsPanel } from '@/components/comments-panel';
// Read through lib/data, not the Server Action: functions exported from a
// 'use server' module are POST endpoints and cannot be called during render.
import { listCommentsForViewer } from '@/lib/data/comments';

/** Public: no session required. The token itself is the credential. */
export default async function SharedDocumentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const resolved = await resolveShareToken(token);
  // Unknown and revoked tokens produce an identical response, so neither reveals
  // whether the document exists.
  if (!resolved) notFound();

  const { document: doc, share } = resolved;

  // Awaited rather than fire-and-forget: on Vercel the function can be frozen once
  // the response completes, so an un-awaited promise may never run and the
  // "last viewed" timestamp would silently never update in production. It is
  // batched with the other reads so it costs no extra wall time, and a failure
  // still cannot block the page.
  const [fileUrl, commentTree] = await Promise.all([
    createSignedViewUrl(doc.storagePath),
    listCommentsForViewer(doc.id, token),
    db.update(shares)
      .set({ lastViewedAt: new Date() })
      .where(eq(shares.id, share.id))
      .catch(() => {}),
  ]);

  const chatEnabled = doc.status === 'ready' && doc.hasExtractableText !== false;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex shrink-0 items-center justify-between border-b px-4 py-3 sm:px-6">
        <span className="font-semibold tracking-tight">PDF Intelligence</span>
        <span className="truncate text-sm text-neutral-500">Shared with {share.inviteeName}</span>
      </header>

      <SummaryBanner
        filename={doc.filename}
        status={doc.status}
        summary={doc.summary}
        error={doc.error}
        hasExtractableText={doc.hasExtractableText}
        pageCount={doc.pageCount}
      />

      <ViewerLayout
        pdf={<PdfViewer fileUrl={fileUrl} />}
        chat={
          <ChatPanel
            documentId={doc.id}
            shareToken={token}
            enabled={chatEnabled}
            disabledReason={
              doc.hasExtractableText === false
                ? 'This document has no extractable text, so chat is unavailable.'
                : 'Chat becomes available once processing finishes.'
            }
          />
        }
        comments={
          <CommentsPanel
            documentId={doc.id}
            shareToken={token}
            canComment={share.canComment}
            initial={commentTree}
          />
        }
      />
    </div>
  );
}
