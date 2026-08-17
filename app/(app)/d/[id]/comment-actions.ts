'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { comments, users } from '@/lib/db/schema';
import { assertCanComment } from '@/lib/authz';
import { commentSchema } from '@/lib/validation';
import { resolveDocumentViewer } from '@/lib/data/viewer';
import { listCommentsForViewer } from '@/lib/data/comments';
import type { CommentNode } from '@/lib/comments';

/**
 * Every export here is a Server Action (a POST endpoint). Server Components must
 * therefore read through lib/data/* instead of calling these during render.
 * listComments exists only so the client panel can refresh after posting.
 */

export async function listComments(
  documentId: string,
  shareToken?: string,
): Promise<CommentNode[]> {
  return listCommentsForViewer(documentId, shareToken);
}

export async function addComment(documentId: string, raw: unknown, shareToken?: string) {
  const { viewer, doc, share } = await resolveDocumentViewer(documentId, shareToken);
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
