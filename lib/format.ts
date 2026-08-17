export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The locale is pinned rather than left as `undefined`. An undefined locale
 * resolves to Node's default on the server and the visitor's default in the
 * browser, so the two renders disagree and React reports a hydration mismatch.
 * A fixed locale is deterministic on both sides.
 */
const DATE_LOCALE = 'en-GB';

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString(DATE_LOCALE, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString(DATE_LOCALE, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
