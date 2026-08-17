/**
 * Exercises the real storage path end to end: bucket privacy, signed upload,
 * download, magic-byte validation, then cleanup.
 *
 *   npx tsx --env-file=.env.local scripts/probe-storage.mts
 */
import { createClient } from '@supabase/supabase-js';
import {
  BUCKET, createSignedUploadUrl, downloadObject, createSignedViewUrl,
  deleteObject, looksLikePdf, storagePathFor,
} from '../lib/storage';

const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

// A minimal but structurally real PDF, enough to prove the byte path is intact.
const pdfBytes = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

const { data: buckets, error: listError } = await admin.storage.listBuckets();
if (listError) throw listError;
const target = buckets.find((b) => b.name === BUCKET);

console.log({
  bucketExists: Boolean(target),
  bucketIsPrivate: target ? target.public === false : null,
  allBuckets: buckets.map((b) => `${b.name}${b.public ? ' (PUBLIC)' : ' (private)'}`),
});

if (!target) throw new Error(`Bucket "${BUCKET}" not found`);
if (target.public) {
  console.error('\n*** WARNING: bucket is PUBLIC. Anyone with a path can read any PDF.');
}

const path = storagePathFor('probe-user', `probe-${Date.now()}`);

const { signedUrl } = await createSignedUploadUrl(path);
const put = await fetch(signedUrl, {
  method: 'PUT',
  body: pdfBytes,
  headers: { 'content-type': 'application/pdf' },
});

const roundTripped = put.ok ? await downloadObject(path) : new Uint8Array();
const viewUrl = put.ok ? await createSignedViewUrl(path, 60) : '';

// An unsigned fetch of the object must fail on a private bucket.
const unsignedUrl = `${process.env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`;
const unsigned = await fetch(unsignedUrl).catch(() => null);

console.log({
  signedUploadWorked: put.ok,
  uploadStatus: put.status,
  downloadedBytes: roundTripped.length,
  bytesMatch: roundTripped.length === pdfBytes.length,
  magicBytesValid: looksLikePdf(roundTripped),
  signedViewUrlIssued: viewUrl.includes('token='),
  unsignedAccessBlocked: unsigned ? !unsigned.ok : true,
  unsignedStatus: unsigned?.status ?? 'network error',
});

await deleteObject(path);
console.log('\ncleaned up probe object');
