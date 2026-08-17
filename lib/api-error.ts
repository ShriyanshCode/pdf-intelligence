import { NextResponse } from 'next/server';
import { AccessError } from '@/lib/authz';

/**
 * Access failures surface their own status (404 for "you cannot see this",
 * 403 for "you can see it but cannot act"). Everything else is logged
 * server-side and returned as an opaque 500 — a raw error message could leak
 * schema or filesystem detail to a caller.
 */
export function toErrorResponse(error: unknown) {
  if (error instanceof AccessError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
}
