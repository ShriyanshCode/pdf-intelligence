import { createClient } from '@supabase/supabase-js';

export const BUCKET = 'pdfs';
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Service-role client. Server-only — importing this into a client component
 * would leak the key into the browser bundle.
 *
 * Constructed lazily inside the function rather than at module scope so that
 * importing this module for looksLikePdf() does not require the credentials.
 */
function admin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * The authoritative format check. A browser-supplied MIME type and a .pdf
 * extension are both trivially forged, so the server verifies the %PDF- magic
 * bytes. Real PDFs sometimes carry leading whitespace or junk, so scan the
 * first 1024 bytes rather than requiring offset 0 exactly.
 */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 1024);
  return new TextDecoder('latin1').decode(head).includes('%PDF-');
}

export function storagePathFor(userId: string, documentId: string): string {
  return `${userId}/${documentId}.pdf`;
}

export async function createSignedUploadUrl(path: string) {
  const { data, error } = await admin().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw error;
  return { signedUrl: data.signedUrl, token: data.token, path };
}

export async function downloadObject(path: string): Promise<Uint8Array> {
  const { data, error } = await admin().storage.from(BUCKET).download(path);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}

/** Short-lived read URL handed to the viewer. The bucket itself stays private. */
export async function createSignedViewUrl(path: string, expiresIn = 60 * 60) {
  const { data, error } = await admin().storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteObject(path: string) {
  await admin().storage.from(BUCKET).remove([path]);
}
