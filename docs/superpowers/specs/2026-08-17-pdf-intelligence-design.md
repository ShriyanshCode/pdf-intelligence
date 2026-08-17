# PDF Intelligence & Collaboration System — Design

**Date:** 2026-08-17
**Status:** Approved, ready for implementation planning
**Time budget:** 3–5 days

## 1. Goal

A web application where an authenticated user uploads PDFs, receives an
AI-generated summary automatically, asks grounded questions about the document
in a streaming chat, shares the document with people who have no account, and
collaborates with them through threaded comments.

### Scope

All eight must-have requirements, plus three good-to-haves: streaming AI
responses, threaded comments with basic formatting, and embedding-based
semantic search.

**Deliberately out of scope** (to be recorded as trade-offs in the README):
password reset and account recovery. Email notification on share is *in* scope,
because the per-invitee share model produces it almost for free.

## 2. Stack and hosting

| Concern | Choice | Notes |
| --- | --- | --- |
| Front + back | Next.js 15, App Router, on Vercel | One repo, one deploy, one URL |
| Database | Supabase Postgres + `pgvector` | Free tier, permanent |
| File storage | Supabase Storage | Signed URLs for access control |
| Query layer | Drizzle | Typed, small cold start, speaks `pgvector` |
| Auth | Auth.js v5 Credentials + `bcrypt` | Hashing is our code, not a vendor's |
| LLM | Gemini `gemini-2.5-flash` | Summaries and chat |
| Embeddings | `gemini-embedding-001`, 768 dims | 768 because pgvector HNSW caps at 2000 |
| Email | Resend | Share notifications |
| Tests | Vitest + one Playwright flow | |

Render credits are deliberately left unspent. Vercel's free tier covers the
whole application, and a free Supabase database outlives promotional credit.

### Why this auth approach

The brief explicitly grades "user passwords must be securely hashed." Hashing
with `bcrypt` in our own code puts that requirement where a reviewer can read
it. Auth.js supplies correct session-cookie handling, CSRF, and expiry, so we
are not hand-rolling the parts that are easy to get subtly wrong.

Supabase is used as plain Postgres plus a storage bucket, reached with the
service-role key from the server only. No RLS. The trade-off accepted: the
database is not a second line of defense, mitigated by routing every read and
write through one authorization module (§5) and never shipping the service-role
key to the client.

The rejected alternative was Supabase Auth with RLS policies. It offers real
defense in depth, but password hashing would become Supabase's rather than
ours, and granting anonymous token-holders row-level access requires custom JWT
claims or security-definer RPCs — fiddly for precisely the guest flow that most
needs to work.

## 3. Application structure

```
app/
  (auth)/login/page.tsx
  (auth)/signup/page.tsx
  (app)/dashboard/page.tsx              owner only, Server Component
  (app)/d/[id]/page.tsx                 owner's viewer
  s/[token]/page.tsx                    guest viewer, public, no session
  api/chat/route.ts                     streaming POST
  api/documents/[id]/ingest/route.ts    extract + summarize
  api/documents/[id]/embed/route.ts     batched embedding, cursor-driven
  api/documents/[id]/status/route.ts    polling target for the dashboard
lib/
  db/index.ts, db/schema.ts             Drizzle client and schema
  auth.ts                               Auth.js config, bcrypt hash/verify
  authz.ts                              every access decision
  storage.ts                            signed upload and download URLs
  pdf.ts                                extraction, chunking
  ai/gemini.ts                          client, retry, backoff
  ai/prompts.ts                         all prompt text, one place
  ai/summarize.ts                       single-shot and map-reduce
  ai/embed.ts                           batch embedding
  ai/chat.ts                            context assembly, streaming
  ai/search.ts                          semantic dashboard search
  email.ts                              Resend
```

Reads happen in Server Components. Mutations are Server Actions. Only two
concerns are route handlers: chat, which needs a streaming response, and the
ingest stages, which need to be callable as background triggers.

## 4. Data model

