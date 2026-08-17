import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { documents, shares } from '@/lib/db/schema';

export type Viewer =
  | { kind: 'owner'; userId: string }
  | { kind: 'guest'; shareId: string; documentId: string; canComment: boolean };

export type DocRef = { id: string; ownerId: string };

export type ShareRow = {
  id: string;
  documentId: string;
  canComment: boolean;
  revokedAt: Date | null;
};

export class AccessError extends Error {
  constructor(public status: 403 | 404, message: string) {
    super(message);
    this.name = 'AccessError';
  }
}

export function viewerFromShare(share: ShareRow): Viewer | null {
  if (share.revokedAt) return null;
  return {
    kind: 'guest',
    shareId: share.id,
    documentId: share.documentId,
    canComment: share.canComment,
  };
}

export function canRead(viewer: Viewer, doc: DocRef): boolean {
  if (viewer.kind === 'owner') return doc.ownerId === viewer.userId;
  return viewer.documentId === doc.id;
}

export function canComment(viewer: Viewer, doc: DocRef): boolean {
  if (!canRead(viewer, doc)) return false;
  return viewer.kind === 'owner' ? true : viewer.canComment;
}

/**
 * Chat threads are namespaced per viewer identity, so two guests holding
 * different tokens for the same document never see each other's questions.
 */
export function sessionKeyFor(viewer: Viewer): string {
  return viewer.kind === 'owner' ? `user:${viewer.userId}` : `share:${viewer.shareId}`;
}

/** 404 rather than 403: never confirm a document exists to someone who cannot read it. */
export function assertCanRead(viewer: Viewer, doc: DocRef): void {
  if (!canRead(viewer, doc)) throw new AccessError(404, 'Not found');
}

export function assertCanComment(viewer: Viewer, doc: DocRef): void {
  assertCanRead(viewer, doc);
  if (!canComment(viewer, doc)) {
    throw new AccessError(403, 'Commenting is disabled for this link');
  }
}

// ---------- the only two functions here that touch the database ----------

export async function requireOwnedDocument(documentId: string, userId: string) {
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.ownerId, userId)))
    .limit(1);
  if (!doc) throw new AccessError(404, 'Not found');
  return doc;
}

/** Returns the live share plus its document, or null for unknown and revoked tokens. */
export async function resolveShareToken(token: string) {
  const [row] = await db
    .select({ share: shares, document: documents })
    .from(shares)
    .innerJoin(documents, eq(documents.id, shares.documentId))
    .where(and(eq(shares.token, token), isNull(shares.revokedAt)))
    .limit(1);
  if (!row) return null;

  const viewer = viewerFromShare(row.share);
  if (!viewer) return null;
  return { viewer, share: row.share, document: row.document };
}
