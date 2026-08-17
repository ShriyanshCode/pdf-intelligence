'use server';

import { asc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { comments, users } from '@/lib/db/schema';
import {
  AccessError, assertCanComment, assertCanRead, requireOwnedDocument, resolveShareToken,
  type Viewer,
} from '@/lib/authz';
import { commentSchema } from '@/lib/validation';
import { buildCommentTree, type CommentRow } from '@/lib/comments';

/** Resolves the caller to a Viewer plus the document, for either entry point. */
async function resolveViewer(documentId: string, shareToken?: string) {
  if (shareToken) {
    const resolved = await resolveShareToken(shareToken);
    if (!resolved || resolved.document.id !== documentId) {
      throw new AccessError(404, 'Not found');
    }
    return { viewer: resolved.viewer, doc: resolved.document, share: resolved.share };
  }

  const session = await auth();
  if (!session?.user?.id) throw new AccessError(404, 'Not found');
  const doc = await requireOwnedDocument(documentId, session.user.id);
  const viewer: Viewer = { kind: 'owner', userId: session.user.id };
  return { viewer, doc, share: null };
}

export async function listComments(documentId: string, shareToken?: string) {
  const { viewer, doc } = await resolveViewer(documentId, shareToken);
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

export async function addComment(documentId: string, raw: unknown, shareToken?: string) {
  const { viewer, doc, share } = await resolveViewer(documentId, shareToken);
  assertCanComment(viewer, doc);

  const parsed = commentSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // The author label is denormalized at write time so a revoked share still
  // shows who wrote a comment.
  let authorLabel: string;
  if (viewer.kind === 'guest') {
    authorLabel = share!.inviteeName;
  } else {
    const [user] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, viewer.userId))
      .limit(1);
    authorLabel = user?.name ?? 'Owner';
  }

  await db.insert(comments).values({
    documentId,
    parentId: parsed.data.parentId ?? null,
    body: parsed.data.body,
    authorUserId: viewer.kind === 'owner' ? viewer.userId : null,
    authorShareId: viewer.kind === 'guest' ? viewer.shareId : null,
    authorLabel,
  });

  revalidatePath(`/d/${documentId}`);
  return { ok: true as const };
}