```sql
users
  id uuid pk, name text, email citext unique, password_hash text,
  created_at timestamptz

documents
  id uuid pk, owner_id uuid → users,
  filename text, storage_path text, size_bytes int,
  page_count int, char_count int, token_estimate int,
  status text ∈ {uploading, extracting, summarizing, indexing, ready, failed},
  error text, summary text, full_text text,
  has_extractable_text boolean,
  created_at timestamptz, updated_at timestamptz

chunks
  id uuid pk, document_id uuid → documents ON DELETE CASCADE,
  idx int, content text, page_start int, page_end int, token_count int,
  embedding vector(768),
  UNIQUE (document_id, idx)

shares
  id uuid pk, document_id uuid → documents ON DELETE CASCADE,
  token text UNIQUE, invitee_email citext, invitee_name text,
  can_comment boolean DEFAULT true, revoked_at timestamptz,
  created_at timestamptz, last_viewed_at timestamptz

comments
  id uuid pk, document_id uuid → documents ON DELETE CASCADE,
  parent_id uuid → comments NULL,
  body text, author_user_id uuid → users NULL,
  author_share_id uuid → shares NULL,
  author_label text, created_at timestamptz,
  CHECK (author_user_id IS NOT NULL OR author_share_id IS NOT NULL)

chat_messages
  id uuid pk, document_id uuid → documents ON DELETE CASCADE,
  session_key text, role text ∈ {user, assistant},
  content text, created_at timestamptz
```

Indexes: `documents(owner_id, created_at DESC)`, `chunks(document_id, idx)`,
`comments(document_id, created_at)`, `chat_messages(session_key, created_at)`,
and an HNSW index on `chunks(embedding)` using `vector_cosine_ops`.

### Two decisions embedded here

**`session_key`** is `user:<uuid>` for owners or `share:<share_id>` for guests.
Each guest therefore gets a private chat thread on a shared document rather
than seeing everyone else's questions. The last five turns for a session key
are replayed into each prompt, satisfying the conversational-context
requirement.

**No document-level embedding.** Semantic dashboard search embeds the query,
finds the best-matching *chunks* across the requesting user's documents, groups
those chunks by document, and ranks each document by its best chunk score. The
same vectors serve chat retrieval and dashboard search, so searching
"employment contract" surfaces `Agreement_v3.pdf` with no extra table.

## 5. Authorization

Every entry point resolves a `Viewer` before touching data:

```ts
type Viewer =
  | { kind: 'owner'; userId: string }
  | { kind: 'guest'; shareId: string; documentId: string; canComment: boolean }
```

`lib/authz.ts` is the only module that produces a `Viewer` or grants document
access. It exposes:

- `requireOwner(documentId, session)` — throws unless the session user owns it
- `resolveShare(token)` — returns the share, or triggers a 404 when the token
  is unknown or `revoked_at` is set
- `assertCanRead(viewer, documentId)` — guests are scoped to exactly one
  document, so a guest token for document A cannot read document B
- `assertCanComment(viewer, documentId)` — additionally checks `can_comment`

No route, action, or component queries `documents`, `comments`, `chunks`, or
`chat_messages` by id without going through one of these. This is the module
the authz test matrix targets (§9).

## 6. Upload and ingest pipeline

Two Vercel constraints shape this: request bodies cap at 4.5MB, and Hobby
functions cap at 60 seconds.

1. Client validates `application/pdf`, the `.pdf` extension, and a 25MB size
   limit.
2. Server Action `createUploadTarget(filename, size)` authenticates, inserts a
   `documents` row with `status: 'uploading'`, and returns a Supabase **signed
   upload URL** for `{userId}/{documentId}.pdf`.
3. Client uploads **directly to Supabase Storage**, never through Vercel, so
   the 4.5MB body limit does not apply.
4. Client calls `POST /api/documents/[id]/ingest`. The server sets
   `status: 'extracting'`, downloads the object, verifies the leading `%PDF-`
   **magic bytes**, extracts text with `unpdf`, and records
   `page_count`/`char_count`/`token_estimate`. It then sets
   `status: 'summarizing'`, generates the summary (§7), and finishes at
   `status: 'indexing'`.
5. Client calls `POST /api/documents/[id]/embed` repeatedly. Each call embeds
   one batch of chunks and returns the next cursor, or `done: true`, which sets
   `status: 'ready'`.

