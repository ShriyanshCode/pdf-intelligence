import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AccessError, requireOwnedDocument } from '@/lib/authz';
import { createSignedViewUrl } from '@/lib/storage';
import { PdfViewer } from '@/components/pdf-viewer';
import { SummaryBanner } from '@/components/summary-banner';
import { ViewerLayout } from '@/components/viewer-layout';
import { ChatPanel } from '@/components/chat-panel';
import { CommentsPanel } from '@/components/comments-panel';
import { ShareDialog } from '@/components/share-dialog';
import { listShares } from './share-actions';
import { listComments } from './comment-actions';

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  let doc;
  try {
    doc = await requireOwnedDocument(id, session!.user.id);
  } catch (error) {
    // 404 rather than 403, so the page never confirms a document exists.
    if (error instanceof AccessError) notFound();
    throw error;
  }

  const [fileUrl, shareRows, commentTree] = await Promise.all([
    createSignedViewUrl(doc.storagePath),
    listShares(doc.id),
    listComments(doc.id),
  ]);

  const chatEnabled = doc.status === 'ready' && doc.hasExtractableText !== false;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-end border-b px-4 py-2 sm:px-6">
        <ShareDialog documentId={doc.id} initialShares={shareRows} />
      </div>

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
            enabled={chatEnabled}
            disabledReason={
              doc.hasExtractableText === false
                ? 'This document has no extractable text, so chat is unavailable.'
                : 'Chat becomes available once processing finishes.'
            }
          />
        }
        comments={<CommentsPanel documentId={doc.id} canComment initial={commentTree} />}
      />
    </div>
  );
}
