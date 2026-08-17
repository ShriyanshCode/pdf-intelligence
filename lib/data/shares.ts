import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { shares } from '@/lib/db/schema';
import { requireOwnedDocument } from '@/lib/authz';
import { shareUrlFor } from '@/lib/share-token';

export type ShareListItem = {
  id: string;
  inviteeName: string;
  inviteeEmail: string;
  canComment: boolean;
  lastViewedAt: Date | null;
  url: string;
};

/** Read path for a document's live shares, callable during Server Component render. */
export async function listSharesForOwner(
  documentId: string,
  userId: string,
): Promise<ShareListItem[]> {
  await requireOwnedDocument(documentId, userId);

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
