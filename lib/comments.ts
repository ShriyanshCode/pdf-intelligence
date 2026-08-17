export type CommentRow = {
  id: string;
  parentId: string | null;
  body: string;
  authorLabel: string;
  isOwner: boolean;
  createdAt: Date;
};

export type CommentNode = CommentRow & { replies: CommentRow[] };

const byTime = (a: CommentRow, b: CommentRow) =>
  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

/**
 * Threads are exactly one level deep. A reply whose parent is itself a reply is
 * attached to that reply's root thread rather than nested further, so a crafted
 * request cannot produce unbounded indentation. An orphaned reply — parent
 * missing — is promoted to top level so it is never silently lost.
 */
export function buildCommentTree(rows: CommentRow[]): CommentNode[] {
  const byId = new Map(rows.map((r) => [r.id, r]));

  /** Walks up to the thread root, guarding against cycles. */
  function rootOf(row: CommentRow): string | null {
    let current = row;
    const seen = new Set<string>([current.id]);

    while (current.parentId) {
      const parent = byId.get(current.parentId);
      if (!parent || seen.has(parent.id)) return null; // orphan or cycle
      current = parent;
      seen.add(parent.id);
    }
    return current.id === row.id ? null : current.id;
  }

  const nodes = new Map<string, CommentNode>();
  const replies: { rootId: string; row: CommentRow }[] = [];

  for (const row of rows) {
    const rootId = row.parentId ? rootOf(row) : null;
    if (rootId) replies.push({ rootId, row });
    else nodes.set(row.id, { ...row, replies: [] });
  }

  for (const { rootId, row } of replies) {
    nodes.get(rootId)?.replies.push(row);
  }

  const tree = [...nodes.values()].sort(byTime);
  for (const node of tree) node.replies.sort(byTime);
  return tree;
}
