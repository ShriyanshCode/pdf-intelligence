import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { comments } from '@/lib/db/schema';
import { assertCanRead } from '@/lib/authz';
import { buildCommentTree, type CommentNode, type CommentRow } from '@/lib/comments';
import { resolveDocumentViewer } from './viewer';

/** Read path for comments, callable during Server Component render. */
export async function listCommentsForViewer(
  documentId: string,
  shareToken?: string,
): Promise<CommentNode[]> {
  const { viewer, doc } = await resolveDocumentViewer(documentId, shareToken);
  assertCanRead(viewer, doc);

  const rows = await db
    .select({
      id: comments.id, parentId: comments.parentId, body: comments.body,
      authorLabel: comments.authorLabel, authorUserId: comments.authorUserId,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .where(eq(comments.documentId, documentId))
    .orderBy(asc(comments.createdAt));

  const shaped: CommentRow[] = rows.map((r) => ({
    id: r.id,
    parentId: r.parentId,
    body: r.body,
    authorLabel: r.authorLabel,
    isOwner: r.authorUserId !== null,
    createdAt: r.createdAt,
  }));

  return buildCommentTree(shaped);
}
