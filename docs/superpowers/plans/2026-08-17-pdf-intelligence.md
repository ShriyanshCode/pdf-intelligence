# PDF Intelligence & Collaboration System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployed web app where authenticated users upload PDFs, get an AI summary automatically, ask grounded streaming questions about the document, share it with account-less invitees, and collaborate through threaded comments.

**Architecture:** One Next.js App Router app on Vercel. Supabase supplies Postgres (with `pgvector`) and object storage; it is reached only from the server with the service-role key. Passwords are hashed with `bcryptjs` in our own code and sessions are Auth.js JWT cookies. Every access decision funnels through one `lib/authz.ts` module because no RLS is used. Uploads go client→Supabase Storage directly to dodge Vercel's 4.5MB body cap, and ingestion is split into cursor-driven stages to stay clear of the 60s function ceiling.

**Tech Stack:** Next.js 16.3.1 · React 19 · TypeScript · Tailwind CSS v4 · Drizzle ORM 0.45 + postgres.js · Supabase (Postgres + Storage) · Auth.js 5.0.0-beta.32 · bcryptjs 3 · `@google/genai` 2.17 (Gemini 2.5 Flash + gemini-embedding-001) · unpdf 1.8 · react-pdf 10.4 · Resend · Vitest 4 · Playwright 1.62

**Spec:** `docs/superpowers/specs/2026-08-17-pdf-intelligence-design.md` — read it alongside this plan. Every task below traces to a spec section.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Node** ≥ 20.9 (Next 16 requirement). Local dev verified on Node 22.11.
- **Next.js 16.3.1**, not 15. The spec says 15; 16 is current stable and `next-auth@5.0.0-beta.32` declares `next: ^16.0.0` support. Deviation is deliberate.
- **`next-auth` pinned to exactly `5.0.0-beta.32`** — no caret. Auth.js v5 is still prerelease and betas break between releases. If it fights Next 16 during Task 4, the documented fallback is a ~100-line `jose` session layer (spec §2, approach A3); do not spend more than one hour fighting it.
- **Tailwind CSS v4** — CSS-first config via `@import "tailwindcss"` in `app/globals.css` and `@tailwindcss/postcss` in `postcss.config.mjs`. There is **no `tailwind.config.js`**. Do not create one.
- **Emails are stored as `text`, lowercased and trimmed at every write.** The spec says `citext`; we use `text` + a unique index instead to avoid depending on a Postgres extension and because Drizzle types it natively. Normalization belongs in `lib/auth.ts`, not scattered across callers.
- **Postgres driver is `postgres` (postgres.js) with `{ prepare: false }`.** Required for Supabase's Supavisor pooler in transaction mode. Use the **pooled** connection string (port 6543), not the direct one, or serverless functions will exhaust connections.
- **Embedding dimensions: exactly 768.** `gemini-embedding-001` defaults to 3072; we pass `outputDimensionality: 768` because pgvector's HNSW index caps at 2000 dims. **Truncated vectors are not normalized by the API — we must L2-normalize them ourselves** or cosine distance is wrong.
- **`pdfjs-dist` worker pinned to 5.4.296**, the exact version bundled by `react-pdf@10.4.1`. A version mismatch renders a blank page. The worker is copied into `public/` by a postinstall script; never load it from a CDN.
- **Secrets:** `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `RESEND_API_KEY`, `AUTH_SECRET`, `DATABASE_URL` are server-only. No secret may appear in any file under `app/` that carries `'use client'`, and none may be prefixed `NEXT_PUBLIC_`. `.env.local` is gitignored; `.env.example` is committed with empty values.
- **Long-document threshold: 40,000 tokens** (spec §7). Below it, full text. At or above it, top-8 chunk retrieval plus `idx ± 1` neighbours.
- **Chat history: last 5 turns** replayed per request.
- **Commit after every task**, using the message given in the task's final step.

---

## File Structure

```
app/
  layout.tsx                          root shell, fonts, globals.css
  globals.css                         @import "tailwindcss" + theme tokens
  page.tsx                            marketing/redirect → /dashboard or /login
  (auth)/login/page.tsx               login form
  (auth)/signup/page.tsx              signup form
  (auth)/actions.ts                   signupAction (server action)
  (app)/layout.tsx                    authenticated shell, requires session
  (app)/dashboard/page.tsx            document grid + search + upload
  (app)/d/[id]/page.tsx               owner viewer
  s/[token]/page.tsx                  guest viewer (public)
  api/auth/[...nextauth]/route.ts     Auth.js handlers
  api/documents/[id]/ingest/route.ts  extract → summarize
  api/documents/[id]/embed/route.ts   cursor-driven batch embedding
  api/documents/[id]/status/route.ts  polling target
  api/chat/route.ts                   streaming chat
components/
  upload-dropzone.tsx                 client: validate, sign, upload, drive stages
  document-card.tsx                   dashboard card + live status
  search-bar.tsx                      filename ⇄ meaning toggle
  pdf-viewer.tsx                      client: react-pdf canvas + paging
  summary-banner.tsx                  pinned summary / status / scanned notice
  viewer-layout.tsx                   PDF + Comments|Chat shell; mobile tab bar
  comment-list.tsx                    threaded render
  comment-composer.tsx                markdown toolbar + textarea
  chat-panel.tsx                      streaming message list + input
  share-dialog.tsx                    mint token, copy link, revoke list
  markdown.tsx                        locked-down react-markdown wrapper
lib/
  db/schema.ts                        Drizzle tables + indexes
  db/index.ts                         postgres.js client + db export
  auth.ts                             Auth.js config, hashPassword, verifyPassword
  authz.ts                            Viewer type + every access decision
  storage.ts                          signed upload/download URLs, magic bytes
  pdf.ts                              extractPdfText, chunkPages
  tokens.ts                           estimateTokens
  share-token.ts                      generateShareToken, shareUrlFor
  comments.ts                         buildCommentTree (one-level threading)
  format.ts                           formatBytes, formatDate
  api-error.ts                        AccessError → HTTP response
  ai/gemini.ts                        client + withRetry
  ai/prompts.ts                       all prompt text, single source
  ai/summarize.ts                     summarizeShort, summarizeLong
  ai/embed.ts                         embedTexts, embedQuery, l2Normalize
  ai/retrieve.ts                      buildChatContext (threshold + neighbours)
  ai/chat.ts                           streamAnswer
  ai/search.ts                        semanticSearch (group + rank)
  email.ts                            sendShareEmail
  validation.ts                       zod schemas shared by actions/routes
tests/                                Vitest unit tests, mirrors lib/
e2e/flow.spec.ts                      the single Playwright journey
scripts/copy-pdf-worker.mjs           postinstall worker copy
drizzle.config.ts, vitest.config.ts, playwright.config.ts
```

Rationale for the two least obvious splits: `ai/retrieve.ts` is separated from `ai/chat.ts` so context assembly — the graded long-document logic — is unit-testable without touching the network. `authz.ts` takes its data access as injected functions for the same reason.

---

## Task 1: Project scaffold, tooling, and the first tested utility

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `app/layout.tsx`, `app/globals.css`, `app/page.tsx`, `.env.example`, `lib/tokens.ts`
- Test: `tests/tokens.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `estimateTokens(text: string): number`. A working `npm test`. Path alias `@/*` → repo root.

- [ ] **Step 1: Scaffold the app**

Run in `C:\Users\Shriyansh\Downloads\spot_draft` (the repo already exists with `.gitignore` and `docs/`):

```bash
npx create-next-app@16.3.1 . --typescript --tailwind --app --no-src-dir --import-alias "@/*" --use-npm --eslint --yes
```

If it refuses because the directory is non-empty, scaffold into a temp dir and move the files in, preserving `.gitignore` and `docs/`.

- [ ] **Step 2: Install dependencies with exact pins where required**

```bash
npm install drizzle-orm@0.45.2 postgres@3.4.9 @supabase/supabase-js@2.112.3 \
  bcryptjs@3.0.3 zod@4.4.3 @google/genai@2.17.1 unpdf@1.8.1 \
  react-pdf@10.4.1 react-markdown@10.1.0 remark-gfm@4.0.1 resend@6.20.0 \
  lucide-react@1.31.0 clsx@2.1.1 tailwind-merge@3.6.0
npm install --save-exact next-auth@5.0.0-beta.32
npm install -D drizzle-kit@0.31.10 vitest@4.1.10 @playwright/test@1.62.1 \
  tsx@4.23.12 dotenv@17.4.2 @types/bcryptjs@3.0.0
```

- [ ] **Step 3: Configure Vitest with the `@/*` alias**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
});
```

Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`, `"e2e": "playwright test"`.

- [ ] **Step 4: Write the failing test**

Create `tests/tokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { estimateTokens } from '@/lib/tokens';

describe('estimateTokens', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('approximates 4 characters per token, rounding up', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('scales roughly linearly for prose', () => {
    const prose = 'The quick brown fox jumps over the lazy dog. '.repeat(100);
    const t = estimateTokens(prose);
    expect(t).toBeGreaterThan(900);
    expect(t).toBeLessThan(1400);
  });

  it('never returns a fractional count', () => {
    expect(Number.isInteger(estimateTokens('seven chars'))).toBe(true);
  });
});
```

- [ ] **Step 5: Run the test and confirm it fails**

Run: `npm test -- tests/tokens.test.ts`
Expected: FAIL — cannot resolve `@/lib/tokens`.

- [ ] **Step 6: Implement**

Create `lib/tokens.ts`:

```ts
/**
 * Cheap token estimate used for routing decisions only — never for billing.
 * Gemini averages ~4 characters per token on English prose. We deliberately
 * avoid a real tokenizer: this runs on every ingest and the 40k threshold has
 * plenty of headroom, so a fast approximation is the right trade.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
```

- [ ] **Step 7: Run the test and confirm it passes**

Run: `npm test -- tests/tokens.test.ts`
Expected: 4 passed.

- [ ] **Step 8: Set up Tailwind v4 and verify the dev server boots**

Confirm `app/globals.css` begins with `@import "tailwindcss";` and `postcss.config.mjs` is:

```js
export default { plugins: { '@tailwindcss/postcss': {} } };
```

Delete `tailwind.config.js`/`.ts` if `create-next-app` produced one — Tailwind v4 does not use it.

Run: `npm run dev` → open `http://localhost:3000` → expect the default page with Tailwind styles applied. Stop the server.

- [ ] **Step 9: Write `.env.example`**

Create `.env.example` (committed, all values empty):

```
DATABASE_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
AUTH_SECRET=
RESEND_API_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next 16 app with Tailwind v4, Vitest, and token estimator"
```

---

## Task 2: Database schema and migrations

**Files:**
- Create: `lib/db/schema.ts`, `lib/db/index.ts`, `drizzle.config.ts`, `scripts/verify-db.ts`
- Test: verification is a live connection script (schema correctness is not unit-testable without a DB)

**Interfaces:**
- Consumes: `DATABASE_URL`.
- Produces: `db`, and the tables `users`, `documents`, `chunks`, `shares`, `comments`, `chatMessages`. Status values: `'uploading' | 'extracting' | 'summarizing' | 'indexing' | 'ready' | 'failed'`.

- [ ] **Step 1: Create the Supabase project and enable pgvector**

In the Supabase dashboard: create a project, then SQL Editor → run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Copy the **pooled** connection string (Connect → Transaction pooler, port 6543) into `.env.local` as `DATABASE_URL`, plus `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from Project Settings → API.

Create a **private** storage bucket named `pdfs` (Storage → New bucket → Public: off).

- [ ] **Step 2: Write the schema**

Create `lib/db/schema.ts`:

```ts
import {
  pgTable, uuid, text, integer, boolean, timestamp, vector, index, uniqueIndex, check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const documentStatuses = [
  'uploading', 'extracting', 'summarizing', 'indexing', 'ready', 'failed',
] as const;
export type DocumentStatus = (typeof documentStatuses)[number];

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('users_email_key').on(t.email)]);

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  storagePath: text('storage_path').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  pageCount: integer('page_count'),
  charCount: integer('char_count'),
  tokenEstimate: integer('token_estimate'),
  status: text('status').notNull().default('uploading'),
  error: text('error'),
  summary: text('summary'),
  fullText: text('full_text'),
  hasExtractableText: boolean('has_extractable_text'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('documents_owner_created_idx').on(t.ownerId, t.createdAt.desc())]);

export const chunks = pgTable('chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  idx: integer('idx').notNull(),
  content: text('content').notNull(),
  pageStart: integer('page_start').notNull(),
  pageEnd: integer('page_end').notNull(),
  tokenCount: integer('token_count').notNull(),
  embedding: vector('embedding', { dimensions: 768 }),
}, (t) => [
  uniqueIndex('chunks_doc_idx_key').on(t.documentId, t.idx),
  index('chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
]);

export const shares = pgTable('shares', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  inviteeEmail: text('invitee_email').notNull(),
  inviteeName: text('invitee_name').notNull(),
  canComment: boolean('can_comment').notNull().default(true),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('shares_token_key').on(t.token),
  index('shares_document_idx').on(t.documentId),
]);

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id'),
  body: text('body').notNull(),
  authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
  authorShareId: uuid('author_share_id').references(() => shares.id, { onDelete: 'set null' }),
  authorLabel: text('author_label').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('comments_document_created_idx').on(t.documentId, t.createdAt),
  check('comments_author_present', sql`${t.authorUserId} IS NOT NULL OR ${t.authorShareId} IS NOT NULL`),
]);

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  sessionKey: text('session_key').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('chat_session_created_idx').on(t.sessionKey, t.createdAt)]);
```

`parentId` is intentionally declared without an inline `.references()` call — a self-reference needs `AddForeignKey` in the generated SQL, which the next step adds by hand.

- [ ] **Step 3: Create the db client**

Create `lib/db/index.ts`:

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

// prepare:false is required by Supabase's Supavisor pooler in transaction mode.
const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });
export { schema };
```

- [ ] **Step 4: Configure and run drizzle-kit**

Create `drizzle.config.ts`:

```ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

Add scripts: `"db:generate": "drizzle-kit generate"`, `"db:push": "dotenv -e .env.local -- drizzle-kit push"`.

Run: `npm run db:generate`
Expected: a migration file in `drizzle/`. **Open it** and confirm it contains `vector(768)`, `hnsw`, and the `comments_author_present` check. Append the self-reference FK by hand:

```sql
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "comments"("id") ON DELETE CASCADE;
```

- [ ] **Step 5: Push and verify against the live database**

Create `scripts/verify-db.ts`:

```ts
import 'dotenv/config';
import { db } from '../lib/db';
import { sql } from 'drizzle-orm';

const expected = ['users', 'documents', 'chunks', 'shares', 'comments', 'chat_messages'];

const rows = await db.execute<{ table_name: string }>(
  sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
);
const found = rows.map((r) => r.table_name);
const missing = expected.filter((t) => !found.includes(t));

const [{ extname }] = await db.execute<{ extname: string }>(
  sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`,
);

if (missing.length) throw new Error(`Missing tables: ${missing.join(', ')}`);
if (extname !== 'vector') throw new Error('pgvector extension is not installed');
console.log('OK: all tables present, pgvector installed');
process.exit(0);
```

Run: `npm run db:push` then `npx tsx --env-file=.env.local scripts/verify-db.ts`
Expected: `OK: all tables present, pgvector installed`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Drizzle schema for documents, chunks, shares, comments, and chat"
```

---

## Task 3: Password hashing

**Files:**
- Create: `lib/auth.ts` (hashing half only; Auth.js config lands in Task 4)
- Test: `tests/auth-password.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(plain: string, hash: string): Promise<boolean>`, `normalizeEmail(raw: string): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/auth-password.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, normalizeEmail } from '@/lib/auth';

describe('password hashing', () => {
  it('never returns the plaintext', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toContain('correct horse battery staple');
  });

  it('produces a bcrypt hash with cost 12', async () => {
    const hash = await hashPassword('hunter2hunter2');
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
  });

  it('salts: the same password hashes differently each time', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });

  it('verifies a correct password', async () => {
    const hash = await hashPassword('s3cret-passphrase');
    await expect(verifyPassword('s3cret-passphrase', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('s3cret-passphrase');
    await expect(verifyPassword('s3cret-passphras', hash)).resolves.toBe(false);
  });

  it('rejects rather than throws on a malformed hash', async () => {
    await expect(verifyPassword('anything', 'not-a-bcrypt-hash')).resolves.toBe(false);
  });

  it('rejects an empty candidate against a real hash', async () => {
    const hash = await hashPassword('s3cret-passphrase');
    await expect(verifyPassword('', hash)).resolves.toBe(false);
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Shriyansh@Example.COM ')).toBe('shriyansh@example.com');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- tests/auth-password.test.ts`
Expected: FAIL — cannot resolve `@/lib/auth`.

- [ ] **Step 3: Implement**

Create `lib/auth.ts`:

```ts
import bcrypt from 'bcryptjs';

/**
 * Cost 12: ~250ms per hash on Vercel's Hobby CPU. High enough to make offline
 * cracking expensive, low enough to stay well inside the function timeout.
 */
const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  // bcrypt.compare throws on a structurally invalid hash. A corrupted row must
  // read as "wrong password", never as a 500 that leaks which accounts exist.
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- tests/auth-password.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts tests/auth-password.test.ts
git commit -m "feat: add bcrypt password hashing with cost 12"
```

---

## Task 4: Auth.js session, signup, and login

**Files:**
- Modify: `lib/auth.ts` (append Auth.js config)
- Create: `lib/validation.ts`, `app/api/auth/[...nextauth]/route.ts`, `app/(auth)/actions.ts`, `app/(auth)/login/page.tsx`, `app/(auth)/signup/page.tsx`, `app/(app)/layout.tsx`, `middleware.ts`, `components/auth-form.tsx`
- Test: `tests/validation.test.ts`

**Interfaces:**
- Consumes: `hashPassword`, `verifyPassword`, `normalizeEmail`, `db`, `users`.
- Produces: `auth()` returning `Session | null` with `session.user.id`; `signIn`, `signOut`; `signupAction(formData)`; `signupSchema`, `loginSchema`.

- [ ] **Step 1: Write the failing validation test**

Create `tests/validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { signupSchema } from '@/lib/validation';

describe('signupSchema', () => {
  it('accepts a valid signup', () => {
    const r = signupSchema.safeParse({
      name: 'Shriyansh Patnaik',
      email: 'a@b.com',
      password: 'longenoughpassword',
    });
    expect(r.success).toBe(true);
  });

  it('rejects passwords shorter than 10 characters', () => {
    const r = signupSchema.safeParse({ name: 'A', email: 'a@b.com', password: 'short' });
    expect(r.success).toBe(false);
  });

  it('rejects a malformed email', () => {
    const r = signupSchema.safeParse({ name: 'A', email: 'not-an-email', password: 'longenoughpass' });
    expect(r.success).toBe(false);
  });

  it('rejects a blank name', () => {
    const r = signupSchema.safeParse({ name: '   ', email: 'a@b.com', password: 'longenoughpass' });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/validation.test.ts`
Expected: FAIL — cannot resolve `@/lib/validation`.

- [ ] **Step 3: Implement validation**

Create `lib/validation.ts`:

```ts
import { z } from 'zod';

export const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export const commentSchema = z.object({
  body: z.string().trim().min(1, 'Comment cannot be empty').max(5000),
  parentId: z.string().uuid().nullable().optional(),
});

export const shareSchema = z.object({
  inviteeEmail: z.string().trim().email('Enter a valid email address'),
  inviteeName: z.string().trim().min(1, 'Name is required').max(100),
  canComment: z.boolean().default(true),
});

export const chatSchema = z.object({
  documentId: z.string().uuid(),
  question: z.string().trim().min(1).max(2000),
  shareToken: z.string().optional(),
});
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm test -- tests/validation.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Append the Auth.js config to `lib/auth.ts`**

Add to the bottom of `lib/auth.ts`:

```ts
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { loginSchema } from '@/lib/validation';

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;

        const email = normalizeEmail(parsed.data.email);
        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

        // Always run a comparison, even with no user, so response time does not
        // reveal whether an account exists.
        const hash = user?.passwordHash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
        const ok = await verifyPassword(parsed.data.password, hash);
        if (!user || !ok) return null;

        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      return session;
    },
  },
});
```

Add `types/next-auth.d.ts`:

```ts
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: { id: string } & DefaultSession['user'];
  }
}
```

Create `app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from '@/lib/auth';
export const { GET, POST } = handlers;
```

Generate a secret: `npx auth secret` (or `openssl rand -base64 32`) into `.env.local` as `AUTH_SECRET`.

- [ ] **Step 6: Implement the signup server action**

Create `app/(auth)/actions.ts`:

```ts
'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { hashPassword, normalizeEmail, signIn } from '@/lib/auth';
import { signupSchema } from '@/lib/validation';