The intermediate statuses are written as distinct transitions specifically so
the dashboard card can report real progress rather than an undifferentiated
spinner.

**Short-circuit:** if extraction yields no usable text (§9), `/ingest` skips
summarization and chunking entirely, sets `has_extractable_text: false`, and
goes straight to `status: 'ready'`. The client does not call `/embed`.

**Resuming abandoned work.** The uploading client drives the pipeline, so a
closed tab would otherwise leave a document stuck in `extracting` forever. On
dashboard load, any document of the requesting user in a non-terminal status
whose `updated_at` is older than 90 seconds is re-triggered from its current
stage. Because every stage is idempotent, re-triggering is always safe. This
also covers a function timeout mid-stage.

Splitting embedding into cursor-driven batches is what keeps every request
clear of the 60-second ceiling: a 400-page PDF simply takes more calls. Each
stage is idempotent — re-running `/ingest` overwrites the same fields,
re-running `/embed` for a batch upserts on `(document_id, idx)` — so any failed
call retries safely.

**File-format validation** is four layers: client MIME check, client extension
check, server-side magic-byte check, and successful parse. A file renamed to
`.pdf` fails at layer three.

## 7. AI layer

### Long-document strategy

A single threshold, stated as a number so it can be documented plainly:

- **Under ~40,000 tokens** — pass the **full extracted text**. No retrieval
  miss is possible, and most real documents land here.
- **Over the threshold** — retrieve the **top 8 chunks** by cosine similarity,
  plus each retrieved chunk's immediate neighbours (`idx ± 1`) for continuity.
  The retrieved set and its neighbours are unioned, deduplicated by `idx`, and
  emitted in ascending `idx` order, so the model reads the excerpts in document
  order rather than in relevance order — adjacent chunks then read as
  continuous prose.

Chunking: roughly 1,000 tokens with 150 tokens of overlap, split preferentially
on page and paragraph boundaries so a chunk rarely severs a sentence. Every
chunk retains its page range, which is what makes inline page citations
possible.

Embeddings are asymmetric and the task types matter: chunks are embedded with
`task_type: RETRIEVAL_DOCUMENT`, queries with `RETRIEVAL_QUERY`. Using the
matching pair is a measurable retrieval gain over embedding both sides
identically. Vectors are truncated to 768 dimensions and re-normalised.

### Summary prompt

Written to attack generic restatement directly, which the brief calls out:

```
You write briefing notes for someone deciding whether this document needs
their attention today. You never pad and never editorialize.

Write a 3–5 sentence summary of the document below.

- Open with what the document DOES — its operative effect, not its topic.
  "Acme licenses its API to Beta for $4k/month over 24 months" —
  not "This document discusses a licensing arrangement."
- Include the specifics a reader would otherwise have to open the file for:
  named parties, dates, amounts, versions, quantities, findings, decisions.
- Never open with "This document", "This paper", "The following",
  "In this report".
- Never describe structure ("it is divided into five sections").
- State only what the text supports. If the extract is partial or garbled,
  say so in your last sentence rather than guessing.
- 3–5 sentences. No headings, no bullets, no preamble.
```

For documents over the threshold, map-reduce: each chunk is reduced to terse
factual bullets (*parties, obligations, figures, dates, findings — no prose*),
then the prompt above runs over the collected bullets.

### Chat prompt

```
You answer questions about ONE document, using only the excerpts provided.

- Ground every claim in the excerpts. Cite pages inline like (p. 12).
- If the excerpts don't contain the answer, say what's missing —
  "The excerpts don't cover the termination terms" — and mention what
  nearby content they do cover. Never fill a gap with general knowledge.
- If a question is ambiguous, resolve it against the conversation so far;
  only ask the user if it's genuinely undecidable.
- Quote exact wording (max one sentence) when precision matters:
  definitions, figures, legal language.
- Match the question's scope. A yes/no question gets yes/no plus one
  supporting line, not an essay.
```

Per-turn context: the last five turns for the `session_key`, then a context
block — full text or retrieved chunks — with each block labelled by page range.

### Streaming

