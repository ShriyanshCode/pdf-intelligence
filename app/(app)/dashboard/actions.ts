'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { documents } from '@/lib/db/schema';
import { requireOwnedDocument } from '@/lib/authz';
import {
  createSignedUploadUrl, storagePathFor, deleteObject, MAX_UPLOAD_BYTES,
} from '@/lib/storage';

/**
 * Creates the document row and returns a signed URL the browser uploads to
 * directly. The file never passes through this server: Vercel caps request
 * bodies at 4.5MB, well under our 25MB limit.
 */
export async function createUploadTarget(filename: string, sizeBytes: number) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  if (!filename.toLowerCase().endsWith('.pdf')) {
    throw new Error('Only PDF files are accepted.');
  }
  if (sizeBytes <= 0 || sizeBytes > MAX_UPLOAD_BYTES) {
    throw new Error('File must be between 1 byte and 25MB.');
  }

  const [doc] = await db
    .insert(documents)
    .values({
      ownerId: session.user.id,
      filename: filename.slice(0, 255),
      storagePath: 'pending',
      sizeBytes,
      status: 'uploading',
    })
    .returning({ id: documents.id });

  // The path needs the generated id, so the row is written first and patched.
  const path = storagePathFor(session.user.id, doc.id);
  const { signedUrl } = await createSignedUploadUrl(path);

  await db
    .update(documents)
    .set({ storagePath: path, updatedAt: new Date() })
    .where(eq(documents.id, doc.id));

  return { documentId: doc.id, signedUrl, path };
}

export async function deleteDocument(documentId: string) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  // Ownership is resolved through authz rather than trusting the id argument.
  // Chunks, shares, comments, and chat messages cascade from the row delete.
  const doc = await requireOwnedDocument(documentId, session.user.id);

  await db.delete(documents).where(eq(documents.id, doc.id));

  // Best effort: a leftover object costs storage but must not fail the delete.
  await deleteObject(doc.storagePath).catch(() => {});

  revalidatePath('/dashboard');
}