export type FormState = { error?: string } | undefined;

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signupSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const email = normalizeEmail(parsed.data.email);
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return { error: 'An account with that email already exists.' };

  await db.insert(users).values({
    name: parsed.data.name,
    email,
    passwordHash: await hashPassword(parsed.data.password),
  });

  await signIn('credentials', {
    email,
    password: parsed.data.password,
    redirect: false,
  });
  redirect('/dashboard');
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = formData.get('email');
  const password = formData.get('password');
  try {
    await signIn('credentials', { email, password, redirect: false });
  } catch {
    return { error: 'Incorrect email or password.' };
  }
  redirect('/dashboard');
}
```

- [ ] **Step 7: Build the shared auth form and both pages**

Create `components/auth-form.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import type { FormState } from '@/app/(auth)/actions';

type Props = {
  mode: 'login' | 'signup';
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
};

export function AuthForm({ mode, action }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const isSignup = mode === 'signup';

  return (
    <form action={formAction} className="w-full max-w-sm space-y-4">
      <h1 className="text-2xl font-semibold">{isSignup ? 'Create an account' : 'Sign in'}</h1>

      {isSignup && (
        <label className="block">
          <span className="text-sm font-medium">Name</span>
          <input name="name" required autoComplete="name"
            className="mt-1 w-full rounded-md border px-3 py-2" />
        </label>
      )}

      <label className="block">
        <span className="text-sm font-medium">Email</span>
        <input name="email" type="email" required autoComplete="email"
          className="mt-1 w-full rounded-md border px-3 py-2" />
      </label>

      <label className="block">
        <span className="text-sm font-medium">Password</span>
        <input name="password" type="password" required minLength={isSignup ? 10 : undefined}
          autoComplete={isSignup ? 'new-password' : 'current-password'}
          className="mt-1 w-full rounded-md border px-3 py-2" />
        {isSignup && <span className="mt-1 block text-xs text-neutral-500">At least 10 characters.</span>}
      </label>

      {state?.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <button type="submit" disabled={pending}
        className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-50">
        {pending ? 'Working…' : isSignup ? 'Create account' : 'Sign in'}
      </button>

      <p className="text-sm text-neutral-600">
        {isSignup ? (
          <>Already have an account? <Link href="/login" className="underline">Sign in</Link></>
        ) : (
          <>No account? <Link href="/signup" className="underline">Sign up</Link></>
        )}
      </p>
    </form>
  );
}
```

Create `app/(auth)/signup/page.tsx`:

```tsx
import { AuthForm } from '@/components/auth-form';
import { signupAction } from '../actions';

export default function SignupPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <AuthForm mode="signup" action={signupAction} />
    </main>
  );
}
```

Create `app/(auth)/login/page.tsx` — identical but `mode="login"` and `loginAction`.

- [ ] **Step 8: Protect the authenticated route group**

Create `app/(app)/layout.tsx`:

```tsx
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth, signOut } from '@/lib/auth';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
        <Link href="/dashboard" className="font-semibold">PDF Intelligence</Link>
        <div className="flex items-center gap-4 text-sm">
          <span className="hidden text-neutral-600 sm:inline">{session.user.email}</span>
          <form action={async () => { 'use server'; await signOut({ redirectTo: '/login' }); }}>
            <button className="underline">Sign out</button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
```

Create `middleware.ts`:

```ts
import { auth } from '@/lib/auth';

export default auth;

// Guest share links and auth endpoints must stay reachable without a session.
export const config = {
  matcher: ['/dashboard/:path*', '/d/:path*'],
};
```

Replace `app/page.tsx` with a redirect:

```tsx
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

export default async function Home() {
  const session = await auth();
  redirect(session?.user?.id ? '/dashboard' : '/login');
}
```

Add a placeholder `app/(app)/dashboard/page.tsx` returning `<main className="p-6">Dashboard</main>` so the redirect resolves; Task 11 replaces it.

- [ ] **Step 9: Verify the flow by hand**

Run: `npm run dev`, then:
1. Visit `/` → redirected to `/login`.
2. Visit `/dashboard` directly → redirected to `/login`.
3. Sign up → land on `/dashboard`.
4. In Supabase Table Editor, open `users` → confirm `password_hash` starts with `$2b$12$` and the plaintext appears nowhere.
5. Sign out → `/dashboard` redirects to `/login` again.
6. Sign in with a wrong password → inline "Incorrect email or password."
7. Sign up again with the same email → "An account with that email already exists."

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add Auth.js credentials auth with signup, login, and route protection"
```

---

## Task 5: Authorization module

**Files:**
- Create: `lib/authz.ts`
- Test: `tests/authz.test.ts`

**Interfaces:**
- Consumes: `db`, `documents`, `shares`.
- Produces:
  - `type Viewer = { kind: 'owner'; userId: string } | { kind: 'guest'; shareId: string; documentId: string; canComment: boolean }`
  - `type DocRef = { id: string; ownerId: string }`
  - `type ShareRow = { id: string; documentId: string; canComment: boolean; revokedAt: Date | null }`
  - `viewerFromShare(share: ShareRow): Viewer | null`
  - `canRead(viewer: Viewer, doc: DocRef): boolean`
  - `canComment(viewer: Viewer, doc: DocRef): boolean`
  - `sessionKeyFor(viewer: Viewer): string`
  - `class AccessError extends Error { status: 403 | 404 }`
  - `assertCanRead(viewer, doc): void`, `assertCanComment(viewer, doc): void`
  - `requireOwnedDocument(documentId, userId)`, `resolveShareToken(token)` — the two db-touching wrappers

The pure decision functions take plain objects rather than reading the database. That is what makes the whole access-control matrix unit-testable with no fixtures.

- [ ] **Step 1: Write the failing test**

Create `tests/authz.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/authz.test.ts`
Expected: FAIL — cannot resolve `@/lib/authz`.

- [ ] **Step 3: Implement**

Create `lib/authz.ts`:

