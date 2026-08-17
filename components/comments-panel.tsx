'use client';

import { useEffect, useState } from 'react';
import { Markdown } from '@/components/markdown';
import { formatDateTime } from '@/lib/format';
import { CommentComposer } from '@/components/comment-composer';
import { addComment, listComments } from '@/app/(app)/d/[id]/comment-actions';
import type { CommentNode, CommentRow } from '@/lib/comments';

function Meta({ comment }: { comment: CommentRow }) {
  return (
    <p className="text-xs text-neutral-500">
      <span className="font-medium text-neutral-700">{comment.authorLabel}</span>
      {comment.isOwner ? ' · owner' : ''} · {formatDateTime(comment.createdAt)}
    </p>
  );
}

export function CommentsPanel({
  documentId, shareToken, canComment, initial,
}: {
  documentId: string;
  shareToken?: string;
  canComment: boolean;
  initial: CommentNode[];
}) {
  const [tree, setTree] = useState(initial);
  const [replyTo, setReplyTo] = useState<string | null>(null);

  useEffect(() => setTree(initial), [initial]);

  async function post(body: string, parentId: string | null): Promise<string | null> {
    try {
      const result = await addComment(documentId, { body, parentId }, shareToken);
      if (result && 'error' in result && result.error) return result.error;
      setTree(await listComments(documentId, shareToken));
      setReplyTo(null);
      return null;
    } catch {
      return 'Could not post that comment.';
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {tree.length === 0 && <p className="text-sm text-neutral-500">No comments yet.</p>}

        {tree.map((comment) => (
          <div key={comment.id} className="space-y-2">
            <div>
              <Meta comment={comment} />
              <div className="mt-1"><Markdown>{comment.body}</Markdown></div>
              {canComment && (
                <button
                  onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
                  className="mt-1 text-xs text-neutral-600 underline"
                >
                  {replyTo === comment.id ? 'Cancel' : 'Reply'}
                </button>
              )}
            </div>

            {comment.replies.length > 0 && (
              <div className="space-y-3 border-l-2 border-neutral-200 pl-3">
                {comment.replies.map((reply) => (
                  <div key={reply.id}>
                    <Meta comment={reply} />
                    <div className="mt-1"><Markdown>{reply.body}</Markdown></div>
                  </div>
                ))}
              </div>
            )}

            {replyTo === comment.id && (
              <div className="border-l-2 border-neutral-200 pl-3">
                <CommentComposer
                  compact
                  placeholder="Write a reply…"
                  onSubmit={(body) => post(body, comment.id)}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t p-3">
        {canComment ? (
          <CommentComposer onSubmit={(body) => post(body, null)} />
        ) : (
          <p className="text-sm text-neutral-500">This link is read-only.</p>
        )}
      </div>
    </div>
  );
}
