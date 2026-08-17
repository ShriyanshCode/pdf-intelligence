'use server';

import { and, desc, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { shares } from '@/lib/db/schema';
import { requireOwnedDocument } from '@/lib/authz';
import { generateShareToken, shareUrlFor } from '@/lib/share-token';
import { sendShareEmail } from '@/lib/email';
import { shareSchema } from '@/lib/validation';
import { normalizeEmail } from '@/lib/password';

export type ShareListItem = {
  id: string;
  inviteeName: string;
  inviteeEmail: string;
  canComment: boolean;
  lastViewedAt: Date | null;
  url: string;
};

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

export async function listShares(documentId: string): Promise<ShareListItem[]> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Not signed in');
  await requireOwnedDocument(documentId, session.user.id);

  const rows = await db
    .select()
    .from(shares)
    .where(and(eq(shares.documentId, documentId), isNull(shares.revokedAt)))
    .orderBy(desc(shares.createdAt));

  return rows.map((s) => ({
    id: s.id,
    inviteeName: s.inviteeName,
    inviteeEmail: s.inviteeEmail,
    canComment: s.canComment,
    lastViewedAt: s.lastViewedAt,
    url: shareUrlFor(s.token),
  }));
}
