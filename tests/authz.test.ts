import { describe, it, expect } from 'vitest';
import {
  viewerFromShare, canRead, canComment, sessionKeyFor,
  assertCanRead, assertCanComment, AccessError,
  type Viewer, type DocRef, type ShareRow,
} from '@/lib/authz';

const DOC_A: DocRef = { id: 'doc-a', ownerId: 'user-1' };
const DOC_B: DocRef = { id: 'doc-b', ownerId: 'user-2' };

const owner: Viewer = { kind: 'owner', userId: 'user-1' };
const guestA: Viewer = { kind: 'guest', shareId: 'share-1', documentId: 'doc-a', canComment: true };
const readOnlyGuest: Viewer = { kind: 'guest', shareId: 'share-2', documentId: 'doc-a', canComment: false };

const liveShare: ShareRow = { id: 'share-1', documentId: 'doc-a', canComment: true, revokedAt: null };

describe('viewerFromShare', () => {
  it('builds a guest viewer scoped to the share document', () => {
    expect(viewerFromShare(liveShare)).toEqual({
      kind: 'guest', shareId: 'share-1', documentId: 'doc-a', canComment: true,
    });
  });

  it('returns null for a revoked share', () => {
    expect(viewerFromShare({ ...liveShare, revokedAt: new Date() })).toBeNull();
  });

  it('carries canComment false through', () => {
    expect(viewerFromShare({ ...liveShare, canComment: false })).toMatchObject({ canComment: false });
  });
});

describe('canRead', () => {
  it('lets an owner read their own document', () => {
    expect(canRead(owner, DOC_A)).toBe(true);
  });

  it('refuses an owner reading a document owned by someone else', () => {
    expect(canRead(owner, DOC_B)).toBe(false);
  });

  it('lets a guest read the document their token is for', () => {
    expect(canRead(guestA, DOC_A)).toBe(true);
  });

  it('refuses a guest reading a different document', () => {
    // The core containment property: a token for doc-a is useless against doc-b.
    expect(canRead(guestA, DOC_B)).toBe(false);
  });
});

describe('canComment', () => {
  it('allows the owner', () => {
    expect(canComment(owner, DOC_A)).toBe(true);
  });

  it('allows a guest holding a comment-enabled token', () => {
    expect(canComment(guestA, DOC_A)).toBe(true);
  });

  it('refuses a guest whose token disables commenting', () => {
    expect(canComment(readOnlyGuest, DOC_A)).toBe(false);
  });

  it('refuses commenting on a document the viewer cannot read at all', () => {
    expect(canComment(guestA, DOC_B)).toBe(false);
    expect(canComment(owner, DOC_B)).toBe(false);
  });
});

describe('sessionKeyFor', () => {
  it('namespaces owners by user id', () => {
    expect(sessionKeyFor(owner)).toBe('user:user-1');
  });

  it('namespaces guests by share id so two guests never share a chat thread', () => {
    expect(sessionKeyFor(guestA)).toBe('share:share-1');
    expect(sessionKeyFor(readOnlyGuest)).toBe('share:share-2');
    expect(sessionKeyFor(guestA)).not.toBe(sessionKeyFor(readOnlyGuest));
  });
});

describe('assertions', () => {
  it('assertCanRead passes silently when allowed', () => {
    expect(() => assertCanRead(owner, DOC_A)).not.toThrow();
  });

  it('assertCanRead throws a 404 AccessError when denied', () => {
    expect(() => assertCanRead(guestA, DOC_B)).toThrow(AccessError);
    try {
      assertCanRead(guestA, DOC_B);
    } catch (e) {
      expect((e as AccessError).status).toBe(404);
    }
  });

  it('assertCanComment throws 403 when readable but not commentable', () => {
    try {
      assertCanComment(readOnlyGuest, DOC_A);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as AccessError).status).toBe(403);
    }
  });
});
