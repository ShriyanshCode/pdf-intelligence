'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { shares } from '@/lib/db/schema';
import { requireOwnedDocument } from '@/lib/authz';
import { generateShareToken, shareUrlFor } from '@/lib/share-token';
import { sendShareEmail } from '@/lib/email';
import { shareSchema } from '@/lib/validation';
import { normalizeEmail } from '@/lib/password';
import { listSharesForOwner, type ShareListItem } from '@/lib/data/shares';

/**
 * Every export here is a Server Action (a POST endpoint). Server Components read
 * through lib/data/shares instead; listShares exists only so the share dialog can
 * refresh after creating or revoking a link.
 */

export type { ShareListItem };

export async function listShares(documentId: string): Promise<ShareListItem[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Not signed in');
  return listSharesForOwner(documentId, session.user.id);
}

export async function createShare(documentId: string, raw: unknown) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Not signed in');
  const doc = await requireOwnedDocument(documentId, session.user.id);

  const parsed = shareSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const token = generateShareToken();
  await db.insert(shares).values({
    documentId,
    token,
    inviteeEmail: normalizeEmail(parsed.data.inviteeEmail),
    inviteeName: parsed.data.inviteeName,
    canComment: parsed.data.canComment,
  });

  const url = shareUrlFor(token);
  const emailed = await sendShareEmail({
    to: parsed.data.inviteeEmail,
    inviteeName: parsed.data.inviteeName,
    ownerName: session.user.name ?? 'Someone',
    filename: doc.filename,
    url,
  });

  revalidatePath(`/d/${documentId}`);
  return { url, emailed };
}

export async function revokeShare(shareId: string, documentId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Not signed in');
  await requireOwnedDocument(documentId, session.user.id);

  // Scoped by documentId as well as shareId, so a share belonging to another
  // document cannot be revoked through this path.
  await db
    .update(shares)
    .set({ revokedAt: new Date() })
    .where(and(eq(shares.id, shareId), eq(shares.documentId, documentId)));

  revalidatePath(`/d/${documentId}`);
}