```ts
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
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm test -- tests/authz.test.ts`
Expected: 15 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/authz.ts tests/authz.test.ts
git commit -m "feat: add authorization module with unit-tested access matrix"
```

---

## Task 6: Storage helpers and PDF format validation

**Files:**
- Create: `lib/storage.ts`
- Test: `tests/storage-validation.test.ts`

**Interfaces:**
- Consumes: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Produces: `looksLikePdf(bytes: Uint8Array): boolean`, `MAX_UPLOAD_BYTES: number`, `BUCKET: string`, `storagePathFor(userId, documentId): string`, `createSignedUploadUrl(path)`, `downloadObject(path): Promise<Uint8Array>`, `createSignedViewUrl(path, expiresIn?)`, `deleteObject(path)`.

- [ ] **Step 1: Write the failing test**

Create `tests/storage-validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { looksLikePdf, storagePathFor, MAX_UPLOAD_BYTES } from '@/lib/storage';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('looksLikePdf', () => {
  it('accepts a normal PDF header', () => {
    expect(looksLikePdf(bytes('%PDF-1.7\nrest of file'))).toBe(true);
  });

  it('accepts a header preceded by junk, as real readers do', () => {
    expect(looksLikePdf(bytes('\n\n   %PDF-1.4 trailing'))).toBe(true);
  });

  it('rejects a PNG', () => {
    expect(looksLikePdf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(false);
  });

  it('rejects HTML renamed to .pdf', () => {
    expect(looksLikePdf(bytes('<!doctype html><html></html>'))).toBe(false);
  });

  it('rejects an empty buffer', () => {
    expect(looksLikePdf(new Uint8Array())).toBe(false);
  });

  it('rejects a header appearing only after the first 1024 bytes', () => {
    expect(looksLikePdf(bytes('x'.repeat(2000) + '%PDF-1.7'))).toBe(false);
  });
});

describe('storagePathFor', () => {
  it('namespaces objects by user then document', () => {
    expect(storagePathFor('u1', 'd1')).toBe('u1/d1.pdf');
  });
});

describe('MAX_UPLOAD_BYTES', () => {
  it('is 25MB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(25 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/storage-validation.test.ts`
Expected: FAIL — cannot resolve `@/lib/storage`.

- [ ] **Step 3: Implement**

Create `lib/storage.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

export const BUCKET = 'pdfs';
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Service-role client. Server-only — importing this into a client component leaks the key. */
function admin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars are not set');
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
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm test -- tests/storage-validation.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/storage.ts tests/storage-validation.test.ts
git commit -m "feat: add Supabase storage helpers with magic-byte PDF validation"
```

---

## Task 7: PDF text extraction and chunking

**Files:**
- Create: `lib/pdf.ts`
- Test: `tests/pdf-chunking.test.ts`

**Interfaces:**
- Consumes: `estimateTokens`.
- Produces:
  - `type PageText = { page: number; text: string }`
  - `type Chunk = { idx: number; content: string; pageStart: number; pageEnd: number; tokenCount: number }`
  - `extractPdfText(bytes): Promise<{ pages: PageText[]; pageCount: number; fullText: string; charCount: number }>`
  - `chunkPages(pages: PageText[]): Chunk[]`
  - `hasUsableText(fullText: string, pageCount: number): boolean`
  - `TARGET_TOKENS = 1000`, `OVERLAP_TOKENS = 150`, `MAX_CHUNK_TOKENS = 1400`

- [ ] **Step 1: Write the failing test**

Create `tests/pdf-chunking.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  chunkPages, hasUsableText, MAX_CHUNK_TOKENS, TARGET_TOKENS, type PageText,
} from '@/lib/pdf';

/** Builds a page of `paras` paragraphs, each roughly `tokensEach` tokens. */
function page(n: number, paras: number, tokensEach: number): PageText {
  const unit = 'lorem ipsum dolor sit amet ';
  const para = unit.repeat(Math.ceil((tokensEach * 4) / unit.length)).trim();
  return { page: n, text: Array.from({ length: paras }, () => para).join('\n\n') };
}

describe('chunkPages', () => {
  it('returns no chunks for no pages', () => {
    expect(chunkPages([])).toEqual([]);
  });

  it('returns no chunks when every page is blank', () => {
    expect(chunkPages([{ page: 1, text: '   \n\n  ' }])).toEqual([]);
  });

  it('keeps a short document in a single chunk on one page', () => {
    const chunks = chunkPages([{ page: 1, text: 'A short paragraph of text.' }]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ idx: 0, pageStart: 1, pageEnd: 1 });
    expect(chunks[0].content).toContain('short paragraph');
  });

  it('numbers chunks sequentially from zero with no gaps', () => {
    const chunks = chunkPages([page(1, 6, 300), page(2, 6, 300), page(3, 6, 300)]);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((c) => c.idx)).toEqual(chunks.map((_, i) => i));
  });

  it('never emits a chunk above the hard ceiling', () => {
    const chunks = chunkPages([page(1, 20, 250), page(2, 20, 250)]);
    for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(MAX_CHUNK_TOKENS);
  });

  it('splits a single paragraph that alone exceeds the ceiling', () => {
    const chunks = chunkPages([page(1, 1, 5000)]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(MAX_CHUNK_TOKENS);
  });

  it('overlaps consecutive chunks so context is not severed', () => {
    const chunks = chunkPages([page(1, 10, 200), page(2, 10, 200)]);
    expect(chunks.length).toBeGreaterThan(1);
    // Some suffix of chunk N must reappear at the head of chunk N+1.
    const tail = chunks[0].content.slice(-80).trim();
    expect(chunks[1].content.includes(tail.slice(0, 40))).toBe(true);
  });

  it('records a page range that is ordered and inside the source pages', () => {
    const chunks = chunkPages([page(1, 8, 250), page(2, 8, 250), page(3, 8, 250)]);
    for (const c of chunks) {
      expect(c.pageStart).toBeLessThanOrEqual(c.pageEnd);
      expect(c.pageStart).toBeGreaterThanOrEqual(1);
      expect(c.pageEnd).toBeLessThanOrEqual(3);
    }
  });

  it('advances page ranges monotonically through the document', () => {
    const chunks = chunkPages([page(1, 8, 250), page(2, 8, 250), page(3, 8, 250)]);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].pageStart).toBeGreaterThanOrEqual(chunks[i - 1].pageStart);
    }
  });

  it('packs near the target instead of emitting many tiny chunks', () => {
    const chunks = chunkPages([page(1, 12, 250), page(2, 12, 250)]);
    const body = chunks.slice(0, -1); // the final chunk is legitimately short
    for (const c of body) expect(c.tokenCount).toBeGreaterThan(TARGET_TOKENS * 0.5);
  });
});

describe('hasUsableText', () => {
  it('accepts a normal text PDF', () => {
    expect(hasUsableText('word '.repeat(500), 3)).toBe(true);
  });

  it('rejects an empty extraction, meaning a scanned document', () => {
    expect(hasUsableText('', 12)).toBe(false);
  });

  it('rejects a scan yielding only stray characters per page', () => {
    expect(hasUsableText('a\n b\n c', 40)).toBe(false);
  });

  it('accepts a genuinely tiny one-page document', () => {
    expect(hasUsableText('This is a receipt for $40 paid on 3 March 2026.', 1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/pdf-chunking.test.ts`
Expected: FAIL — cannot resolve `@/lib/pdf`.

- [ ] **Step 3: Implement**

Create `lib/pdf.ts`:

```ts
import { extractText, getDocumentProxy } from 'unpdf';
import { estimateTokens } from '@/lib/tokens';

export const TARGET_TOKENS = 1000;
export const OVERLAP_TOKENS = 150;
export const MAX_CHUNK_TOKENS = 1400;

export type PageText = { page: number; text: string };
export type Chunk = {
  idx: number;
  content: string;
  pageStart: number;
  pageEnd: number;
  tokenCount: number;
};

export async function extractPdfText(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });

  const pages: PageText[] = (text as string[]).map((t, i) => ({
    page: i + 1,
    text: (t ?? '').replace(/\r\n/g, '\n').trim(),
  }));
  const fullText = pages.map((p) => p.text).filter(Boolean).join('\n\n');

  return { pages, pageCount: totalPages, fullText, charCount: fullText.length };
}

/**
 * A scanned PDF extracts to almost nothing. Rather than summarizing noise we
 * detect it: under 100 characters per page on average means there is no text
 * layer worth processing. Single-page documents get a lower floor so a one-page
 * receipt is not misclassified as a scan.
 */
export function hasUsableText(fullText: string, pageCount: number): boolean {
  const trimmed = fullText.trim();
  if (trimmed.length < 200) return pageCount <= 1 && trimmed.length >= 20;
  return trimmed.length / Math.max(pageCount, 1) >= 100;
}

type Segment = { text: string; page: number; tokens: number };

/** Paragraphs in document order, with any oversized paragraph pre-split on word boundaries. */
function toSegments(pages: PageText[]): Segment[] {
  const segments: Segment[] = [];

  for (const p of pages) {
    const paragraphs = p.text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);

    for (const paragraph of paragraphs) {
      let remaining = paragraph;

      while (estimateTokens(remaining) > MAX_CHUNK_TOKENS) {
        const limit = MAX_CHUNK_TOKENS * 4;
        let cut = remaining.lastIndexOf(' ', limit);
        if (cut <= 0) cut = limit; // an unbroken run of characters
        const head = remaining.slice(0, cut).trim();
        segments.push({ text: head, page: p.page, tokens: estimateTokens(head) });
        remaining = remaining.slice(cut).trim();
      }

      if (remaining) {
        segments.push({ text: remaining, page: p.page, tokens: estimateTokens(remaining) });
      }
    }
  }

  return segments;
}

/**
 * Greedy packing to ~TARGET_TOKENS on paragraph boundaries, so a chunk rarely
 * severs a sentence, then carrying ~OVERLAP_TOKENS of the tail into the next
 * chunk. Page numbers ride along on each segment, which is what lets chat cite
 * pages later.
 */
export function chunkPages(pages: PageText[]): Chunk[] {
  const segments = toSegments(pages);
  if (segments.length === 0) return [];

  const chunks: Chunk[] = [];
  let current: Segment[] = [];
  let tokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    const content = current.map((s) => s.text).join('\n\n');
    chunks.push({
      idx: chunks.length,
      content,
      pageStart: current[0].page,
      pageEnd: current[current.length - 1].page,
      tokenCount: estimateTokens(content),
    });
  };

  for (const segment of segments) {
    if (current.length > 0 && tokens + segment.tokens > TARGET_TOKENS) {
      flush();

      // Seed the next chunk with this one's tail, newest-first, until the
      // overlap budget is spent. Always carry at least one segment.
      const carried: Segment[] = [];
      let carriedTokens = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        if (carried.length > 0 && carriedTokens + current[i].tokens > OVERLAP_TOKENS) break;
        carried.unshift(current[i]);
        carriedTokens += current[i].tokens;
        if (carriedTokens >= OVERLAP_TOKENS) break;
      }
      current = carried;
      tokens = carriedTokens;
    }

    current.push(segment);
    tokens += segment.tokens;
  }

  flush();
  return chunks;
}
```

Note the `carried.length > 0` guard: without it, a tail paragraph larger than `OVERLAP_TOKENS` would carry nothing and the overlap test would fail.

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm test -- tests/pdf-chunking.test.ts`
Expected: 14 passed.

- [ ] **Step 5: Verify extraction against a real PDF**

The unit tests never exercise `unpdf`, so prove the API shape once by hand against any PDF on disk:

```bash
npx tsx -e "
import { extractPdfText, chunkPages } from './lib/pdf';
import { readFileSync } from 'node:fs';
const bytes = new Uint8Array(readFileSync(process.argv[1]));
const r = await extractPdfText(bytes);
console.log({ pageCount: r.pageCount, charCount: r.charCount });
const c = chunkPages(r.pages);
console.log({ chunks: c.length, firstChunk: c[0]?.content.slice(0, 200) });
" "C:/path/to/some.pdf"
```

Expected: a correct page count and readable first-chunk text. This is the step that catches an `unpdf` API mismatch before it reaches a route handler.

- [ ] **Step 6: Commit**

```bash
git add lib/pdf.ts tests/pdf-chunking.test.ts
git commit -m "feat: add PDF extraction and overlap-aware page-tracking chunker"
```

---

## Task 8: Gemini client, prompts, and summarization

**Files:**
- Create: `lib/ai/gemini.ts`, `lib/ai/prompts.ts`, `lib/ai/summarize.ts`
- Test: `tests/summarize.test.ts`

**Interfaces:**
- Consumes: `GEMINI_API_KEY`, `Chunk`, `estimateTokens`.
- Produces:
  - `CHAT_MODEL = 'gemini-2.5-flash'`, `EMBED_MODEL = 'gemini-embedding-001'`
  - `type GenerateArgs = { system: string; user: string; maxOutputTokens?: number; temperature?: number }`
  - `type Generate = (args: GenerateArgs) => Promise<string>`
  - `geminiGenerate: Generate`, `withRetry<T>(fn, attempts?)`, `getAi()`
  - `SUMMARY_SYSTEM`, `MAP_SYSTEM`, `CHAT_SYSTEM`, `summaryUser(text)`, `reduceUser(bullets)`
  - `LONG_DOC_TOKEN_THRESHOLD = 40_000`, `MAX_MAP_CALLS = 60`
  - `summarizeDocument(input, generate?): Promise<string>` where `input = { fullText, chunks, tokenEstimate }`

`summarizeDocument` takes its `generate` function as an injected parameter defaulting to the real Gemini call. That injection is the only reason the summarization strategy is unit-testable without a network or an API key.

- [ ] **Step 1: Write the prompts**

Create `lib/ai/prompts.ts`:

```ts
/**
 * All prompt text lives here so it can be reviewed and tuned in one place.
 * Each rule below exists to counter a specific observed failure mode; do not
 * trim them for brevity.
 */

export const SUMMARY_SYSTEM = `You write briefing notes for someone deciding whether this document needs their attention today. You never pad and never editorialize.

Write a 3-5 sentence summary of the document provided.

- Open with what the document DOES - its operative effect, not its topic.
  "Acme licenses its API to Beta for $4k/month over 24 months" - not
  "This document discusses a licensing arrangement."
- Include the specifics a reader would otherwise have to open the file for:
  named parties, dates, amounts, versions, quantities, findings, decisions.
- Never open with "This document", "This paper", "The following", or
  "In this report".
- Never describe structure ("it is divided into five sections").
- State only what the text supports. If the extract is partial or garbled,
  say so in your last sentence rather than guessing.
- 3-5 sentences. No headings, no bullets, no preamble.`;

export const MAP_SYSTEM = `You extract facts from one excerpt of a longer document, for later synthesis.

Output terse bullets only - no prose, no preamble, no conclusion.
Capture: parties and roles, obligations, figures and amounts, dates and
deadlines, findings, decisions, defined terms.
Omit anything procedural or boilerplate. If the excerpt carries no
substantive facts, output exactly: NONE`;

export const CHAT_SYSTEM = `You answer questions about ONE document, using only the excerpts provided.

- Ground every claim in the excerpts. Cite pages inline like (p. 12).
- If the excerpts do not contain the answer, say what is missing - "The
  excerpts don't cover the termination terms" - and mention what nearby
  content they do cover. Never fill a gap with general knowledge.
- If a question is ambiguous, resolve it against the conversation so far;
  only ask the user if it is genuinely undecidable.
- Quote exact wording (at most one sentence) when precision matters:
  definitions, figures, legal language.
- Match the question's scope. A yes/no question gets yes/no plus one
  supporting line, not an essay.`;

export function summaryUser(documentText: string): string {
  return `DOCUMENT:\n\n${documentText}`;
}

export function reduceUser(bullets: string): string {
  return `The following facts were extracted from consecutive excerpts of one long document, in order. Write the summary from them.\n\nFACTS:\n\n${bullets}`;
}

export function chatUser(context: string, question: string): string {
  return `EXCERPTS FROM THE DOCUMENT:\n\n${context}\n\n---\n\nQUESTION: ${question}`;
}
```

- [ ] **Step 2: Write the Gemini client**

Create `lib/ai/gemini.ts`:

```ts
import { GoogleGenAI } from '@google/genai';

export const CHAT_MODEL = 'gemini-2.5-flash';
export const EMBED_MODEL = 'gemini-embedding-001';

export type GenerateArgs = {
  system: string;
  user: string;
  maxOutputTokens?: number;
  temperature?: number;
};
export type Generate = (args: GenerateArgs) => Promise<string>;

let client: GoogleGenAI | null = null;

export function getAi(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

function isRetryable(error: unknown): boolean {
  const probe = String(
    (error as { status?: unknown })?.status ?? (error as Error)?.message ?? error,
  );
  return /\b(429|500|502|503|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE/i.test(probe);
}

/** Exponential backoff with jitter. The free tier rate-limits aggressively. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts - 1) throw error;
      const delay = 600 * 2 ** attempt + Math.random() * 400;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

export const geminiGenerate: Generate = ({
  system, user, maxOutputTokens = 1024, temperature = 0.2,
}) =>
  withRetry(async () => {
    const response = await getAi().models.generateContent({
      model: CHAT_MODEL,
      contents: [{ role: 'user', parts: [{ text: user }] }],
      config: { systemInstruction: system, temperature, maxOutputTokens },
    });
    return (response.text ?? '').trim();
  });
```

- [ ] **Step 3: Write the failing summarization test**

Create `tests/summarize.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { summarizeDocument, LONG_DOC_TOKEN_THRESHOLD, MAX_MAP_CALLS } from '@/lib/ai/summarize';
import { SUMMARY_SYSTEM, MAP_SYSTEM } from '@/lib/ai/prompts';
import type { GenerateArgs } from '@/lib/ai/gemini';

function fakeGenerate(reply: (a: GenerateArgs, n: number) => string) {
  const calls: GenerateArgs[] = [];
  const fn = vi.fn(async (args: GenerateArgs) => {
    calls.push(args);
    return reply(args, calls.length);
  });
  return { fn, calls };
}

const chunk = (i: number, content: string) => ({ content, pageStart: i + 1, pageEnd: i + 1 });

describe('summarizeDocument - short documents', () => {
  it('makes exactly one call below the threshold', async () => {
    const { fn, calls } = fakeGenerate(() => 'A crisp three sentence summary.');
    const summary = await summarizeDocument(
      { fullText: 'short text', chunks: [chunk(0, 'short text')], tokenEstimate: 500 },
      fn,
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls[0].system).toBe(SUMMARY_SYSTEM);
    expect(calls[0].user).toContain('short text');
    expect(summary).toBe('A crisp three sentence summary.');
  });

  it('trims surrounding whitespace from the model reply', async () => {
    const { fn } = fakeGenerate(() => '\n  Summary text.  \n');
    const summary = await summarizeDocument(
      { fullText: 'x', chunks: [chunk(0, 'x')], tokenEstimate: 10 },
      fn,
    );
    expect(summary).toBe('Summary text.');
  });
});

describe('summarizeDocument - long documents', () => {
  const longChunks = Array.from({ length: 5 }, (_, i) => chunk(i, `chunk body ${i}`));

  it('maps every chunk then reduces, in that order', async () => {
    const { fn, calls } = fakeGenerate((a) =>
      a.system === MAP_SYSTEM ? `- fact from ${a.user.slice(0, 20)}` : 'Final summary.',
    );

    const summary = await summarizeDocument(
      { fullText: 'irrelevant', chunks: longChunks, tokenEstimate: LONG_DOC_TOKEN_THRESHOLD + 1 },
      fn,
    );

    expect(fn).toHaveBeenCalledTimes(longChunks.length + 1);
    expect(calls.slice(0, -1).every((c) => c.system === MAP_SYSTEM)).toBe(true);
    expect(calls.at(-1)!.system).toBe(SUMMARY_SYSTEM);
    expect(summary).toBe('Final summary.');
  });

  it('feeds the mapped facts into the reduce call, not the raw text', async () => {
    const { fn, calls } = fakeGenerate((a) =>
      a.system === MAP_SYSTEM ? '- distinctive-extracted-fact' : 'Done.',
    );
    await summarizeDocument(
      { fullText: 'raw-document-body', chunks: longChunks, tokenEstimate: 90_000 },
      fn,
    );
    const reduce = calls.at(-1)!;
    expect(reduce.user).toContain('distinctive-extracted-fact');
    expect(reduce.user).not.toContain('raw-document-body');
  });

  it('drops chunks the mapper reports as NONE', async () => {
    const { fn, calls } = fakeGenerate((a, n) => {
      if (a.system !== MAP_SYSTEM) return 'Done.';
      return n === 1 ? '- kept fact' : 'NONE';
    });
    await summarizeDocument(
      { fullText: 'x', chunks: longChunks, tokenEstimate: 90_000 },
      fn,
    );
    const reduce = calls.at(-1)!;
    expect(reduce.user).toContain('kept fact');
    expect(reduce.user).not.toContain('NONE');
  });

  it('caps map calls on a very long document by sampling evenly', async () => {
    const many = Array.from({ length: 400 }, (_, i) => chunk(i, `body ${i}`));
    const { fn } = fakeGenerate((a) => (a.system === MAP_SYSTEM ? '- f' : 'Done.'));
    await summarizeDocument({ fullText: 'x', chunks: many, tokenEstimate: 900_000 }, fn);
    expect(fn).toHaveBeenCalledTimes(MAX_MAP_CALLS + 1);
  });

  it('still samples the first and last chunk when capping', async () => {
    const many = Array.from({ length: 400 }, (_, i) => chunk(i, `body ${i}`));
    const { fn, calls } = fakeGenerate((a) => (a.system === MAP_SYSTEM ? '- f' : 'Done.'));
    await summarizeDocument({ fullText: 'x', chunks: many, tokenEstimate: 900_000 }, fn);
    const mapped = calls.filter((c) => c.system === MAP_SYSTEM);
    expect(mapped[0].user).toContain('body 0');
    expect(mapped.at(-1)!.user).toContain('body 399');
  });

  it('falls back to a plain notice if every chunk maps to NONE', async () => {
    const { fn } = fakeGenerate((a) => (a.system === MAP_SYSTEM ? 'NONE' : 'unused'));
    const summary = await summarizeDocument(
      { fullText: 'x', chunks: longChunks, tokenEstimate: 90_000 },
      fn,
    );
    expect(summary).toMatch(/could not be summarized|no substantive/i);
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `npm test -- tests/summarize.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/summarize`.

- [ ] **Step 5: Implement summarization**

Create `lib/ai/summarize.ts`:

```ts
import { geminiGenerate, type Generate } from './gemini';
import { SUMMARY_SYSTEM, MAP_SYSTEM, summaryUser, reduceUser } from './prompts';

/** Documents at or above this estimate go through map-reduce instead of one call. */
export const LONG_DOC_TOKEN_THRESHOLD = 40_000;

/**
 * A 1,000-page PDF would otherwise issue ~1,500 map calls and exhaust the free
 * tier. Above this many chunks we sample evenly across the document, which keeps
 * coverage of the beginning, middle, and end rather than truncating.
 */
export const MAX_MAP_CALLS = 60;

type SummarizeInput = {
  fullText: string;
  chunks: { content: string; pageStart: number; pageEnd: number }[];
  tokenEstimate: number;
};

/** Evenly spaced sample that always includes the first and last element. */
function sampleEvenly<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  const step = (items.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, i) => items[Math.round(i * step)]);
}

/** Small concurrency pool — enough to be fast, low enough not to trip rate limits. */
async function mapWithConcurrency<T, R>(
  items: T[], limit: number, fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

export async function summarizeDocument(
  input: SummarizeInput,
  generate: Generate = geminiGenerate,
): Promise<string> {
  if (input.tokenEstimate < LONG_DOC_TOKEN_THRESHOLD) {
    const summary = await generate({
      system: SUMMARY_SYSTEM,
      user: summaryUser(input.fullText),
      maxOutputTokens: 400,
    });
    return summary.trim();
  }

  const sampled = sampleEvenly(input.chunks, MAX_MAP_CALLS);

  const mapped = await mapWithConcurrency(sampled, 4, (chunk) =>
    generate({
      system: MAP_SYSTEM,
      user: `EXCERPT (pages ${chunk.pageStart}-${chunk.pageEnd}):\n\n${chunk.content}`,
      maxOutputTokens: 400,
    }),
  );

  const facts = mapped
    .map((m) => m.trim())
    .filter((m) => m && m.toUpperCase() !== 'NONE')
    .join('\n');

  if (!facts) {
    return 'This document could not be summarized: no substantive text was found in the sampled excerpts.';
  }

  const summary = await generate({
    system: SUMMARY_SYSTEM,
    user: reduceUser(facts),
    maxOutputTokens: 400,
  });
  return summary.trim();
}
```

- [ ] **Step 6: Run it and confirm it passes**

Run: `npm test -- tests/summarize.test.ts`
Expected: 9 passed.

- [ ] **Step 7: Verify against the real API once**

```bash
npx tsx --env-file=.env.local -e "
import { summarizeDocument } from './lib/ai/summarize';
const text = 'This Master Services Agreement is entered into on 4 April 2026 between Northwind Ltd (Supplier) and Contoso GmbH (Customer). The Supplier will provide managed database hosting for 36 months at EUR 12,500 per month. Either party may terminate for material breach on 30 days written notice. Liability is capped at fees paid in the preceding 12 months.';
console.log(await summarizeDocument({ fullText: text, chunks: [{content: text, pageStart: 1, pageEnd: 1}], tokenEstimate: 100 }));
"
```

Expected: 3–5 sentences naming Northwind, Contoso, EUR 12,500, 36 months — and **not** beginning with "This document". If it opens with "This document", the prompt is not being applied as a system instruction; check `config.systemInstruction`.

- [ ] **Step 8: Commit**

```bash
git add lib/ai tests/summarize.test.ts
git commit -m "feat: add Gemini client, prompt library, and map-reduce summarization"
```

---

## Task 9: Embeddings

**Files:**
- Create: `lib/ai/embed.ts`
- Test: `tests/embed.test.ts`

**Interfaces:**
- Consumes: `getAi`, `withRetry`, `EMBED_MODEL`.
- Produces: `EMBED_DIMENSIONS = 768`, `EMBED_BATCH_SIZE = 24`, `l2Normalize(v: number[]): number[]`, `embedTexts(texts: string[], taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'): Promise<number[][]>`, `embedQuery(text: string): Promise<number[]>`.

- [ ] **Step 1: Write the failing test**

Create `tests/embed.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { l2Normalize, EMBED_DIMENSIONS } from '@/lib/ai/embed';

const magnitude = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

describe('l2Normalize', () => {
  it('scales a vector to unit length', () => {
    expect(magnitude(l2Normalize([3, 4]))).toBeCloseTo(1, 10);
  });

  it('leaves an already-normal vector effectively unchanged', () => {
    const v = l2Normalize([1, 0, 0]);
    expect(v).toEqual([1, 0, 0]);
  });

  it('preserves direction', () => {
    const v = l2Normalize([3, 4]);
    expect(v[0] / v[1]).toBeCloseTo(3 / 4, 10);
  });

  it('returns a zero vector unchanged rather than producing NaN', () => {
    const v = l2Normalize([0, 0, 0]);
    expect(v).toEqual([0, 0, 0]);
    expect(v.some(Number.isNaN)).toBe(false);
  });

  it('handles negative components', () => {
    expect(magnitude(l2Normalize([-3, -4]))).toBeCloseTo(1, 10);
  });
});

describe('EMBED_DIMENSIONS', () => {
  it('is 768, under pgvector HNSW 2000-dimension index limit', () => {
    expect(EMBED_DIMENSIONS).toBe(768);
    expect(EMBED_DIMENSIONS).toBeLessThan(2000);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/embed.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/embed`.

- [ ] **Step 3: Implement**

Create `lib/ai/embed.ts`:

```ts
import { getAi, withRetry, EMBED_MODEL } from './gemini';

export const EMBED_DIMENSIONS = 768;
export const EMBED_BATCH_SIZE = 24;

export type EmbedTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

/**
 * gemini-embedding-001 returns unit-length vectors ONLY at its native 3072
 * dimensions. Because we request 768, the vectors come back unnormalized and
 * cosine distance would be wrong unless we normalize here.
 */
export function l2Normalize(vector: number[]): number[] {
  let sumSquares = 0;
  for (const value of vector) sumSquares += value * value;
  const magnitude = Math.sqrt(sumSquares);
  if (magnitude === 0) return vector.slice();
  return vector.map((value) => value / magnitude);
}

export async function embedTexts(
  texts: string[],
  taskType: EmbedTaskType,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBED_BATCH_SIZE);

    const response = await withRetry(() =>
      getAi().models.embedContent({
        model: EMBED_MODEL,
        contents: batch,
        config: { taskType, outputDimensionality: EMBED_DIMENSIONS },
      }),
    );

    const embeddings = response.embeddings ?? [];
    if (embeddings.length !== batch.length) {
      throw new Error(`Embedding count mismatch: sent ${batch.length}, got ${embeddings.length}`);
    }
    for (const embedding of embeddings) {
      vectors.push(l2Normalize(embedding.values ?? []));
    }
  }

  return vectors;
}

/** Queries use a different task type than documents — the model is asymmetric. */
export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text], 'RETRIEVAL_QUERY');
  return vector;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm test -- tests/embed.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Verify dimensions against the real API**

```bash
npx tsx --env-file=.env.local -e "
import { embedTexts } from './lib/ai/embed';
const v = await embedTexts(['employment contract termination clause', 'chocolate cake recipe'], 'RETRIEVAL_DOCUMENT');
const mag = (x) => Math.sqrt(x.reduce((s, n) => s + n * n, 0));
const dot = (a, b) => a.reduce((s, n, i) => s + n * b[i], 0);
console.log({ count: v.length, dims: v[0].length, magnitude: mag(v[0]).toFixed(6), similarity: dot(v[0], v[1]).toFixed(4) });
"
```

Expected: `dims: 768`, `magnitude: 1.000000`, and a similarity well below 0.5 for those two unrelated strings. A magnitude other than 1 means normalization is not being applied.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/embed.ts tests/embed.test.ts
git commit -m "feat: add 768-dim Gemini embeddings with explicit L2 normalization"
```

---

## Task 10: Upload flow and the staged ingest pipeline

**Files:**
- Create: `app/(app)/dashboard/actions.ts`, `app/api/documents/[id]/ingest/route.ts`, `app/api/documents/[id]/embed/route.ts`, `app/api/documents/[id]/status/route.ts`, `components/upload-dropzone.tsx`, `lib/api-error.ts`
- Test: manual verification against a real PDF (this task is integration by nature; its logic is already covered by Tasks 6–9)

**Interfaces:**
- Consumes: `auth`, `requireOwnedDocument`, `AccessError`, storage helpers, `extractPdfText`, `chunkPages`, `hasUsableText`, `summarizeDocument`, `embedTexts`.
- Produces:
  - `createUploadTarget(filename: string, sizeBytes: number): Promise<{ documentId: string; signedUrl: string; path: string }>`
  - `POST /api/documents/[id]/ingest` → `{ status, scanned?: boolean, chunkCount?: number }`
  - `POST /api/documents/[id]/embed` → `{ embedded: number, remaining: number, done: boolean }`
  - `GET /api/documents/[id]/status` → `{ status, summary, error, pageCount, hasExtractableText, remainingChunks }`
  - `type DocumentStage` progression consumed by `document-card.tsx` in Task 11

**Deviation from spec §6:** the spec describes `/embed` as cursor-driven. We drive it off `WHERE embedding IS NULL` instead, which is the same staged shape but strictly more robust — a half-finished batch cannot be skipped by a stale cursor, and retrying is inherently idempotent.

- [ ] **Step 1: Add a shared error helper**

Create `lib/api-error.ts`:

```ts
import { NextResponse } from 'next/server';
import { AccessError } from '@/lib/authz';

export function toErrorResponse(error: unknown) {
  if (error instanceof AccessError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  return NextResponse.json({ error: 'Something went wrong' }, { status: 500 });
}
```

- [ ] **Step 2: Implement the upload-target server action**

Create `app/(app)/dashboard/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { documents } from '@/lib/db/schema';
import { createSignedUploadUrl, storagePathFor, MAX_UPLOAD_BYTES } from '@/lib/storage';

export async function createUploadTarget(filename: string, sizeBytes: number) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  if (!filename.toLowerCase().endsWith('.pdf')) {
    throw new Error('Only PDF files are accepted.');
  }
  if (sizeBytes <= 0 || sizeBytes > MAX_UPLOAD_BYTES) {
    throw new Error('File must be between 1 byte and 25MB.');
  }

  const [doc] = await db.insert(documents).values({
    ownerId: session.user.id,
    filename: filename.slice(0, 255),
    storagePath: 'pending',
    sizeBytes,
    status: 'uploading',
  }).returning({ id: documents.id });

  const path = storagePathFor(session.user.id, doc.id);
  const { signedUrl } = await createSignedUploadUrl(path);

  await db.update(documents).set({ storagePath: path, updatedAt: new Date() })
    .where(eq(documents.id, doc.id));

  return { documentId: doc.id, signedUrl, path };
}
```

Add `import { eq } from 'drizzle-orm';` at the top.

- [ ] **Step 3: Implement the ingest route**

Create `app/api/documents/[id]/ingest/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { documents, chunks as chunksTable } from '@/lib/db/schema';
import { requireOwnedDocument, AccessError } from '@/lib/authz';
import { downloadObject, looksLikePdf, deleteObject } from '@/lib/storage';
import { extractPdfText, chunkPages, hasUsableText } from '@/lib/pdf';
import { estimateTokens } from '@/lib/tokens';
import { summarizeDocument } from '@/lib/ai/summarize';
import { toErrorResponse } from '@/lib/api-error';

export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const session = await auth();
    if (!session?.user?.id) throw new AccessError(404, 'Not found');
    const doc = await requireOwnedDocument(id, session.user.id);

    const fail = async (message: string) => {
      await db.update(documents)
        .set({ status: 'failed', error: message, updatedAt: new Date() })
        .where(eq(documents.id, id));
      return NextResponse.json({ status: 'failed', error: message }, { status: 400 });
    };

    await db.update(documents)
      .set({ status: 'extracting', error: null, updatedAt: new Date() })
      .where(eq(documents.id, id));

    const bytes = await downloadObject(doc.storagePath);

    // Authoritative format check: MIME and extension are client-supplied and forgeable.
    if (!looksLikePdf(bytes)) {
      await deleteObject(doc.storagePath).catch(() => {});
      return fail('That file is not a valid PDF.');
    }

    const { pages, pageCount, fullText, charCount } = await extractPdfText(bytes);

    // Scanned documents: record the fact, skip the AI stages, finish as ready.
    if (!hasUsableText(fullText, pageCount)) {
      await db.update(documents).set({
        status: 'ready', pageCount, charCount,
        tokenEstimate: 0, hasExtractableText: false,
        summary: null, updatedAt: new Date(),
      }).where(eq(documents.id, id));
      return NextResponse.json({ status: 'ready', scanned: true });
    }

    const tokenEstimate = estimateTokens(fullText);
    await db.update(documents).set({
      status: 'summarizing', pageCount, charCount, fullText,
      tokenEstimate, hasExtractableText: true, updatedAt: new Date(),
    }).where(eq(documents.id, id));

    const docChunks = chunkPages(pages);
    const summary = await summarizeDocument({ fullText, chunks: docChunks, tokenEstimate });

    // Insert chunk rows with embedding NULL; Task 9's embedder fills them in batches.
    if (docChunks.length > 0) {
      await db.insert(chunksTable).values(
        docChunks.map((c) => ({
          documentId: id, idx: c.idx, content: c.content,
          pageStart: c.pageStart, pageEnd: c.pageEnd, tokenCount: c.tokenCount,
        })),
      ).onConflictDoNothing();
    }

    await db.update(documents)
      .set({ summary, status: 'indexing', updatedAt: new Date() })
      .where(eq(documents.id, id));

    return NextResponse.json({ status: 'indexing', chunkCount: docChunks.length });
  } catch (error) {
    await db.update(documents)
      .set({
        status: 'failed',
        error: error instanceof Error ? error.message.slice(0, 500) : 'Processing failed',
        updatedAt: new Date(),
      })
      .where(eq(documents.id, id))
      .catch(() => {});
    return toErrorResponse(error);
  }
}
```

- [ ] **Step 4: Implement the embed route**

Create `app/api/documents/[id]/embed/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { documents, chunks } from '@/lib/db/schema';
import { requireOwnedDocument, AccessError } from '@/lib/authz';
import { embedTexts, EMBED_BATCH_SIZE } from '@/lib/ai/embed';
import { toErrorResponse } from '@/lib/api-error';

export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const session = await auth();
    if (!session?.user?.id) throw new AccessError(404, 'Not found');
    await requireOwnedDocument(id, session.user.id);

    // Driven by "embedding IS NULL" rather than a caller-held cursor, so a
    // retry can never skip a batch.
    const pending = await db.select({ id: chunks.id, content: chunks.content })
      .from(chunks)
      .where(and(eq(chunks.documentId, id), isNull(chunks.embedding)))
      .orderBy(asc(chunks.idx))
      .limit(EMBED_BATCH_SIZE);

    if (pending.length > 0) {
      const vectors = await embedTexts(pending.map((c) => c.content), 'RETRIEVAL_DOCUMENT');
      await Promise.all(
        pending.map((chunk, i) =>
          db.update(chunks).set({ embedding: vectors[i] }).where(eq(chunks.id, chunk.id)),
        ),
      );
    }

    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(chunks)
      .where(and(eq(chunks.documentId, id), isNull(chunks.embedding)));

    const done = count === 0;
    if (done) {
      await db.update(documents)
        .set({ status: 'ready', updatedAt: new Date() })
        .where(eq(documents.id, id));
    }

    return NextResponse.json({ embedded: pending.length, remaining: count, done });
  } catch (error) {
    return toErrorResponse(error);
  }
}
```

- [ ] **Step 5: Implement the status route**

Create `app/api/documents/[id]/status/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { chunks } from '@/lib/db/schema';
import { requireOwnedDocument, AccessError } from '@/lib/authz';
import { toErrorResponse } from '@/lib/api-error';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await auth();
    if (!session?.user?.id) throw new AccessError(404, 'Not found');
    const doc = await requireOwnedDocument(id, session.user.id);

    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(chunks)
      .where(and(eq(chunks.documentId, id), isNull(chunks.embedding)));

    return NextResponse.json({
      status: doc.status,
      summary: doc.summary,
      error: doc.error,
      pageCount: doc.pageCount,
      hasExtractableText: doc.hasExtractableText,
      remainingChunks: count,
      updatedAt: doc.updatedAt,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
```

- [ ] **Step 6: Build the upload dropzone**

Create `components/upload-dropzone.tsx`:

```tsx
'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { UploadCloud } from 'lucide-react';
import { createUploadTarget } from '@/app/(app)/dashboard/actions';

const MAX_BYTES = 25 * 1024 * 1024;

export function UploadDropzone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [, startTransition] = useTransition();

  async function handleFile(file: File) {
    setError(null);

    // First-line validation. The server re-checks magic bytes regardless.
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are accepted.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('That file is larger than 25MB.');
      return;
    }

    setBusy(true);
    try {
      const { documentId, signedUrl } = await createUploadTarget(file.name, file.size);

      // Straight to Supabase Storage: Vercel caps request bodies at 4.5MB.
      const upload = await fetch(signedUrl, {
        method: 'PUT',
        body: file,
        headers: { 'content-type': 'application/pdf' },
      });
      if (!upload.ok) throw new Error('Upload failed. Please try again.');

      // Kick off stage one; the document card takes over driving from here.
      void fetch(`/api/documents/${documentId}/ingest`, { method: 'POST' });
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition ${
          dragging ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-300'
        } ${busy ? 'pointer-events-none opacity-60' : ''}`}
      >
        <UploadCloud className="size-6 text-neutral-500" aria-hidden />
        <p className="text-sm font-medium">
          {busy ? 'Uploading…' : 'Drop a PDF here, or click to choose'}
        </p>
        <p className="text-xs text-neutral-500">PDF only, up to 25MB</p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 7: Verify the pipeline end to end by hand**

Temporarily render `<UploadDropzone />` in `app/(app)/dashboard/page.tsx`. Then:

1. `npm run dev`, sign in, upload a small text-based PDF.
2. Watch the `documents` row in Supabase move `uploading → extracting → summarizing → indexing`.
3. `curl` or fetch `POST /api/documents/<id>/embed` repeatedly until `done: true`, then confirm `status = ready`.
4. Confirm `chunks` rows exist and `embedding` is non-null on all of them.
5. Read the `summary` column — it must name specifics from your PDF and must not start with "This document".
6. Rename a `.png` to `.pdf` and upload it → row ends at `status = failed` with "That file is not a valid PDF", and the storage object is gone.
7. Upload a scanned/image-only PDF → `status = ready`, `has_extractable_text = false`, `summary` null.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add staged ingest pipeline with direct-to-storage upload"
```

---

## Task 11: Dashboard, document cards, and live status

**Files:**
- Create/replace: `app/(app)/dashboard/page.tsx`, `components/document-card.tsx`, `components/search-bar.tsx`, `lib/format.ts`
- Test: manual (rendering and polling; the underlying logic is covered by Tasks 6–10)

**Interfaces:**
- Consumes: `auth`, `db`, `documents`, the three routes from Task 10.
- Produces: `formatBytes(n)`, `formatDate(d)`, `<DocumentCard doc={...} />` which owns stage-driving and polling, `<SearchBar />`.

`DocumentCard` is the single place that advances a document through its stages. That covers the fresh-upload case and the abandoned-tab case (spec §6, "Resuming abandoned work") with one code path instead of two.

- [ ] **Step 1: Add formatting helpers**

Create `lib/format.ts`:

```ts
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}
```

- [ ] **Step 2: Build the document card**

Create `components/document-card.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, AlertCircle, ScanLine } from 'lucide-react';
import { formatDate, formatBytes } from '@/lib/format';

export type CardDocument = {
  id: string;
  filename: string;
  status: string;
  summary: string | null;
  error: string | null;
  pageCount: number | null;
  sizeBytes: number;
  hasExtractableText: boolean | null;
  shareCount: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  matchSnippet?: string | null;
};

const STAGE_LABEL: Record<string, string> = {
  uploading: 'Uploading…',
  extracting: 'Extracting text…',
  summarizing: 'Writing summary…',
  indexing: 'Indexing for search…',
};

const TERMINAL = new Set(['ready', 'failed']);
const STALE_MS = 90_000;

export function DocumentCard({ doc }: { doc: CardDocument }) {
  const router = useRouter();
  const [state, setState] = useState(doc);
  const driving = useRef(false);

  useEffect(() => setState(doc), [doc]);

  useEffect(() => {
    if (TERMINAL.has(state.status)) return;

    let cancelled = false;

    /**
     * Advances the document. The uploader normally triggers /ingest itself, so
     * this only re-triggers a stage that has visibly stalled — which is exactly
     * what recovers a document whose uploader closed the tab.
     */
    async function drive(status: string, updatedAt: string | Date) {
      if (driving.current) return;
      const stalled = Date.now() - new Date(updatedAt).getTime() > STALE_MS;

      if (status === 'indexing') {
        driving.current = true;
        try {
          let done = false;
          while (!done && !cancelled) {
            const res = await fetch(`/api/documents/${doc.id}/embed`, { method: 'POST' });
            if (!res.ok) break;
            done = (await res.json()).done;
          }
        } finally {
          driving.current = false;
        }
        return;
      }

      if (stalled && ['uploading', 'extracting', 'summarizing'].includes(status)) {
        driving.current = true;
        try {
          await fetch(`/api/documents/${doc.id}/ingest`, { method: 'POST' });
        } finally {
          driving.current = false;
        }
      }
    }

    async function poll() {
      const res = await fetch(`/api/documents/${doc.id}/status`);
      if (!res.ok || cancelled) return;
      const next = await res.json();

      setState((prev) => ({ ...prev, ...next }));
      if (TERMINAL.has(next.status)) {
        router.refresh();
        return;
      }
      await drive(next.status, next.updatedAt);
    }

    void poll();
    const timer = setInterval(poll, 2500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [doc.id, state.status, router]);

  const isScanned = state.status === 'ready' && state.hasExtractableText === false;

  return (
    <article className="flex flex-col gap-3 rounded-lg border p-4 transition hover:border-neutral-400">
      <div className="flex items-start gap-3">
        <FileText className="mt-0.5 size-5 shrink-0 text-neutral-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <Link href={`/d/${doc.id}`} className="block truncate font-medium hover:underline">
            {state.filename}
          </Link>
          <p className="mt-0.5 text-xs text-neutral-500">
            {formatDate(state.createdAt)} · {formatBytes(state.sizeBytes)}
            {state.pageCount ? ` · ${state.pageCount} pages` : ''}
            {state.shareCount > 0 ? ` · shared with ${state.shareCount}` : ''}
          </p>
        </div>
      </div>

      {state.status === 'failed' ? (
        <div className="flex items-start gap-2 rounded-md bg-red-50 p-2 text-sm text-red-800">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p>{state.error ?? 'Processing failed.'}</p>
            <button
              onClick={async () => {
                await fetch(`/api/documents/${doc.id}/ingest`, { method: 'POST' });
                setState((p) => ({ ...p, status: 'extracting', error: null }));
              }}
              className="mt-1 underline"
            >
              Retry
            </button>
          </div>
        </div>
      ) : isScanned ? (
        <p className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800">
          <ScanLine className="mt-0.5 size-4 shrink-0" aria-hidden />
          No extractable text — this looks like a scanned document, so summary and chat are unavailable.
        </p>
      ) : TERMINAL.has(state.status) ? (
        <p className="text-sm leading-relaxed text-neutral-700">{state.summary}</p>
      ) : (
        <p className="flex items-center gap-2 text-sm text-neutral-500">
          <span className="size-3 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
          {STAGE_LABEL[state.status] ?? 'Processing…'}
        </p>
      )}

      {state.matchSnippet && (
        <p className="border-l-2 border-neutral-300 pl-3 text-xs italic text-neutral-600">
          …{state.matchSnippet}…
        </p>
      )}
    </article>
  );
}
```

- [ ] **Step 3: Build the search bar**

Create `components/search-bar.tsx`:

```tsx
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Search } from 'lucide-react';

export function SearchBar() {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [mode, setMode] = useState(params.get('mode') ?? 'filename');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = new URLSearchParams();
    if (query.trim()) next.set('q', query.trim());
    next.set('mode', mode);
    router.push(`/dashboard?${next.toString()}`);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={mode === 'filename' ? 'Search filenames…' : 'Search by what documents are about…'}
          aria-label="Search documents"
          className="w-full rounded-md border py-2 pl-9 pr-3"
        />
      </div>
      <div className="flex rounded-md border p-0.5 text-sm" role="group" aria-label="Search mode">
        {(['filename', 'meaning'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`rounded px-3 py-1.5 capitalize ${mode === m ? 'bg-neutral-900 text-white' : ''}`}
          >
            {m}
          </button>
        ))}
      </div>
      <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white">
        Search
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Build the dashboard page**

Replace `app/(app)/dashboard/page.tsx`:

```tsx
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { documents, shares } from '@/lib/db/schema';
import { UploadDropzone } from '@/components/upload-dropzone';
import { DocumentCard, type CardDocument } from '@/components/document-card';
import { SearchBar } from '@/components/search-bar';
import { semanticSearch } from '@/lib/ai/search';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; mode?: string }>;
}) {
  const { q, mode } = await searchParams;
  const session = await auth();
  const userId = session!.user.id;

  const shareCount = sql<number>`(
    SELECT count(*)::int FROM ${shares} WHERE ${shares.documentId} = ${documents.id}
      AND ${shares.revokedAt} IS NULL
  )`;

  let docs: CardDocument[];

  if (q && mode === 'meaning') {
    docs = await semanticSearch(userId, q);
  } else {
    docs = await db.select({
      id: documents.id, filename: documents.filename, status: documents.status,
      summary: documents.summary, error: documents.error, pageCount: documents.pageCount,
      sizeBytes: documents.sizeBytes, hasExtractableText: documents.hasExtractableText,
      createdAt: documents.createdAt, updatedAt: documents.updatedAt,
      shareCount,
    })
      .from(documents)
      .where(q
        ? and(eq(documents.ownerId, userId), ilike(documents.filename, `%${q}%`))
        : eq(documents.ownerId, userId))
      .orderBy(desc(documents.createdAt));
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <UploadDropzone />
      <SearchBar />

      {q && (
        <p className="text-sm text-neutral-600">
          {docs.length} result{docs.length === 1 ? '' : 's'} for “{q}”
          {mode === 'meaning' ? ' by meaning' : ' by filename'}
        </p>
      )}

      {docs.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-neutral-500">
          {q ? 'Nothing matched. Try the other search mode.' : 'No documents yet — upload your first PDF above.'}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {docs.map((doc) => <DocumentCard key={doc.id} doc={doc} />)}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 5: Verify by hand**

Run `npm run dev`. Upload two PDFs. Expected: cards show the staged progress labels in sequence, then settle showing real summaries with no page reload. Filename search narrows the grid. Uploading, then reloading mid-processing, still finishes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add dashboard with live document status and filename search"
```

---

## Task 12: Semantic search

**Files:**
- Create: `lib/ai/search.ts`
- Test: `tests/search-ranking.test.ts`

**Interfaces:**
- Consumes: `embedQuery`, `db`, `chunks`, `documents`.
- Produces:
  - `SIMILARITY_FLOOR = 0.35`, `MAX_CHUNK_HITS = 60`
  - `type ChunkHit = { documentId, filename, summary, status, error, pageCount, sizeBytes, hasExtractableText, createdAt, updatedAt, shareCount, idx, content, similarity }`
  - `groupHitsByDocument(hits: ChunkHit[]): CardDocument[]`
  - `snippetFor(content: string, maxChars?: number): string`
  - `semanticSearch(userId: string, query: string): Promise<CardDocument[]>`

- [ ] **Step 1: Write the failing test**

Create `tests/search-ranking.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { groupHitsByDocument, snippetFor, type ChunkHit } from '@/lib/ai/search';

const base = {
  filename: 'Agreement_v3.pdf', summary: 'An employment agreement.', status: 'ready',
  error: null, pageCount: 4, sizeBytes: 1000, hasExtractableText: true,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), shareCount: 0,
};

const hit = (documentId: string, idx: number, similarity: number, content = 'body'): ChunkHit => ({
  ...base, documentId, idx, similarity, content,
});

describe('groupHitsByDocument', () => {
  it('returns nothing for no hits', () => {
    expect(groupHitsByDocument([])).toEqual([]);
  });

  it('collapses many chunks of one document into a single result', () => {
    const result = groupHitsByDocument([hit('d1', 0, 0.8), hit('d1', 5, 0.7), hit('d1', 9, 0.6)]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('d1');
  });

  it('ranks documents by their single best chunk, not by hit count', () => {
    // d2 has one strong match; d1 has three weaker ones. d2 must win.
    const result = groupHitsByDocument([
      hit('d1', 0, 0.50), hit('d1', 1, 0.49), hit('d1', 2, 0.48),
      hit('d2', 0, 0.91),
    ]);
    expect(result.map((r) => r.id)).toEqual(['d2', 'd1']);
  });

  it('carries the snippet from the best-matching chunk', () => {
    const result = groupHitsByDocument([
      hit('d1', 0, 0.40, 'weaker passage about holidays'),
      hit('d1', 7, 0.95, 'termination requires ninety days notice'),
    ]);
    expect(result[0].matchSnippet).toContain('ninety days notice');
  });

  it('preserves document metadata needed by the card', () => {
    const [result] = groupHitsByDocument([hit('d1', 0, 0.8)]);
    expect(result).toMatchObject({
      id: 'd1', filename: 'Agreement_v3.pdf', status: 'ready', pageCount: 4, shareCount: 0,
    });
  });

  it('is stable when two documents tie', () => {
    const result = groupHitsByDocument([hit('dA', 0, 0.7), hit('dB', 0, 0.7)]);
    expect(result).toHaveLength(2);
  });
});

describe('snippetFor', () => {
  it('collapses whitespace', () => {
    expect(snippetFor('a   b\n\nc')).toBe('a b c');
  });

  it('truncates long passages without cutting mid-word', () => {
    const snippet = snippetFor('alpha beta gamma delta epsilon zeta eta theta', 20);
    expect(snippet.length).toBeLessThanOrEqual(20);
    expect(snippet.endsWith(' ')).toBe(false);
    expect(snippet).not.toMatch(/\bgamm$/);
  });

  it('leaves a short passage intact', () => {
    expect(snippetFor('short passage', 100)).toBe('short passage');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/search-ranking.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/search`.

- [ ] **Step 3: Implement**

Create `lib/ai/search.ts`:

```ts
import { and, cosineDistance, desc, eq, gt, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { chunks, documents, shares } from '@/lib/db/schema';
import { embedQuery } from './embed';
import type { CardDocument } from '@/components/document-card';

/** Below this cosine similarity the match is noise, not a result. */
export const SIMILARITY_FLOOR = 0.35;
export const MAX_CHUNK_HITS = 60;

export type ChunkHit = {
  documentId: string;
  filename: string;
  summary: string | null;
  status: string;
  error: string | null;
  pageCount: number | null;
  sizeBytes: number;
  hasExtractableText: boolean | null;
  createdAt: Date;
  updatedAt: Date;
  shareCount: number;
  idx: number;
  content: string;
  similarity: number;
};

export function snippetFor(content: string, maxChars = 180): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxChars) return flat;
  const cut = flat.lastIndexOf(' ', maxChars);
  return flat.slice(0, cut > 0 ? cut : maxChars).trim();
}

/**
 * Chunk hits collapse to documents, each ranked by its single best chunk. Ranking
 * by best chunk rather than by hit count stops a long document from outranking a
 * short, precisely relevant one purely on volume.
 */
export function groupHitsByDocument(hits: ChunkHit[]): CardDocument[] {
  const best = new Map<string, ChunkHit>();

  for (const hit of hits) {
    const existing = best.get(hit.documentId);
    if (!existing || hit.similarity > existing.similarity) best.set(hit.documentId, hit);
  }

  return [...best.values()]
    .sort((a, b) => b.similarity - a.similarity)
    .map((hit) => ({
      id: hit.documentId,
      filename: hit.filename,
      status: hit.status,
      summary: hit.summary,
      error: hit.error,
      pageCount: hit.pageCount,
      sizeBytes: hit.sizeBytes,
      hasExtractableText: hit.hasExtractableText,
      shareCount: hit.shareCount,
      createdAt: hit.createdAt,
      updatedAt: hit.updatedAt,
      matchSnippet: snippetFor(hit.content),
    }));
}

export async function semanticSearch(userId: string, query: string): Promise<CardDocument[]> {
  const vector = await embedQuery(query);
  const similarity = sql<number>`1 - (${cosineDistance(chunks.embedding, vector)})`;

  const shareCount = sql<number>`(
    SELECT count(*)::int FROM ${shares} WHERE ${shares.documentId} = ${documents.id}
      AND ${shares.revokedAt} IS NULL
  )`;

  const hits = await db.select({
    documentId: chunks.documentId, idx: chunks.idx, content: chunks.content, similarity,
    filename: documents.filename, summary: documents.summary, status: documents.status,
    error: documents.error, pageCount: documents.pageCount, sizeBytes: documents.sizeBytes,
    hasExtractableText: documents.hasExtractableText,
    createdAt: documents.createdAt, updatedAt: documents.updatedAt, shareCount,
  })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(and(eq(documents.ownerId, userId), gt(similarity, SIMILARITY_FLOOR)))
    .orderBy(desc(similarity))
    .limit(MAX_CHUNK_HITS);

  return groupHitsByDocument(hits as ChunkHit[]);
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm test -- tests/search-ranking.test.ts`
Expected: 9 passed.

- [ ] **Step 5: Verify the graded example by hand**

Upload a PDF whose *content* is about employment terms but whose *filename* says nothing about it — the spec's `Agreement_v3.pdf` example. Wait for `ready`. Then on the dashboard search `employment contract` with the mode toggle on **meaning**.

Expected: the document appears, with a snippet from the best-matching chunk. Searching the same phrase in **filename** mode returns nothing. That contrast is the feature — demonstrate exactly this pair in the video.

- [ ] **Step 6: Commit**

```bash
git add lib/ai/search.ts tests/search-ranking.test.ts
git commit -m "feat: add embedding-based semantic search ranked by best chunk"
```

---

## Task 13: PDF viewer and summary banner

**Files:**
- Create: `components/pdf-viewer.tsx`, `components/summary-banner.tsx`, `scripts/copy-pdf-worker.mjs`, `app/(app)/d/[id]/page.tsx`
- Modify: `package.json` (postinstall), `next.config.ts`
- Test: manual (canvas rendering is not meaningfully unit-testable)

**Interfaces:**
- Consumes: `requireOwnedDocument`, `createSignedViewUrl`.
- Produces: `<PdfViewer fileUrl={string} />`, `<SummaryBanner document={...} />`, the owner viewer page.

- [ ] **Step 1: Vendor the pdf.js worker**

Create `scripts/copy-pdf-worker.mjs`:

```js
// react-pdf pins an exact pdfjs-dist version, and a worker/API version mismatch
// renders a silently blank page. Copying from node_modules keeps them in lockstep
// and avoids a CDN dependency at runtime.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'));

mkdirSync('public', { recursive: true });
copyFileSync(join(pdfjsRoot, 'build', 'pdf.worker.min.mjs'), join('public', 'pdf.worker.min.mjs'));
console.log('Copied pdf.worker.min.mjs to public/');
```

Add to `package.json` scripts: `"postinstall": "node scripts/copy-pdf-worker.mjs"`.

Run: `node scripts/copy-pdf-worker.mjs`
Expected: `public/pdf.worker.min.mjs` exists.

Add to `.gitignore`: `public/pdf.worker.min.mjs` — it is a build artifact, regenerated on every install including on Vercel.

- [ ] **Step 2: Build the viewer**

Create `components/pdf-viewer.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

export function PdfViewer({ fileUrl }: { fileUrl: string }) {
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b bg-neutral-50 px-3 py-2 text-sm">
        <div className="flex items-center gap-1">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
            aria-label="Previous page" className="rounded p-1 disabled:opacity-40 hover:bg-neutral-200">
            <ChevronLeft className="size-4" />
          </button>
          <span className="tabular-nums">{page} / {numPages || '—'}</span>
          <button onClick={() => setPage((p) => Math.min(numPages, p + 1))} disabled={page >= numPages}
            aria-label="Next page" className="rounded p-1 disabled:opacity-40 hover:bg-neutral-200">
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}
            aria-label="Zoom out" className="rounded p-1 hover:bg-neutral-200">
            <ZoomOut className="size-4" />
          </button>
          <span className="tabular-nums">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => Math.min(2.5, s + 0.2))}
            aria-label="Zoom in" className="rounded p-1 hover:bg-neutral-200">
            <ZoomIn className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-neutral-100 p-4">
        {error ? (
          <p role="alert" className="text-center text-sm text-red-700">{error}</p>
        ) : (
          <Document
            file={fileUrl}
            onLoadSuccess={({ numPages: n }) => { setNumPages(n); setError(null); }}
            onLoadError={(e) => setError(`Could not load this PDF: ${e.message}`)}
            loading={<p className="text-center text-sm text-neutral-500">Loading PDF…</p>}
            className="flex justify-center"
          >
            <Page pageNumber={page} scale={scale}
              className="shadow-md [&>canvas]:max-w-full [&>canvas]:h-auto" />
          </Document>
        )}
      </div>
    </div>
  );
}
```

If the CSS import paths throw at build time, react-pdf moved them; the alternatives are `react-pdf/dist/esm/Page/TextLayer.css` or omitting them (text selection degrades, rendering still works).

- [ ] **Step 3: Build the summary banner**

Create `components/summary-banner.tsx`:

```tsx
import { Sparkles, ScanLine, AlertCircle } from 'lucide-react';

type Props = {
  filename: string;
  status: string;
  summary: string | null;
  error: string | null;
  hasExtractableText: boolean | null;
  pageCount: number | null;
};

export function SummaryBanner({ filename, status, summary, error, hasExtractableText, pageCount }: Props) {
  return (
    <div className="border-b bg-white px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="truncate text-lg font-semibold">{filename}</h1>
        {pageCount ? <span className="text-xs text-neutral-500">{pageCount} pages</span> : null}
      </div>

      {status === 'failed' ? (
        <p className="mt-2 flex items-start gap-2 text-sm text-red-800">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error ?? 'This document could not be processed.'}
        </p>
      ) : hasExtractableText === false ? (
        <p className="mt-2 flex items-start gap-2 text-sm text-amber-800">
          <ScanLine className="mt-0.5 size-4 shrink-0" aria-hidden />
          No extractable text found — this looks like a scanned document, so summary and chat are unavailable.
        </p>
      ) : summary ? (
        <div className="mt-2 flex items-start gap-2">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-neutral-400" aria-hidden />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">AI summary</p>
            <p className="mt-0.5 text-sm leading-relaxed text-neutral-800">{summary}</p>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-neutral-500">Generating summary…</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Build the owner viewer page**

Create `app/(app)/d/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AccessError, requireOwnedDocument } from '@/lib/authz';
import { createSignedViewUrl } from '@/lib/storage';
import { PdfViewer } from '@/components/pdf-viewer';
import { SummaryBanner } from '@/components/summary-banner';

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  let doc;
  try {
    doc = await requireOwnedDocument(id, session!.user.id);
  } catch (error) {
    if (error instanceof AccessError) notFound();
    throw error;
  }

  const fileUrl = await createSignedViewUrl(doc.storagePath);

  return (
    <div className="flex h-[calc(100dvh-3.25rem)] flex-col">
      <SummaryBanner
        filename={doc.filename} status={doc.status} summary={doc.summary}
        error={doc.error} hasExtractableText={doc.hasExtractableText} pageCount={doc.pageCount}
      />
      <div className="min-h-0 flex-1">
        <PdfViewer fileUrl={fileUrl} />
      </div>
    </div>
  );
}
```

Task 14 adds the side panel to this layout; Task 15 adds the Share button.

- [ ] **Step 5: Verify by hand**

Open a ready document from the dashboard. Expected: the summary sits above the PDF, pages render, paging and zoom work, and the browser console is free of worker-version warnings. Then edit the URL to another user's document id → 404.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add PDF viewer with vendored pdf.js worker and summary banner"
```

---

## Task 14: Grounded streaming chat

**Files:**
- Create: `lib/ai/retrieve.ts`, `app/api/chat/route.ts`, `components/chat-panel.tsx`, `components/side-panel.tsx`
- Modify: `app/(app)/d/[id]/page.tsx` (mount the side panel)
- Test: `tests/retrieve.test.ts`

**Interfaces:**
- Consumes: `embedQuery`, `LONG_DOC_TOKEN_THRESHOLD`, `CHAT_SYSTEM`, `chatUser`, `getAi`, `sessionKeyFor`, `assertCanRead`, `resolveShareToken`, `requireOwnedDocument`.
- Produces:
  - `RETRIEVAL_TOP_K = 8`, `MAX_HISTORY_TURNS = 5`
  - `type ChunkRow = { idx: number; content: string; pageStart: number; pageEnd: number }`
  - `type Message = { role: 'user' | 'assistant'; content: string }`
  - `withNeighbours(hitIdxs: number[], all: ChunkRow[]): ChunkRow[]`
  - `formatContext(chunks: ChunkRow[]): string`
  - `trimHistory(messages: Message[], maxTurns?: number): Message[]`
  - `buildChatContext(doc, question): Promise<string>`
  - `POST /api/chat` streaming `text/plain`
  - `<SidePanel chat={ReactNode} comments={ReactNode} />` — a two-tab shell. Task 17 replaces it with `<ViewerLayout pdf chat comments />` in `components/viewer-layout.tsx`, which adds the mobile three-way switcher.

- [ ] **Step 1: Write the failing test**

Create `tests/retrieve.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { withNeighbours, formatContext, trimHistory, type ChunkRow, type Message } from '@/lib/ai/retrieve';

const all: ChunkRow[] = Array.from({ length: 10 }, (_, i) => ({
  idx: i, content: `content ${i}`, pageStart: i + 1, pageEnd: i + 1,
}));

describe('withNeighbours', () => {
  it('returns nothing for no hits', () => {
    expect(withNeighbours([], all)).toEqual([]);
  });

  it('adds the chunk either side of a hit', () => {
    expect(withNeighbours([3], all).map((c) => c.idx)).toEqual([2, 3, 4]);
  });

  it('does not run off the start of the document', () => {
    expect(withNeighbours([0], all).map((c) => c.idx)).toEqual([0, 1]);
  });

  it('does not run off the end of the document', () => {
    expect(withNeighbours([9], all).map((c) => c.idx)).toEqual([8, 9]);
  });

  it('deduplicates when hits are adjacent', () => {
    expect(withNeighbours([3, 4], all).map((c) => c.idx)).toEqual([2, 3, 4, 5]);
  });

  it('deduplicates a repeated hit', () => {
    expect(withNeighbours([5, 5], all).map((c) => c.idx)).toEqual([4, 5, 6]);
  });

  it('emits document order, not relevance order', () => {
    // Hits arrive ranked by similarity; the model must read them in reading order.
    const idxs = withNeighbours([8, 1], all).map((c) => c.idx);
    expect(idxs).toEqual([...idxs].sort((a, b) => a - b));
    expect(idxs).toEqual([0, 1, 2, 7, 8, 9]);
  });

  it('ignores a hit index that is not present', () => {
    expect(withNeighbours([99], all)).toEqual([]);
  });
});

describe('formatContext', () => {
  it('labels each excerpt with its page range so answers can cite pages', () => {
    const context = formatContext([{ idx: 0, content: 'body text', pageStart: 3, pageEnd: 4 }]);
    expect(context).toContain('pages 3-4');
    expect(context).toContain('body text');
  });

  it('uses singular wording for a single-page excerpt', () => {
    expect(formatContext([{ idx: 0, content: 'x', pageStart: 7, pageEnd: 7 }])).toContain('page 7');
  });

  it('separates excerpts so they do not read as continuous prose', () => {
    const context = formatContext([
      { idx: 0, content: 'first', pageStart: 1, pageEnd: 1 },
      { idx: 5, content: 'second', pageStart: 6, pageEnd: 6 },
    ]);
    expect(context.indexOf('first')).toBeLessThan(context.indexOf('second'));
    expect(context).toMatch(/---|\n\n/);
  });
});

describe('trimHistory', () => {
  const turn = (n: number): Message[] => [
    { role: 'user', content: `q${n}` },
    { role: 'assistant', content: `a${n}` },
  ];

  it('returns nothing for an empty history', () => {
    expect(trimHistory([])).toEqual([]);
  });

  it('keeps a short history intact', () => {
    const history = [...turn(1), ...turn(2)];
    expect(trimHistory(history)).toEqual(history);
  });

  it('keeps only the most recent five turns', () => {
    const history = Array.from({ length: 9 }, (_, i) => turn(i + 1)).flat();
    const trimmed = trimHistory(history);
    expect(trimmed).toHaveLength(10);
    expect(trimmed[0].content).toBe('q5');
    expect(trimmed.at(-1)!.content).toBe('a9');
  });

  it('never starts on an assistant message, which Gemini rejects', () => {
    const history: Message[] = [{ role: 'assistant', content: 'orphan' }, ...turn(1)];
    expect(trimHistory(history)[0].role).toBe('user');
  });

  it('honours a custom turn limit', () => {
    const history = Array.from({ length: 5 }, (_, i) => turn(i + 1)).flat();
    expect(trimHistory(history, 2)).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/retrieve.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/retrieve`.

- [ ] **Step 3: Implement retrieval**

Create `lib/ai/retrieve.ts`:

```ts
import { and, cosineDistance, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { chunks } from '@/lib/db/schema';
import { embedQuery } from './embed';
import { LONG_DOC_TOKEN_THRESHOLD } from './summarize';

export const RETRIEVAL_TOP_K = 8;
export const MAX_HISTORY_TURNS = 5;

export type ChunkRow = { idx: number; content: string; pageStart: number; pageEnd: number };
export type Message = { role: 'user' | 'assistant'; content: string };

/**
 * Expands each hit to include its immediate neighbours, then returns the union in
 * document order. Reading order matters: excerpts served in relevance order read
 * as disconnected fragments, while adjacent chunks in document order read as
 * continuous prose.
 */
export function withNeighbours(hitIdxs: number[], all: ChunkRow[]): ChunkRow[] {
  const byIdx = new Map(all.map((c) => [c.idx, c]));
  const wanted = new Set<number>();

  for (const idx of hitIdxs) {
    if (!byIdx.has(idx)) continue;
    wanted.add(idx);
    if (byIdx.has(idx - 1)) wanted.add(idx - 1);
    if (byIdx.has(idx + 1)) wanted.add(idx + 1);
  }

  return [...wanted].sort((a, b) => a - b).map((idx) => byIdx.get(idx)!);
}

export function formatContext(chunkRows: ChunkRow[]): string {
  return chunkRows
    .map((c) => {
      const label = c.pageStart === c.pageEnd ? `page ${c.pageStart}` : `pages ${c.pageStart}-${c.pageEnd}`;
      return `[${label}]\n${c.content}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Keeps the last N turns. A turn is a user message plus its reply, so the slice is
 * 2N messages. Gemini rejects a conversation that opens on a model turn, so a
 * leading assistant message is dropped.
 */
export function trimHistory(messages: Message[], maxTurns = MAX_HISTORY_TURNS): Message[] {
  const trimmed = messages.slice(-maxTurns * 2);
  while (trimmed.length > 0 && trimmed[0].role === 'assistant') trimmed.shift();
  return trimmed;
}

/** Full text below the threshold; retrieval above it. This is the long-document strategy. */
export async function buildChatContext(
  doc: { id: string; fullText: string | null; tokenEstimate: number | null },
  question: string,
): Promise<string> {
  const tokens = doc.tokenEstimate ?? 0;

  if (tokens > 0 && tokens < LONG_DOC_TOKEN_THRESHOLD && doc.fullText) {
    return doc.fullText;
  }

  const vector = await embedQuery(question);
  const similarity = sql<number>`1 - (${cosineDistance(chunks.embedding, vector)})`;

  const hits = await db
    .select({ idx: chunks.idx })
    .from(chunks)
    .where(eq(chunks.documentId, doc.id))
    .orderBy(desc(similarity))
    .limit(RETRIEVAL_TOP_K);

  const all = await db
    .select({ idx: chunks.idx, content: chunks.content, pageStart: chunks.pageStart, pageEnd: chunks.pageEnd })
    .from(chunks)
    .where(eq(chunks.documentId, doc.id));

  const selected = withNeighbours(hits.map((h) => h.idx), all);
  return formatContext(selected);
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm test -- tests/retrieve.test.ts`
Expected: 16 passed.

- [ ] **Step 5: Implement the streaming chat route**

Create `app/api/chat/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { chatMessages, documents } from '@/lib/db/schema';
import {
  AccessError, assertCanRead, requireOwnedDocument, resolveShareToken, sessionKeyFor, type Viewer,
} from '@/lib/authz';
import { getAi, CHAT_MODEL } from '@/lib/ai/gemini';
import { CHAT_SYSTEM, chatUser } from '@/lib/ai/prompts';
import { buildChatContext, trimHistory, type Message } from '@/lib/ai/retrieve';
import { chatSchema } from '@/lib/validation';
import { toErrorResponse } from '@/lib/api-error';

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const parsed = chatSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    const { documentId, question, shareToken } = parsed.data;

    // Resolve the viewer: a guest token, or an authenticated owner.
    let viewer: Viewer;
    let doc;
    if (shareToken) {
      const resolved = await resolveShareToken(shareToken);
      if (!resolved || resolved.document.id !== documentId) throw new AccessError(404, 'Not found');
      viewer = resolved.viewer;
      doc = resolved.document;
    } else {
      const session = await auth();
      if (!session?.user?.id) throw new AccessError(404, 'Not found');
      viewer = { kind: 'owner', userId: session.user.id };
      doc = await requireOwnedDocument(documentId, session.user.id);
    }
    assertCanRead(viewer, doc);

    if (doc.hasExtractableText === false) {
      return NextResponse.json(
        { error: 'This document has no extractable text, so it cannot be queried.' },
        { status: 400 },
      );
    }
    if (doc.status !== 'ready') {
      return NextResponse.json({ error: 'This document is still being processed.' }, { status: 409 });
    }

    const sessionKey = sessionKeyFor(viewer);

    const priorRows = await db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.sessionKey, sessionKey))
      .orderBy(asc(chatMessages.createdAt));

    const history = trimHistory(priorRows as Message[]);
    const context = await buildChatContext(doc, question);

    await db.insert(chatMessages).values({
      documentId, sessionKey, role: 'user', content: question,
    });

    // Gemini calls the assistant role "model".
    const contents = [
      ...history.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      { role: 'user', parts: [{ text: chatUser(context, question) }] },
    ];

    const geminiStream = await getAi().models.generateContentStream({
      model: CHAT_MODEL,
      contents,
      config: { systemInstruction: CHAT_SYSTEM, temperature: 0.2, maxOutputTokens: 1200 },
    });

    let answer = '';
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of geminiStream) {
            const text = chunk.text ?? '';
            if (!text) continue;
            answer += text;
            controller.enqueue(encoder.encode(text));
          }
        } catch (error) {
          console.error('chat stream failed', error);
          if (!answer) {
            controller.enqueue(encoder.encode('\n\n[The answer stream failed. Please try again.]'));
          }
        } finally {
          controller.close();
          // Persist only a completed answer; a broken stream leaves no half-turn
          // in the history to confuse the next question.
          if (answer.trim()) {
            await db.insert(chatMessages).values({
              documentId, sessionKey, role: 'assistant', content: answer,
            }).catch((e) => console.error('failed to persist answer', e));
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
```

Add a `GET` handler to the same file so the panel can load prior turns:

```ts
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const documentId = url.searchParams.get('documentId') ?? '';
    const shareToken = url.searchParams.get('shareToken') ?? undefined;

    let viewer: Viewer;
    let doc;
    if (shareToken) {
      const resolved = await resolveShareToken(shareToken);
      if (!resolved || resolved.document.id !== documentId) throw new AccessError(404, 'Not found');
      viewer = resolved.viewer;
      doc = resolved.document;
    } else {
      const session = await auth();
      if (!session?.user?.id) throw new AccessError(404, 'Not found');
      viewer = { kind: 'owner', userId: session.user.id };
      doc = await requireOwnedDocument(documentId, session.user.id);
    }
    assertCanRead(viewer, doc);

    const rows = await db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.sessionKey, sessionKeyFor(viewer)))
      .orderBy(asc(chatMessages.createdAt));

    return NextResponse.json({ messages: rows });
  } catch (error) {
    return toErrorResponse(error);
  }
}
```

- [ ] **Step 6: Build the chat panel**

Create `components/chat-panel.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { SendHorizontal } from 'lucide-react';

