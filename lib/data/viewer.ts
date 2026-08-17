import { auth } from '@/lib/auth';
import {
  AccessError, requireOwnedDocument, resolveShareToken, type Viewer,
} from '@/lib/authz';

/**
 * Resolves the caller to a Viewer plus the document, for either entry point:
 * a guest holding a share token, or an authenticated owner.
 *
 * Lives in lib/data rather than in a 'use server' file so that Server Components
 * can call it during render. Functions exported from a 'use server' module are
 * Server Actions — POST endpoints — and invoking one while rendering is not valid
 * in a production build even though it appears to work in dev.
 */
export async function resolveDocumentViewer(documentId: string, shareToken?: string) {
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