`generateContentStream` is piped into the route handler's `ReadableStream`. The
client renders tokens as they arrive; the completed assistant message is
persisted to `chat_messages` when the stream closes. If the stream errors
mid-flight, the partial text stays on screen with an inline retry affordance
and nothing is persisted.

## 8. Sharing, comments, and UI

### Sharing

The owner enters an invitee email and name. A Server Action mints a
32-random-byte token, inserts the `shares` row, and Resend emails the link.
The dialog shows a copy button. Below it, a share list shows each invitee,
`last_viewed_at`, and a **Revoke** button that sets `revoked_at`.

Guests visiting `/s/[token]` get the viewer, the summary, comments, and chat —
no signup, no session. Everyone with access to a document sees all of its
comments; that is the collaboration requirement.

### Comments

Threaded **one level deep**: replies attach to top-level comments only, which
matches common review UIs and avoids unbounded indentation. Formatting is a
small toolbar inserting markdown for bold, italic, and bullet lists, rendered
via `react-markdown` with an element allowlist and raw HTML disabled, so a
guest-writable field cannot become an XSS vector.

### UI

Tailwind plus shadcn/ui. Responsive.

**Dashboard** — upload dropzone, a search bar with a Filename ⇄ Meaning toggle,
and a card grid showing filename, upload date, page count, share count, and
either the summary or a live progress state.

**Viewer** — on desktop, the PDF centre via `react-pdf`, the summary pinned in
a banner at the top, and a right-hand panel with **Comments | Chat** tabs. On
mobile, a bottom tab bar switches between PDF / Comments / Chat and the summary
collapses.

## 9. Error handling

| Case | Behaviour |
| --- | --- |
| Scanned, image-only PDF | Upload succeeds, `has_extractable_text: false`, `status: ready`. Banner reads "No extractable text found; this looks like a scanned document, so summary and chat are unavailable." Chat input disabled. No OCR in this stack, and answering over empty context would hallucinate. |
| Gemini call fails | `status: failed` with the error message and a Retry button. The PDF stays viewable — a missing summary must not block reading the file. |
| Gemini rate limit | Exponential backoff with jitter; embedding batch sizes held under the free-tier request rate. |
| Revoked or unknown share token | Clean 404 page, no information disclosure about whether the document exists. |
| Storage upload fails | The orphaned `documents` row is deleted. |
| Chat stream breaks mid-response | Partial text retained on screen, inline retry, nothing persisted. |

## 10. Testing

**Vitest**, targeting logic where bugs are silent:

- `bcrypt` hash and verify, including a wrong-password path
- the **authz matrix**: owner, guest with valid token, guest whose token is for
  a different document, revoked token, unknown token, guest with
  `can_comment: false`
- chunk boundary and overlap correctness, and that page ranges survive chunking
- magic-byte validation, including a non-PDF renamed to `.pdf`
- semantic search grouping and ranking: chunks collapse to documents ranked by
  best chunk score

**Playwright**, one flow: signup → upload → poll to ready → assert a
non-placeholder summary rendered → share → open the guest link in a fresh
browser context → comment as the guest → assert the owner sees the comment.

## 11. Environment variables

```
DATABASE_URL                  Supabase Postgres connection string (pooled)
SUPABASE_URL                  Supabase project URL
SUPABASE_SERVICE_ROLE_KEY     server-only, never sent to the client
GEMINI_API_KEY                server-only
AUTH_SECRET                   Auth.js session signing
RESEND_API_KEY                server-only
NEXT_PUBLIC_APP_URL           used to build share links in emails
```

Every variable except `NEXT_PUBLIC_APP_URL` is server-only. A `.env.example`
with these keys and empty values is committed; `.env.local` is gitignored.

## 12. Known trade-offs

Recorded here so they can be carried into the README verbatim.

1. **No password reset flow.** Cut for time; the rest of the auth surface was
   prioritised.
2. **No RLS.** Access control is enforced in application code (§5) rather than
   by the database. Chosen so that password hashing lives in our repo.
3. **No OCR.** Scanned PDFs are detected and reported rather than processed.
4. **Vercel Hobby's 60-second limit** shapes the ingest pipeline into
   cursor-driven stages. A queue would be cleaner in production.
5. **Threading is one level deep**, not arbitrarily nested.