type Msg = { role: 'user' | 'assistant'; content: string };

export function ChatPanel({
  documentId, shareToken, enabled, disabledReason,
}: {
  documentId: string;
  shareToken?: string;
  enabled: boolean;
  disabledReason?: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const params = new URLSearchParams({ documentId });
    if (shareToken) params.set('shareToken', shareToken);
    fetch(`/api/chat?${params}`)
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d) => setMessages(d.messages ?? []))
      .catch(() => {});
  }, [documentId, shareToken, enabled]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || streaming) return;

    setInput('');
    setError(null);
    setMessages((m) => [...m, { role: 'user', content: question }, { role: 'assistant', content: '' }]);
    setStreaming(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentId, question, shareToken }),
      });

      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error ?? 'The request failed.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      // Append each decoded chunk to the trailing assistant message as it arrives.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        setMessages((m) => {
          const next = [...m];
          next[next.length - 1] = {
            role: 'assistant',
            content: next[next.length - 1].content + text,
          };
          return next;
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setMessages((m) => m.filter((msg, i) => !(i === m.length - 1 && msg.content === '')));
    } finally {
      setStreaming(false);
    }
  }

  if (!enabled) {
    return (
      <p className="p-4 text-sm text-neutral-500">
        {disabledReason ?? 'Chat is unavailable for this document.'}
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="text-sm text-neutral-500">
            <p className="font-medium text-neutral-700">Ask about this document</p>
            <p className="mt-1">Answers cite page numbers and stay grounded in the text.</p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <div className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
              m.role === 'user' ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-900'
            }`}>
              {m.content || (streaming ? '…' : '')}
            </div>
          </div>
        ))}

        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="flex items-end gap-2 border-t p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(e); }
          }}
          rows={2}
          placeholder="Ask a question…"
          aria-label="Ask a question about this document"
          className="flex-1 resize-none rounded-md border px-3 py-2 text-sm"
        />
        <button type="submit" disabled={streaming || !input.trim()}
          aria-label="Send question"
          className="rounded-md bg-neutral-900 p-2 text-white disabled:opacity-40">
          <SendHorizontal className="size-4" />
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 7: Build the responsive side panel and mount it**

Create `components/side-panel.tsx`:

```tsx
'use client';

import { useState, type ReactNode } from 'react';

export function SidePanel({ chat, comments }: { chat: ReactNode; comments: ReactNode }) {
  const [tab, setTab] = useState<'comments' | 'chat'>('chat');

  return (
    <div className="flex h-full flex-col border-l">
      <div className="flex border-b" role="tablist">
        {(['chat', 'comments'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`flex-1 px-4 py-2.5 text-sm capitalize ${
              tab === t ? 'border-b-2 border-neutral-900 font-medium' : 'text-neutral-500'
            }`}
          >
            {t === 'chat' ? 'AI chat' : 'Comments'}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">{tab === 'chat' ? chat : comments}</div>
    </div>
  );
}
```

Update `app/(app)/d/[id]/page.tsx` to place the viewer and panel side by side:

```tsx
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="min-h-0 flex-1 lg:w-3/5">
          <PdfViewer fileUrl={fileUrl} />
        </div>
        <div className="h-96 shrink-0 lg:h-auto lg:w-2/5">
          <SidePanel
            chat={
              <ChatPanel
                documentId={doc.id}
                enabled={doc.status === 'ready' && doc.hasExtractableText !== false}
                disabledReason={
                  doc.hasExtractableText === false
                    ? 'This document has no extractable text, so chat is unavailable.'
                    : 'Chat becomes available once processing finishes.'
                }
              />
            }
            comments={<p className="p-4 text-sm text-neutral-500">Comments arrive in Task 16.</p>}
          />
        </div>
      </div>
```

- [ ] **Step 8: Verify grounding by hand — this is the graded behaviour**

With a ready document open, ask in order:

1. A question the document answers → expect a correct answer **with a page citation**.
2. A follow-up using a pronoun ("who does *it* apply to?") → expect it resolved from turn 1, proving history works.
3. Something the document plainly does not cover ("what is the CEO's salary?" on a technical manual) → expect an explicit "the excerpts don't cover…", **not** a confident invention. If it invents an answer, the fix is the prompt in `lib/ai/prompts.ts`, not the retrieval code.
4. Six or more turns, then reference turn 1 → the model should have lost it (only 5 turns are retained). Confirms trimming is live.
5. Confirm text streams in progressively rather than appearing all at once.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add grounded streaming chat with threshold-based context retrieval"
```

---

## Task 15: Sharing with per-invitee tokens

**Files:**
- Create: `lib/email.ts`, `app/(app)/d/[id]/share-actions.ts`, `components/share-dialog.tsx`, `app/s/[token]/page.tsx`, `app/s/[token]/not-found.tsx`
- Modify: `app/(app)/d/[id]/page.tsx` (Share button)
- Test: `tests/share-token.test.ts`

**Interfaces:**
- Consumes: `requireOwnedDocument`, `resolveShareToken`, `shareSchema`, `createSignedViewUrl`.
- Produces: `generateShareToken(): string`, `shareUrlFor(token: string): string`, `createShare(documentId, input)`, `revokeShare(shareId, documentId)`, `listShares(documentId)`, `sendShareEmail({...})`, the guest page at `/s/[token]`.

- [ ] **Step 1: Write the failing test**

Create `tests/share-token.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateShareToken, shareUrlFor } from '@/lib/share-token';

describe('generateShareToken', () => {
  it('is URL-safe', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateShareToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('carries at least 32 bytes of entropy', () => {
    // 32 bytes base64url-encoded is 43 characters.
    expect(generateShareToken().length).toBeGreaterThanOrEqual(43);
  });

  it('never repeats across many draws', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generateShareToken()));
    expect(seen.size).toBe(1000);
  });
});

describe('shareUrlFor', () => {
  it('builds an absolute link from the configured app URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.com';
    expect(shareUrlFor('abc')).toBe('https://example.com/s/abc');
  });

  it('tolerates a trailing slash in the configured URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.com/';
    expect(shareUrlFor('abc')).toBe('https://example.com/s/abc');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/share-token.test.ts`
Expected: FAIL — cannot resolve `@/lib/share-token`.

- [ ] **Step 3: Implement token generation**

Create `lib/share-token.ts`:

```ts
import { randomBytes } from 'node:crypto';

/**
 * 32 random bytes, base64url encoded. The token IS the credential for a guest,
 * so it must be long enough that guessing is hopeless and safe to paste in a URL.
 */
export function generateShareToken(): string {
  return randomBytes(32).toString('base64url');
}

export function shareUrlFor(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/s/${token}`;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm test -- tests/share-token.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Implement the email sender**

Create `lib/email.ts`:

```ts
import { Resend } from 'resend';

/**
 * Email is a good-to-have: a failure here must never fail the share itself.
 * Every path returns a boolean rather than throwing.
 */
export async function sendShareEmail(input: {
  to: string;
  inviteeName: string;
  ownerName: string;
  filename: string;
  url: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('RESEND_API_KEY not set; skipping share email');
    return false;
  }

  try {
    await new Resend(apiKey).emails.send({
      // Resend's sandbox sender works without domain verification.
      from: 'PDF Intelligence <onboarding@resend.dev>',
      to: input.to,
      subject: `${input.ownerName} shared "${input.filename}" with you`,
      text: [
        `Hi ${input.inviteeName},`,
        '',
        `${input.ownerName} shared a PDF with you: ${input.filename}`,
        '',
        `View it here (no account needed): ${input.url}`,
        '',
        'You can read the document, see its AI summary, ask questions about it, and leave comments.',
      ].join('\n'),
    });
    return true;
  } catch (error) {
    console.error('share email failed', error);
    return false;
  }
}
```

- [ ] **Step 6: Implement the share server actions**

Create `app/(app)/d/[id]/share-actions.ts`:

```ts
'use server';

import { and, desc, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { shares } from '@/lib/db/schema';
import { requireOwnedDocument } from '@/lib/authz';
import { generateShareToken, shareUrlFor } from '@/lib/share-token';
import { sendShareEmail } from '@/lib/email';
import { shareSchema } from '@/lib/validation';
import { normalizeEmail } from '@/lib/auth';

export async function createShare(documentId: string, raw: unknown) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Not signed in');
  const doc = await requireOwnedDocument(documentId, session.user.id);

  const parsed = shareSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const token = generateShareToken();
  await db.insert(shares).values({
    documentId,
    token,
    inviteeEmail: normalizeEmail(parsed.data.inviteeEmail),
    inviteeName: parsed.data.inviteeName,
    canComment: parsed.data.canComment,
  });

  const url = shareUrlFor(token);
  const emailed = await sendShareEmail({
    to: parsed.data.inviteeEmail,
    inviteeName: parsed.data.inviteeName,
    ownerName: session.user.name ?? 'Someone',
    filename: doc.filename,
    url,
  });

  revalidatePath(`/d/${documentId}`);
  return { url, emailed };
}

export async function revokeShare(shareId: string, documentId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Not signed in');
  await requireOwnedDocument(documentId, session.user.id);

  await db.update(shares)
    .set({ revokedAt: new Date() })
    .where(and(eq(shares.id, shareId), eq(shares.documentId, documentId)));

  revalidatePath(`/d/${documentId}`);
}

export async function listShares(documentId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Not signed in');
  await requireOwnedDocument(documentId, session.user.id);

  const rows = await db.select().from(shares)
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
```

- [ ] **Step 7: Build the share dialog**

Create `components/share-dialog.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Check, Copy, Share2, X } from 'lucide-react';
import { createShare, revokeShare, listShares } from '@/app/(app)/d/[id]/share-actions';

type ShareRow = Awaited<ReturnType<typeof listShares>>[number];

export function ShareDialog({ documentId, initialShares }: { documentId: string; initialShares: ShareRow[] }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(initialShares);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [canComment, setCanComment] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await createShare(documentId, { inviteeEmail: email, inviteeName: name, canComment });
      if ('error' in result && result.error) { setError(result.error); return; }
      setLastUrl(result.url!);
      setRows(await listShares(documentId));
      setEmail(''); setName('');
    } catch {
      setError('Could not create the share link.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-neutral-50">
        <Share2 className="size-4" aria-hidden /> Share
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)} role="presentation">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Share this PDF">
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-semibold">Share this PDF</h2>
              <button onClick={() => setOpen(false)} aria-label="Close"><X className="size-4" /></button>
            </div>
            <p className="mt-1 text-sm text-neutral-600">
              The invitee gets a private link. They do not need an account.
            </p>

            <form onSubmit={submit} className="mt-4 space-y-3">
              <input value={name} onChange={(e) => setName(e.target.value)} required
                placeholder="Their name" aria-label="Invitee name"
                className="w-full rounded-md border px-3 py-2 text-sm" />
              <input value={email} onChange={(e) => setEmail(e.target.value)} required type="email"
                placeholder="their@email.com" aria-label="Invitee email"
                className="w-full rounded-md border px-3 py-2 text-sm" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={canComment} onChange={(e) => setCanComment(e.target.checked)} />
                Allow them to comment
              </label>
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
              <button type="submit" disabled={busy}
                className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50">
                {busy ? 'Creating…' : 'Create link and email it'}
              </button>
            </form>

            {lastUrl && (
              <div className="mt-3 flex items-center gap-2 rounded-md bg-green-50 p-2">
                <input readOnly value={lastUrl} aria-label="Share link"
                  className="min-w-0 flex-1 bg-transparent text-xs" />
                <button onClick={() => copy(lastUrl)} aria-label="Copy link">
                  {copied === lastUrl ? <Check className="size-4" /> : <Copy className="size-4" />}
                </button>
              </div>
            )}

            {rows.length > 0 && (
              <div className="mt-4 border-t pt-3">
                <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  Shared with
                </h3>
                <ul className="mt-2 space-y-2">
                  {rows.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate">{s.inviteeName}</p>
                        <p className="truncate text-xs text-neutral-500">
                          {s.inviteeEmail}
                          {s.lastViewedAt ? ` · viewed ${new Date(s.lastViewedAt).toLocaleDateString()}` : ' · not opened yet'}
                          {!s.canComment ? ' · read only' : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button onClick={() => copy(s.url)} aria-label={`Copy link for ${s.inviteeName}`}>
                          {copied === s.url ? <Check className="size-4" /> : <Copy className="size-4" />}
                        </button>
                        <button
                          onClick={async () => { await revokeShare(s.id, documentId); setRows(await listShares(documentId)); }}
                          className="text-xs text-red-700 underline"
                        >
                          Revoke
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 8: Build the guest page**

Create `app/s/[token]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { shares } from '@/lib/db/schema';
import { resolveShareToken } from '@/lib/authz';
import { createSignedViewUrl } from '@/lib/storage';
import { PdfViewer } from '@/components/pdf-viewer';
import { SummaryBanner } from '@/components/summary-banner';
import { SidePanel } from '@/components/side-panel';
import { ChatPanel } from '@/components/chat-panel';

export default async function SharedDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const resolved = await resolveShareToken(token);
  if (!resolved) notFound(); // unknown or revoked — identical response either way

  const { document: doc, share } = resolved;

  // Fire and forget: a failed timestamp update must not block the page.
  void db.update(shares).set({ lastViewedAt: new Date() })
    .where(eq(shares.id, share.id)).catch(() => {});

  const fileUrl = await createSignedViewUrl(doc.storagePath);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="font-semibold">PDF Intelligence</span>
        <span className="text-sm text-neutral-500">Shared with {share.inviteeName}</span>
      </header>

      <SummaryBanner
        filename={doc.filename} status={doc.status} summary={doc.summary}
        error={doc.error} hasExtractableText={doc.hasExtractableText} pageCount={doc.pageCount}
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="min-h-0 flex-1 lg:w-3/5">
          <PdfViewer fileUrl={fileUrl} />
        </div>
        <div className="h-96 shrink-0 lg:h-auto lg:w-2/5">
          <SidePanel
            chat={
              <ChatPanel
                documentId={doc.id}
                shareToken={token}
                enabled={doc.status === 'ready' && doc.hasExtractableText !== false}
                disabledReason="Chat is unavailable for this document."
              />
            }
            comments={<p className="p-4 text-sm text-neutral-500">Comments arrive in Task 16.</p>}
          />
        </div>
      </div>
    </div>
  );
}
```

Create `app/s/[token]/not-found.tsx`:

```tsx
export default function ShareNotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-xl font-semibold">This link is not available</h1>
        <p className="mt-2 text-sm text-neutral-600">
          It may have been revoked, or the address may be incorrect.
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 9: Add the Share button to the owner viewer**

In `app/(app)/d/[id]/page.tsx`, load shares and render the dialog in the banner row:

```tsx
import { ShareDialog } from '@/components/share-dialog';
import { listShares } from './share-actions';

// inside the component, after loading doc:
const shareRows = await listShares(doc.id);

// then in the JSX, directly above <SummaryBanner />:
<div className="flex items-center justify-end border-b px-4 py-2">
  <ShareDialog documentId={doc.id} initialShares={shareRows} />
</div>
```

- [ ] **Step 10: Verify by hand**

1. Open a ready document → Share → enter your own email and a name → Create.
2. Confirm the link appears and is copyable. Check the inbox for the email (if `RESEND_API_KEY` is set; the share must still succeed if it is not).
3. Open the link in a **private window** (no session) → the PDF, summary, and chat all work.
4. Ask a question as the guest → grounded answer streams. In Supabase, confirm the guest's `chat_messages` rows carry `session_key = 'share:<id>'` while yours carry `user:<id>`.
5. Revoke the share → reload the guest window → the "not available" page.
6. Change one character of a valid token → same "not available" page.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: add per-invitee share tokens with email delivery and guest viewer"
```

---

## Task 16: Threaded comments with formatting

**Files:**
- Create: `lib/comments.ts`, `components/markdown.tsx`, `app/(app)/d/[id]/comment-actions.ts`, `components/comment-list.tsx`, `components/comment-composer.tsx`, `components/comments-panel.tsx`
- Modify: `app/(app)/d/[id]/page.tsx`, `app/s/[token]/page.tsx` (replace the comments placeholder)
- Test: `tests/comments-tree.test.ts`

**Interfaces:**
- Consumes: `assertCanComment`, `assertCanRead`, `resolveShareToken`, `requireOwnedDocument`, `commentSchema`.
- Produces:
  - `type CommentRow = { id, parentId, body, authorLabel, isOwner, createdAt }`
  - `type CommentNode = CommentRow & { replies: CommentRow[] }`
  - `buildCommentTree(rows: CommentRow[]): CommentNode[]`
  - `addComment(documentId, raw, shareToken?)`, `listComments(documentId, shareToken?)`
  - `<Markdown>{body}</Markdown>`, `<CommentsPanel ... />`

- [ ] **Step 1: Write the failing test**

Create `tests/comments-tree.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildCommentTree, type CommentRow } from '@/lib/comments';

const row = (id: string, parentId: string | null, minutes: number): CommentRow => ({
  id, parentId, body: `body ${id}`, authorLabel: 'A', isOwner: false,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, minutes)),
});

describe('buildCommentTree', () => {
  it('returns nothing for no comments', () => {
    expect(buildCommentTree([])).toEqual([]);
  });

  it('keeps top-level comments in chronological order', () => {
    const tree = buildCommentTree([row('b', null, 5), row('a', null, 1)]);
    expect(tree.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('nests a reply under its parent', () => {
    const tree = buildCommentTree([row('a', null, 1), row('r', 'a', 2)]);
    expect(tree).toHaveLength(1);
    expect(tree[0].replies.map((c) => c.id)).toEqual(['r']);
  });

  it('orders replies chronologically', () => {
    const tree = buildCommentTree([row('a', null, 1), row('r2', 'a', 9), row('r1', 'a', 3)]);
    expect(tree[0].replies.map((c) => c.id)).toEqual(['r1', 'r2']);
  });

  it('gives every top-level comment a replies array, even when empty', () => {
    expect(buildCommentTree([row('a', null, 1)])[0].replies).toEqual([]);
  });

  it('flattens a reply-to-a-reply onto the same thread, enforcing one level', () => {
    // The UI only offers Reply on top-level comments, but a crafted request
    // must not produce unbounded nesting.
    const tree = buildCommentTree([row('a', null, 1), row('r', 'a', 2), row('rr', 'r', 3)]);
    expect(tree).toHaveLength(1);
    expect(tree[0].replies.map((c) => c.id)).toEqual(['r', 'rr']);
  });

  it('promotes an orphaned reply to top level rather than dropping it', () => {
    const tree = buildCommentTree([row('orphan', 'missing-id', 1)]);
    expect(tree.map((c) => c.id)).toEqual(['orphan']);
  });

  it('handles many threads without cross-contamination', () => {
    const tree = buildCommentTree([
      row('a', null, 1), row('b', null, 2), row('ra', 'a', 3), row('rb', 'b', 4),
    ]);
    expect(tree.find((c) => c.id === 'a')!.replies.map((r) => r.id)).toEqual(['ra']);
    expect(tree.find((c) => c.id === 'b')!.replies.map((r) => r.id)).toEqual(['rb']);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/comments-tree.test.ts`
Expected: FAIL — cannot resolve `@/lib/comments`.

- [ ] **Step 3: Implement the tree builder**

Create `lib/comments.ts`:

```ts
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
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm test -- tests/comments-tree.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Build the locked-down markdown renderer**

Create `components/markdown.tsx`:

```tsx
import ReactMarkdown from 'react-markdown';

/**
 * Comment bodies are guest-writable, so this is a security boundary. react-markdown
 * does not render raw HTML unless rehype-raw is added — it is deliberately absent.
 * allowedElements further restricts output to the formatting the composer offers.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-sm space-y-1 [&_li]:ml-4 [&_li]:list-disc [&_strong]:font-semibold [&_em]:italic">
      <ReactMarkdown
        allowedElements={['p', 'strong', 'em', 'ul', 'ol', 'li', 'br', 'code']}
        unwrapDisallowed
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 6: Implement comment server actions**

Create `app/(app)/d/[id]/comment-actions.ts`:

```ts
'use server';

import { asc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { comments, users } from '@/lib/db/schema';
import {
  AccessError, assertCanComment, assertCanRead, requireOwnedDocument, resolveShareToken, type Viewer,
} from '@/lib/authz';
import { commentSchema } from '@/lib/validation';
import { buildCommentTree, type CommentRow } from '@/lib/comments';

/** Resolves the caller to a Viewer plus the document, for either entry point. */
async function resolveViewer(documentId: string, shareToken?: string) {
  if (shareToken) {
    const resolved = await resolveShareToken(shareToken);
    if (!resolved || resolved.document.id !== documentId) throw new AccessError(404, 'Not found');
    return { viewer: resolved.viewer, doc: resolved.document, share: resolved.share };
  }

  const session = await auth();
  if (!session?.user?.id) throw new AccessError(404, 'Not found');
  const doc = await requireOwnedDocument(documentId, session.user.id);
  const viewer: Viewer = { kind: 'owner', userId: session.user.id };
  return { viewer, doc, share: null, userName: session.user.name };
}

export async function listComments(documentId: string, shareToken?: string) {
  const { viewer, doc } = await resolveViewer(documentId, shareToken);
  assertCanRead(viewer, doc);

  const rows = await db.select({
    id: comments.id, parentId: comments.parentId, body: comments.body,
    authorLabel: comments.authorLabel, authorUserId: comments.authorUserId,
    createdAt: comments.createdAt,
  })
    .from(comments)
    .where(eq(comments.documentId, documentId))
    .orderBy(asc(comments.createdAt));

  const shaped: CommentRow[] = rows.map((r) => ({
    id: r.id, parentId: r.parentId, body: r.body,
    authorLabel: r.authorLabel, isOwner: r.authorUserId !== null, createdAt: r.createdAt,
  }));

  return buildCommentTree(shaped);
}

export async function addComment(documentId: string, raw: unknown, shareToken?: string) {
  const resolved = await resolveViewer(documentId, shareToken);
  const { viewer, doc, share } = resolved;
  assertCanComment(viewer, doc);

  const parsed = commentSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // The author label is denormalized at write time so a revoked share still
  // shows who wrote a comment.
  let authorLabel: string;
  if (viewer.kind === 'guest') {
    authorLabel = share!.inviteeName;
  } else {
    const [user] = await db.select({ name: users.name }).from(users)
      .where(eq(users.id, viewer.userId)).limit(1);
    authorLabel = user?.name ?? 'Owner';
  }

  await db.insert(comments).values({
    documentId,
    parentId: parsed.data.parentId ?? null,
    body: parsed.data.body,
    authorUserId: viewer.kind === 'owner' ? viewer.userId : null,
    authorShareId: viewer.kind === 'guest' ? viewer.shareId : null,
    authorLabel,
  });

  revalidatePath(`/d/${documentId}`);
  return { ok: true };
}
```

- [ ] **Step 7: Build the composer**

Create `components/comment-composer.tsx`:

```tsx
'use client';

import { useRef, useState } from 'react';
import { Bold, Italic, List } from 'lucide-react';

export function CommentComposer({
  onSubmit, placeholder = 'Add a comment…', compact = false,
}: {
  onSubmit: (body: string) => Promise<string | null>;
  placeholder?: string;
  compact?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Wraps the selection, or inserts a marker at the caret when nothing is selected. */
  function wrap(before: string, after = before) {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const selected = body.slice(start, end);
    const next = body.slice(0, start) + before + selected + after + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  function bulletList() {
    const el = ref.current;
    if (!el) return;
    const start = body.lastIndexOf('\n', Math.max(0, el.selectionStart - 1)) + 1;
    setBody(body.slice(0, start) + '- ' + body.slice(start));
    requestAnimationFrame(() => el.focus());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    const failure = await onSubmit(trimmed);
    if (failure) setError(failure);
    else setBody('');
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-1" role="group" aria-label="Formatting">
        <button type="button" onClick={() => wrap('**')} aria-label="Bold"
          className="rounded p-1.5 hover:bg-neutral-100"><Bold className="size-3.5" /></button>
        <button type="button" onClick={() => wrap('*')} aria-label="Italic"
          className="rounded p-1.5 hover:bg-neutral-100"><Italic className="size-3.5" /></button>
        <button type="button" onClick={bulletList} aria-label="Bullet list"
          className="rounded p-1.5 hover:bg-neutral-100"><List className="size-3.5" /></button>
      </div>

      <textarea
        ref={ref} value={body} onChange={(e) => setBody(e.target.value)}
        rows={compact ? 2 : 3} placeholder={placeholder} aria-label={placeholder}
        className="w-full resize-none rounded-md border px-3 py-2 text-sm"
      />

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      <button type="submit" disabled={busy || !body.trim()}
        className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
        {busy ? 'Posting…' : 'Post'}
      </button>
    </form>
  );
}
```

- [ ] **Step 8: Build the comments panel**

Create `components/comments-panel.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Markdown } from '@/components/markdown';
import { CommentComposer } from '@/components/comment-composer';
import { addComment, listComments } from '@/app/(app)/d/[id]/comment-actions';
import type { CommentNode, CommentRow } from '@/lib/comments';

export function CommentsPanel({
  documentId, shareToken, canComment, initial,
}: {
  documentId: string;
  shareToken?: string;
  canComment: boolean;
  initial: CommentNode[];
}) {
  const [tree, setTree] = useState(initial);
  const [replyTo, setReplyTo] = useState<string | null>(null);

  useEffect(() => setTree(initial), [initial]);

  async function post(body: string, parentId: string | null) {
    const result = await addComment(documentId, { body, parentId }, shareToken);
    if (result && 'error' in result && result.error) return result.error;
    setTree(await listComments(documentId, shareToken));
    setReplyTo(null);
    return null;
  }

  const meta = (c: CommentRow) => (
    <p className="text-xs text-neutral-500">
      <span className="font-medium text-neutral-700">{c.authorLabel}</span>
      {c.isOwner ? ' · owner' : ''} · {new Date(c.createdAt).toLocaleString()}
    </p>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {tree.length === 0 && (
          <p className="text-sm text-neutral-500">No comments yet.</p>
        )}

        {tree.map((c) => (
          <div key={c.id} className="space-y-2">
            <div>
              {meta(c)}
              <div className="mt-1 text-sm"><Markdown>{c.body}</Markdown></div>
              {canComment && (
                <button onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}
                  className="mt-1 text-xs text-neutral-600 underline">
                  {replyTo === c.id ? 'Cancel' : 'Reply'}
                </button>
              )}
            </div>

            {c.replies.length > 0 && (
              <div className="space-y-3 border-l-2 border-neutral-200 pl-3">
                {c.replies.map((r) => (
                  <div key={r.id}>
                    {meta(r)}
                    <div className="mt-1 text-sm"><Markdown>{r.body}</Markdown></div>
                  </div>
                ))}
              </div>
            )}

            {replyTo === c.id && (
              <div className="border-l-2 border-neutral-200 pl-3">
                <CommentComposer compact placeholder="Write a reply…"
                  onSubmit={(body) => post(body, c.id)} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="border-t p-3">
        {canComment ? (
          <CommentComposer onSubmit={(body) => post(body, null)} />
        ) : (
          <p className="text-sm text-neutral-500">This link is read-only.</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Mount it in both viewers**

In `app/(app)/d/[id]/page.tsx`, load comments and replace the placeholder:

```tsx
import { listComments } from './comment-actions';
import { CommentsPanel } from '@/components/comments-panel';

// after loading doc:
const commentTree = await listComments(doc.id);

// replace the comments prop:
comments={<CommentsPanel documentId={doc.id} canComment initial={commentTree} />}
```

In `app/s/[token]/page.tsx`, do the same with the token and the share's permission:

```tsx
const commentTree = await listComments(doc.id, token);

comments={
  <CommentsPanel
    documentId={doc.id}
    shareToken={token}
    canComment={share.canComment}
    initial={commentTree}
  />
}
```

- [ ] **Step 10: Verify by hand**

1. As owner, post a comment using **bold**, *italic*, and a bullet list → renders formatted.
2. Post `<img src=x onerror="alert(1)">` as a comment → it renders as visible text, no alert, no element in the DOM. This is the XSS check.
3. Open the guest link in a private window → the owner's comment is visible; post a reply as the guest.
4. Back as owner, reload → the guest's reply appears nested, labelled with the invitee's name.
5. Create a second share with **Allow them to comment** unchecked → that guest sees "This link is read-only" and no Reply buttons.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: add threaded comments with markdown formatting for owners and guests"
```

---

## Task 17: Responsive layout and error boundaries

**Files:**
- Create: `components/viewer-layout.tsx`
- Delete: `components/side-panel.tsx` (superseded — the exported component is renamed, so the file is renamed with it)
- Modify: `app/layout.tsx`, `app/(app)/d/[id]/page.tsx`, `app/s/[token]/page.tsx`, `components/summary-banner.tsx`
- Create: `app/error.tsx`, `app/not-found.tsx`, `app/(app)/dashboard/loading.tsx`
- Test: manual, at three viewport widths

**Interfaces:**
- Consumes: everything built so far.
- Produces: a mobile layout with a bottom tab bar switching PDF / Comments / Chat; app-wide error and 404 pages.

- [ ] **Step 1: Make the side panel a three-way mobile switcher**

Create `components/viewer-layout.tsx` and delete `components/side-panel.tsx`:

```tsx
'use client';

import { useState, type ReactNode } from 'react';
import { FileText, MessageSquare, Sparkles } from 'lucide-react';

type Tab = 'pdf' | 'comments' | 'chat';

export function ViewerLayout({ pdf, chat, comments }: { pdf: ReactNode; chat: ReactNode; comments: ReactNode }) {
  const [mobileTab, setMobileTab] = useState<Tab>('pdf');
  const [desktopTab, setDesktopTab] = useState<Exclude<Tab, 'pdf'>>('chat');

  return (
    <>
      {/* Desktop: PDF beside a tabbed panel. */}
      <div className="hidden min-h-0 flex-1 lg:flex">
        <div className="min-h-0 w-3/5">{pdf}</div>
        <div className="flex min-h-0 w-2/5 flex-col border-l">
          <div className="flex border-b" role="tablist">
            {(['chat', 'comments'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={desktopTab === t}
                onClick={() => setDesktopTab(t)}
                className={`flex-1 px-4 py-2.5 text-sm ${
                  desktopTab === t ? 'border-b-2 border-neutral-900 font-medium' : 'text-neutral-500'
                }`}>
                {t === 'chat' ? 'AI chat' : 'Comments'}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">{desktopTab === 'chat' ? chat : comments}</div>
        </div>
      </div>

      {/* Mobile: one pane at a time, chosen from a bottom bar. */}
      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        <div className="min-h-0 flex-1">
          {mobileTab === 'pdf' ? pdf : mobileTab === 'chat' ? chat : comments}
        </div>
        <nav className="flex border-t" aria-label="View">
          {([
            ['pdf', 'PDF', FileText],
            ['comments', 'Comments', MessageSquare],
            ['chat', 'AI chat', Sparkles],
          ] as const).map(([key, label, Icon]) => (
            <button key={key} onClick={() => setMobileTab(key)} aria-current={mobileTab === key}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
                mobileTab === key ? 'font-medium text-neutral-900' : 'text-neutral-500'
              }`}>
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}
```

Update both viewer pages to import `ViewerLayout` from `@/components/viewer-layout` and use `<ViewerLayout pdf={<PdfViewer fileUrl={fileUrl} />} chat={…} comments={…} />` in place of the previous two-column markup. Remove the `SidePanel` import and the wrapping `<div className="flex min-h-0 flex-1 …">` columns from both pages, then `rm components/side-panel.tsx`.

- [ ] **Step 2: Make the summary banner collapsible on mobile**

Wrap the summary text in `components/summary-banner.tsx` with a `<details>` on small screens:

```tsx
<details className="mt-2 lg:hidden" >
  <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-neutral-500">
    AI summary
  </summary>
  <p className="mt-1 text-sm leading-relaxed text-neutral-800">{summary}</p>
</details>
<div className="mt-2 hidden lg:block">{/* the existing always-visible block */}</div>
```

- [ ] **Step 3: Add error and 404 pages**

Create `app/error.tsx`:

```tsx
'use client';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-neutral-600">
          The error has been logged. You can try again.
        </p>
        <button onClick={reset} className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm text-white">
          Try again
        </button>
      </div>
    </main>
  );
}
```

The `error` prop is intentionally unused in the output — surfacing a raw server error message to the browser can leak internals.

Create `app/not-found.tsx`:

```tsx
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-xl font-semibold">Not found</h1>
        <p className="mt-2 text-sm text-neutral-600">
          This page does not exist, or you do not have access to it.
        </p>
        <Link href="/dashboard" className="mt-4 inline-block underline">Back to dashboard</Link>
      </div>
    </main>
  );
}
```

Create `app/(app)/dashboard/loading.tsx`:

```tsx
export default function Loading() {
  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-lg border bg-neutral-50" />
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Set page metadata**

In `app/layout.tsx`, set:

```tsx
export const metadata = {
  title: 'PDF Intelligence',
  description: 'Upload PDFs, get AI summaries, ask questions, and collaborate through comments.',
};
```

- [ ] **Step 5: Verify at three widths**

In devtools, check 375px, 768px, and 1440px. Expected: no horizontal page scroll at any width; the bottom bar appears below `lg` and the two-column layout above it; the PDF canvas scales down rather than overflowing; the chat input stays reachable with the on-screen keyboard open.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add responsive viewer layout with mobile tab bar and error pages"
```

---

## Task 18: End-to-end Playwright flow

**Files:**
- Create: `playwright.config.ts`, `e2e/flow.spec.ts`, `e2e/fixtures/make-pdf.ts`
- Test: this task *is* the test

**Interfaces:**
- Consumes: the deployed or locally running app, a real database, and a real `GEMINI_API_KEY`.
- Produces: `npm run e2e` covering signup → upload → summary → share → guest comment → owner sees it.

- [ ] **Step 1: Install the browser and a PDF generator**

```bash
npm install -D pdf-lib
npx playwright install chromium
```

- [ ] **Step 2: Create the PDF fixture generator**

Create `e2e/fixtures/make-pdf.ts`:

```ts
import { PDFDocument, StandardFonts } from 'pdf-lib';

/**
 * A real, text-bearing PDF built at test time. Generating it beats committing a
 * binary: the content is visible in the repo, and the assertions below can key
 * off specific facts we know are in the text.
 */
export async function makeTestPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const paragraphs = [
    'MASTER SERVICES AGREEMENT',
    'This Agreement is made on 12 May 2026 between Northwind Logistics Ltd',
    'of Manchester (the Supplier) and Contoso Retail GmbH of Hamburg (the',
    'Customer).',
    'The Supplier shall provide warehouse fulfilment services for a term of',
    'thirty-six months at a fee of EUR 18,400 per calendar month.',
    'Either party may terminate this Agreement for material breach upon',
    'forty-five days written notice.',
    'The Supplier total liability is capped at the fees paid during the twelve',
    'months preceding the claim.',
    'Governing law is the law of England and Wales.',
  ];

  const page = pdf.addPage([595, 842]);
  let y = 780;
  for (const line of paragraphs) {
    page.drawText(line, { x: 50, y, size: 12, font });
    y -= 24;
  }

  return Buffer.from(await pdf.save());
}
```

- [ ] **Step 3: Configure Playwright**

Create `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Real LLM calls make this slow; one worker keeps rate limits manageable.
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'npm run dev', url: 'http://localhost:3000', reuseExistingServer: true, timeout: 120_000 },
});
```

- [ ] **Step 4: Write the flow**

Create `e2e/flow.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { makeTestPdf } from './fixtures/make-pdf';

test('owner uploads and shares a PDF; a guest reads it, chats, and comments', async ({ page, browser }) => {
  const stamp = Date.now();
  const email = `e2e+${stamp}@example.com`;
  const password = 'e2e-test-password-1';

  // --- signup -------------------------------------------------------------
  await page.goto('/signup');
  await page.getByLabel('Name').fill('E2E Owner');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // --- upload -------------------------------------------------------------
  await page.setInputFiles('input[type=file]', {
    name: `msa-${stamp}.pdf`,
    mimeType: 'application/pdf',
    buffer: await makeTestPdf(),
  });

  const card = page.locator('article').filter({ hasText: `msa-${stamp}.pdf` });
  await expect(card).toBeVisible();

  // --- AI summary ---------------------------------------------------------
  // The pipeline runs extraction, summarization, then embedding; allow real time.
  await expect(card.getByText(/Northwind|Contoso|18,400|thirty-six|36/i)).toBeVisible({ timeout: 120_000 });
  // The summary must be substantive, not a restatement of the prompt.
  await expect(card).not.toContainText('This document');

  // --- viewer -------------------------------------------------------------
  await card.getByRole('link', { name: `msa-${stamp}.pdf` }).click();
  await expect(page.getByText('AI summary')).toBeVisible();

  // --- chat, grounded -----------------------------------------------------
  await page.getByRole('tab', { name: 'AI chat' }).click();
  await page.getByLabel('Ask a question about this document').fill('What is the monthly fee and the term?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByText(/18,?400/)).toBeVisible({ timeout: 60_000 });

  // --- share --------------------------------------------------------------
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByLabel('Invitee name').fill('E2E Guest');
  await page.getByLabel('Invitee email').fill(`guest+${stamp}@example.com`);
  await page.getByRole('button', { name: /Create link/ }).click();

  const shareUrl = await page.getByLabel('Share link').inputValue();
  expect(shareUrl).toContain('/s/');

  // --- owner comments -----------------------------------------------------
  await page.getByRole('tab', { name: 'Comments' }).click();
  await page.getByLabel('Add a comment…').fill('Please check the **liability cap**.');
  await page.getByRole('button', { name: 'Post' }).click();
  await expect(page.getByText('liability cap')).toBeVisible();

  // --- guest, in a clean context with no session ---------------------------
  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await guestPage.goto(shareUrl);

  await expect(guestPage.getByText('Shared with E2E Guest')).toBeVisible();
  await expect(guestPage.getByText('AI summary')).toBeVisible();

  await guestPage.getByRole('tab', { name: 'Comments' }).click();
  await expect(guestPage.getByText('liability cap')).toBeVisible();

  await guestPage.getByLabel('Add a comment…').fill('Agreed, the cap looks low.');
  await guestPage.getByRole('button', { name: 'Post' }).click();
  await expect(guestPage.getByText('Agreed, the cap looks low.')).toBeVisible();

  // --- the owner sees the guest's comment ---------------------------------
  await page.reload();
  await page.getByRole('tab', { name: 'Comments' }).click();
  await expect(page.getByText('Agreed, the cap looks low.')).toBeVisible();
  await expect(page.getByText('E2E Guest')).toBeVisible();

  await guestContext.close();
});
```

- [ ] **Step 5: Run it**

Run: `npm run e2e`
Expected: 1 passed. If it times out waiting for the summary, check the terminal for ingest errors — the usual causes are a missing `GEMINI_API_KEY` or a Supabase bucket that is not named `pdfs`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: add end-to-end flow covering upload, summary, chat, share, and comments"
```

---

## Task 19: Deployment and README

**Files:**
- Create: `README.md`
- Modify: `.env.example` (final check), `package.json` (final scripts)
- Test: the deployed URL, exercised as a stranger would

**Interfaces:**
- Consumes: everything.
- Produces: a public URL and a README covering setup, env vars, local development, and the AI approach.

- [ ] **Step 1: Push to GitHub**

```bash
gh repo create pdf-intelligence --public --source=. --remote=origin --push
```

Then confirm no secret was ever committed:

```bash
git log --all -p -- .env.local | head -5
git log --all --name-only --format="" | sort -u | grep -i "env" || echo "no env files tracked"
```

Expected: `.env.local` appears nowhere; only `.env.example` is tracked.

- [ ] **Step 2: Deploy to Vercel**

Import the repo at vercel.com. Set every variable from `.env.example` in Project Settings → Environment Variables, for Production **and** Preview:

`DATABASE_URL` (the pooled Supabase string, port 6543), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `AUTH_SECRET`, `RESEND_API_KEY`, and `NEXT_PUBLIC_APP_URL` set to the real Vercel URL.

`NEXT_PUBLIC_APP_URL` must be the deployed origin, or emailed share links will point at localhost.

- [ ] **Step 3: Verify the deployment as a stranger**

In a private window on the deployed URL, run the whole flow: sign up, upload, wait for the summary, chat, share to your own email, open the emailed link in another private window, comment as the guest, confirm the owner sees it. Then:

- Check the semantic search example from Task 12 works in production.
- Confirm `view-source` and the JS bundle contain no API key: in devtools, search all loaded scripts for the first six characters of your Gemini key. Expect zero matches.
- Confirm a revoked link 404s.

- [ ] **Step 4: Write the README**

Create `README.md` covering, in this order:

1. **What it is** — one paragraph, and the live URL.
2. **Features** — the eight must-haves, plus the three good-to-haves delivered (streaming chat, threaded comments with formatting, semantic search) and the share email.
3. **Stack** — the table from this plan's header, with one line on why Vercel + Supabase.
4. **Local setup** — clone, `npm install`, copy `.env.example` to `.env.local`, create the Supabase project, `CREATE EXTENSION vector`, create the private `pdfs` bucket, `npm run db:push`, `npm run dev`.
5. **Environment variables** — a table: variable, where to get it, server-only or public.
6. **AI approach** — this section is graded, so cover it properly:
   - Gemini 2.5 Flash for summaries and chat; `gemini-embedding-001` at 768 dimensions for retrieval, truncated from 3072 to fit pgvector's HNSW index and re-normalized because truncated vectors do not arrive unit-length.
   - **Prompt design:** quote the summary prompt and explain that each rule counters a specific failure — the "never open with This document" rule and the "operative effect, not topic" rule exist because generic restatement is the default failure mode. Same for the chat prompt's explicit permission to say what is missing, which is what keeps it from inventing answers.
   - **Long documents:** the 40,000-token threshold. Below it, full text goes in the prompt — no retrieval miss is possible. Above it, top-8 chunk retrieval by cosine similarity plus `idx ± 1` neighbours, emitted in document order rather than relevance order. Summaries above the threshold use map-reduce, capped at 60 evenly-sampled map calls so a 1,000-page PDF cannot exhaust the free tier.
   - **Chunking:** ~1,000 tokens, 150 overlap, split on paragraph boundaries, page ranges retained so answers can cite pages.
   - **Conversation memory:** last five turns replayed, namespaced per viewer so guests never share a thread.
7. **Architecture notes** — why upload goes client → Supabase Storage directly (Vercel's 4.5MB body cap), why ingest is staged (the 60s function limit), and how stalled documents self-heal.
8. **Security** — bcrypt cost 12; every access decision in `lib/authz.ts`; guest tokens are 32 random bytes and revocable; 404 rather than 403 so document existence is not disclosed; magic-byte validation over trusted MIME; markdown rendered without raw HTML; service-role key server-only.
9. **Testing** — `npm test` for the unit suite (what it covers and why those parts), `npm run e2e` for the flow.
10. **Trade-offs and known limitations** — copy §12 of the spec verbatim: no password reset, no RLS, no OCR for scanned PDFs, staged ingest as a stand-in for a job queue, one-level comment threading. Add anything discovered during implementation.

- [ ] **Step 5: Record the walkthrough**

Three to five minutes, in this order — it maps to the grading rubric:
signup → upload → **the summary appearing, read aloud to show it names specifics** → open the viewer → **chat: a grounded answer with a page citation, then a follow-up proving memory, then a question the document cannot answer to show it declines rather than invents** → semantic search finding a document by meaning, contrasted with filename search failing → share by email → open the guest link in a private window → guest comments → owner sees it → revoke and show the dead link.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "docs: add README covering setup, AI approach, and trade-offs"
git push
```

---

## Plan Self-Review

Run against the spec after finishing the plan; recorded here for the executor.

**Spec coverage.** Every spec section maps to a task: §2 stack → Task 1; §3 structure → Tasks 1, 4; §4 data model → Task 2; §5 authorization → Task 5; §6 ingest → Tasks 6, 10; §7 AI → Tasks 8, 9, 14; §8 sharing/comments/UI → Tasks 11, 13, 15, 16, 17; §9 error handling → Tasks 10, 13, 17; §10 testing → Tasks 3–16, 18; §11 env vars → Tasks 1, 19; §12 trade-offs → Task 19.

**Deviations from the spec, all deliberate and recorded in Global Constraints:**
1. Next.js 16 rather than 15.
2. `text` + lowercase normalization rather than `citext`.
3. `/embed` driven by `WHERE embedding IS NULL` rather than an explicit cursor.
4. Stage-driving lives in `DocumentCard`, which merges the fresh-upload and abandoned-tab paths the spec described separately.
5. Map calls capped at 60 with even sampling — a rate-limit protection the spec did not specify.

**Interface consistency.** `CardDocument` is defined in `components/document-card.tsx` and consumed by `lib/ai/search.ts` and the dashboard. `Viewer`, `DocRef`, and `ShareRow` come only from `lib/authz.ts`. `Generate` and `GenerateArgs` come only from `lib/ai/gemini.ts`. `Chunk` (Task 7) and `ChunkRow` (Task 14) are deliberately distinct: `Chunk` carries `idx`/`tokenCount` for insertion, `ChunkRow` is the narrower shape retrieval reads back.

**One ordering constraint:** Task 12's `semanticSearch` imports `CardDocument` from Task 11's component, so Task 11 must land first. Tasks 1–11 are otherwise strictly sequential; 12, 13 can be done in either order; 14–16 depend on 13.
