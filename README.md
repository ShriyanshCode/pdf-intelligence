# PDF Intelligence & Collaboration System

Upload PDFs, get an AI-generated summary automatically, ask grounded questions
about the content in a streaming chat, share documents with people who have no
account, and collaborate through threaded comments.

**Live app:** _https://pdf-intelligence-theta.vercel.app/_

---

## Features

### Must-haves

| # | Feature | Notes |
|---|---|---|
| 1 | Signup and authentication | Name, email, password. `bcrypt` cost 12, hashed in our own code (`lib/password.ts`). Auth.js JWT session cookies. |
| 2 | File upload | PDF-only, 25MB cap. Validated four ways: client MIME, client extension, **server-side `%PDF-` magic bytes**, and a successful parse. |
| 3 | Dashboard | All your PDFs with filename, upload date, page count, share count, and the AI summary on each card. Live per-stage progress while processing. |
| 4 | File sharing | A unique link per invitee. Individually revocable. |
| 5 | Invited-user access and commenting | Guests need no account. They get the PDF, the summary, chat, and comments. |
| 6 | AI summary | Generated on upload, shown on the dashboard card and at the top of the viewer. |
| 7 | AI chat | Grounded, cites page numbers, keeps the last 5 turns of context, streams token-by-token. |
| 8 | Security and privacy | Access control in one module, private storage bucket with signed URLs, no secrets client-side. |
| 9 | UI and design | Responsive; desktop splits PDF and panel, mobile switches panes from a bottom bar. Light-only theme, cool ground with warm accents (see below). |

### Theme

Cool light ground, warm accents. Defined once as Tailwind v4 tokens in
`app/globals.css`:

| Token | Hex | Role |
|---|---|---|
| `canvas` | `#EBEFEE` | Page background |
| `surface` | `#FFFFFF` | Cards and panels, lifted off the canvas |
| `mist` | `#DFE5E3` | Inset fills: chat bubbles, PDF backdrop, skeletons |
| `line` | `#CCB499` | Borders — warm hairlines against the cool ground |
| `ink` | `#4A413C` | Body text, headings, primary buttons |
| `clay` | `#BB6C43` | Accents: focus rings, active tab, icons |
| `clay-deep` | `#8E5B40` | Links and button hover |
| `tan` | `#C8906D` | Decorative fills |

**Contrast was measured, not assumed, and it changed the design.** Ink is 8.6:1
on the canvas — comfortably AA. But `clay` is only **3.5:1**, which passes for
non-text UI and large text yet fails the 4.5:1 body-copy threshold, and white on
`clay` is **4.0:1** — also short. So clay is never a button background and never
carries paragraph text; it appears as focus rings, the active tab underline, and
icons. Buttons are `ink` (white on ink is 9.9:1) hovering to `clay-deep` (5.6:1).

`clay-deep` exists precisely because `clay` cannot legally carry link text: it is
that hue mixed toward ink until it passes at 4.9:1. One warm red (`#A11B0F`) is
added for errors, since the palette has no hue that reads as "wrong" rather than
merely "warm", and white is used for card surfaces.

Modern treatment: pill buttons and inputs, `rounded-2xl`/`rounded-3xl` cards, and
soft warm-tinted elevation (`--shadow-card`, `--shadow-float`) rather than flat
grey shadow.

The app is **light-only**. The `prefers-color-scheme: dark` block from the Next
template was removed and `color-scheme: light` is declared, so browser-rendered UI
is not auto-darkened for visitors whose OS is in dark mode.

### Good-to-haves included

- **Streaming AI responses** — answers render token-by-token as they arrive.
- **Threaded comments** with bold, italic, and bullet formatting.
- **Semantic PDF search** — a Filename ⇄ Meaning toggle on the dashboard finds
  documents by what they are about, using the same embeddings as chat retrieval.
- **Email notification on share** via Resend (optional; sharing works without it).
- **Password reset / account recovery** — see below.

### Password reset

`/forgot-password` → emailed link → `/reset-password`. Four properties worth
noting, all verified against live data:

- **Only a SHA-256 hash of the token is stored**, never the token itself, so read
  access to the table cannot be turned into account takeover. SHA-256 rather than
  bcrypt is deliberate: the token is 256 bits of randomness, so there is nothing
  to brute-force, and lookup must be a deterministic index hit.
- **The request form always says the same thing** whether or not the address is
  registered. "No account with that email" would make it an account-enumeration
  oracle.
- **Tokens are single-use and expire in 60 minutes.** Completing a reset burns
  every outstanding token for that user, and requesting a new link retires the
  previous one.
- **Unknown, used, and expired tokens produce one identical message**, so the
  error text never confirms that a token once existed.

If `RESEND_API_KEY` is unset the link is written to the **server log** rather than
shown in the browser — displaying it in the UI would let anyone reset any account
by simply asking. To demo this feature you need Resend configured; with the
sandbox sender (`onboarding@resend.dev`) you can only email the address that owns
the Resend account.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Front + back | Next.js 16 (App Router) on Vercel | One repo, one deploy, one URL. No CORS, and native response streaming for chat. |
| Database | Supabase Postgres + `pgvector` | Free tier that does not expire, and vector search without a second service. |
| File storage | Supabase Storage (private bucket) | Signed URLs give per-request access control. |
| Query layer | Drizzle ORM + `postgres.js` | Typed, small cold start, speaks `pgvector` without fighting the ORM. |
| Auth | Auth.js v5 (Credentials) + `bcryptjs` | Correct cookie/CSRF handling, but hashing stays in our code. |
| AI | Google Gemini | `gemini-2.5-flash` for summaries and chat, `gemini-embedding-001` for vectors. Genuinely free tier. |
| Email | Resend | Optional share notifications. |
| Tests | Vitest | 64 unit tests over the logic where bugs are silent. |

Render credits were deliberately left unspent: Vercel's free tier covers the whole
app, and a free Supabase database outlives promotional credit.

---

## Running locally

**Prerequisites:** Node 20.9+ (developed on 22.11), a Supabase project, and a
Gemini API key from [aistudio.google.com](https://aistudio.google.com).

```bash
git clone https://github.com/ShriyanshCode/pdf-intelligence.git
cd pdf-intelligence
npm install
cp .env.example .env.local   # then fill it in, see below
```

### Supabase setup

1. **Enable pgvector.** SQL Editor → run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
2. **Create a private storage bucket** named exactly `pdfs` (Storage → New
   bucket → Public: **off**).
3. **Apply the schema:**
   ```bash
   npm run db:migrate
   ```
4. **Confirm it worked:**
   ```bash
   npx tsx --env-file=.env.local scripts/verify-db.mts
   ```

### Run it

```bash
npm run dev      # http://localhost:3000
npm test         # unit tests
npm run build    # production build
```

---

## Environment variables

Every variable except `NEXT_PUBLIC_APP_URL` is server-only and must never reach
the browser.

| Variable | Where to get it | Notes |
|---|---|---|
| `DATABASE_URL` | Supabase → Connect → ORM | **Transaction pooler, port 6543.** Runtime queries. |
| `DIRECT_URL` | Same dialog | **Session pooler, port 5432.** Migrations only; not needed in production. |
| `SUPABASE_URL` | Settings → Data API | Project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API Keys | The `service_role` secret, **not** `anon`. |
| `GEMINI_API_KEY` | aistudio.google.com | |
| `AUTH_SECRET` | `npx auth secret` | Session signing. |
| `RESEND_API_KEY` | resend.com | Optional. Sharing works without it; only the email is skipped. |
| `NEXT_PUBLIC_APP_URL` | — | Must be the deployed origin in production, or emailed share links point at localhost. |

**Two connection strings, and they are not interchangeable.** Serverless
functions must use the transaction pooler or they exhaust connections; that mode
forbids prepared statements, which is why the client sets `prepare: false`.
Schema DDL (`CREATE EXTENSION`, `CREATE INDEX`) needs a real session, so
migrations use the session pooler. Supabase's "Direct connection" is IPv6-only
without the paid add-on and is not used.

URL-encode special characters in the database password (`#` → `%23`, `&` →
`%26`, `?` → `%3F`, `%` → `%25`). An unencoded `#` silently truncates the whole
connection string at the fragment.

---

## The AI implementation

### Models

`gemini-2.5-flash` for summaries and chat. `gemini-embedding-001` at **768
dimensions** for retrieval — truncated from the native 3072 because pgvector's
HNSW index caps at 2000.

Two non-obvious details that materially affect correctness:

- **Truncated embeddings arrive unnormalized.** Gemini returns unit-length
  vectors only at 3072 dimensions. At 768 they are not normalized, so cosine
  distance ranks incorrectly unless we L2-normalize ourselves (`lib/ai/embed.ts`).
  Verified live: magnitude is exactly 1.
- **Thinking tokens are charged against `maxOutputTokens`.** Gemini 2.5 reasons
  before answering. With a modest cap, reasoning consumes the entire budget and
  the visible answer arrives truncated mid-sentence — which is exactly what
  happened on the first live run. Thinking is disabled
  (`thinkingConfig.thinkingBudget: 0`) since summarization and grounded
  extraction do not benefit from deliberation, and a `finishReason` other than
  `STOP` is now logged rather than passing silently.

### Prompt design

All prompt text lives in `lib/ai/prompts.ts`. Every rule counters a specific
observed failure mode.

**The summary prompt** attacks generic restatement directly, because that is the
default failure. It requires the summary to open with what the document *does*
rather than what it is *about*, demands the specifics a reader would otherwise
open the file for, and explicitly forbids the openers models reach for:

```
Open with what the document DOES — its operative effect, not its topic.
  "Acme licenses its API to Beta for $4k/month over 24 months" — not
  "This document discusses a licensing arrangement."
Never open with "This document", "This paper", "The following", "In this report".
Never describe structure ("it is divided into five sections").
```

**The chat prompt** makes declining an explicit, first-class option, which is
what stops invention:

```
If the excerpts do not contain the answer, say what is missing — "The excerpts
don't cover the termination terms" — and mention what nearby content they do
cover. Never fill a gap with general knowledge.
```

It also requires inline page citations (`(p. 12)`), which is only possible
because chunks retain their page ranges through chunking.

### Handling long PDFs

A single documented threshold, chosen so the number can be stated plainly:

- **Under ~40,000 tokens** → the **full extracted text** goes into the prompt.
  No retrieval miss is possible, and most real documents land here.
- **At or above it** → **top-8 chunks** by cosine similarity, plus each hit's
  immediate neighbours (`idx ± 1`).

Retrieved excerpts are emitted in **document order, not relevance order**.
Relevance order reads as disconnected fragments; document order lets adjacent
chunks read as continuous prose.

**Chunking:** ~1000 tokens with 150 tokens of overlap, split on paragraph
boundaries so a chunk rarely severs a sentence. Overlap is carried as a bounded
*text suffix* rather than by re-queueing whole segments — an earlier version did
the latter and produced chunks at twice the intended ceiling when a single
oversized paragraph was involved.

**Summaries of long documents** use map-reduce: each chunk is reduced to terse
factual bullets, then the summary prompt runs over the collected bullets. Map
calls are capped at **60 evenly-sampled chunks** (always including the first and
last), so a 1000-page PDF cannot exhaust the free tier while still covering
beginning, middle, and end.

**Conversation memory:** the last 5 turns are replayed per request. Threads are
namespaced by viewer — `user:<id>` or `share:<id>` — so two guests holding
different links to the same document never see each other's questions.

**Embeddings are asymmetric:** documents embed with `RETRIEVAL_DOCUMENT`,
queries with `RETRIEVAL_QUERY`. Using the matching pair is a real accuracy gain
over embedding both sides identically.

### Semantic search

Dashboard search embeds the query, finds the best-matching *chunks* across your
documents, groups them by document, and ranks each document by its **single best
chunk** — not by hit count, so a long document cannot outrank a short, precisely
relevant one on volume.

The similarity floor is **0.6**, calibrated against the live API rather than
guessed. Gemini similarities sit in a compressed high range: a measured query
scored 0.691 against genuinely related text but still **0.503 against a
completely unrelated passage**. A naive 0.35 floor would return every document
for every query.

---

## Architecture notes

### Why upload goes straight to storage

Vercel caps request bodies at **4.5MB**, well under our 25MB limit. So the server
issues a **signed upload URL** and the browser uploads directly to Supabase
Storage. The file never passes through the application.

### Why ingestion is staged

Vercel Hobby functions cap at **60 seconds**. Ingestion is therefore split:

```
uploading → extracting → summarizing → indexing → ready
            └── /ingest ──────────────┘  └ /embed ┘
```

`/ingest` extracts text and writes the summary. `/embed` then embeds **one batch
of chunks per call**, driven by `WHERE embedding IS NULL` rather than a
caller-held cursor — which makes retries inherently idempotent, since a stale
cursor cannot skip a batch. A 400-page PDF simply takes more calls; no single
request approaches the ceiling.

### Self-healing

The uploading tab drives the pipeline, so a closed tab would otherwise leave a
document stuck. The dashboard card re-triggers any non-terminal document whose
`updated_at` is older than 90 seconds. Every stage is idempotent, so
re-triggering is always safe — this covers both a closed tab and a function
timing out mid-stage.

### Scanned PDFs

A scanned PDF extracts to almost nothing. Rather than summarizing noise, the
pipeline detects it (under ~100 characters per page), records
`has_extractable_text: false`, finishes as `ready`, and shows an honest banner
with chat disabled. There is no OCR in this stack.

---

## Security

- **Passwords** are hashed with `bcrypt` cost 12 in `lib/password.ts`. Verified
  against live data: stored values are 60-char `$2b$12$` hashes, the correct
  password validates, wrong and empty are rejected.
- **Login is timing-equalised** — a dummy hash is compared when no user exists,
  so response time does not reveal which accounts are registered.
- **Every access decision** flows through `lib/authz.ts`. Its pure decision
  functions take plain objects rather than querying, which is what makes the
  full matrix unit-testable: owner, valid guest, guest whose token is for a
  *different* document, revoked token, and read-only guest.
- **Denials return 404, not 403**, so a caller cannot learn whether a document
  exists.
- **Guest tokens** are 32 random bytes, base64url. The token is the credential,
  and each is individually revocable.
- **Storage is private.** Verified: signed upload and download work, while an
  unsigned fetch of the same object is refused with 400.
- **PDF validation** checks magic bytes server-side, because MIME type and
  extension are client-supplied and forgeable.
- **Comment bodies** render through `react-markdown` with an element allowlist
  and raw HTML disabled. Verified: an `<img src=x onerror=...>` probe renders as
  literal text.
- **No secrets client-side.** Verified by scanning the built `.next/static`
  bundles for the Gemini key, database password, project ref, and auth secret —
  none present.

There is deliberately **no RLS**; see *Trade-offs*.

---

## Testing

```bash
npm test    # 64 unit tests
```

Tests target the logic where bugs are silent rather than the UI:

- password hashing and verification, including malformed-hash handling
- the **authorization matrix** (15 assertions covering guest containment)
- chunk boundaries, overlap, page-range tracking, and the size ceiling
- magic-byte validation, including a non-PDF renamed to `.pdf`
- the summarization strategy — call counts, map-reduce ordering, the sampling cap
- embedding normalization
- semantic-search grouping and ranking

Two of the bugs listed below were caught by these tests rather than by
inspection.

There are also dev scripts under `scripts/` used to verify behaviour against the
live stack (`verify-db`, `verify-security`, `probe-storage`, `probe-summary`,
`probe-embed`, `inspect-documents`, `inspect-chat`, `inspect-collab`).

---

## Trade-offs and known limitations

Stated plainly, since the brief asks for transparency.

1. **A password reset does not revoke existing sessions.** Sessions are JWTs, so
   invalidating them would mean a database lookup on every request or a
   `passwordChangedAt` claim check. Someone already holding a stolen session
   keeps it until the JWT expires.
2. **No RLS.** Access control is enforced in application code (`lib/authz.ts`)
   rather than by the database. Chosen so password hashing lives in this repo
   and is auditable, and because granting anonymous token-holders row access
   through RLS requires custom JWT claims or security-definer RPCs — fiddly for
   precisely the guest flow that matters most. The mitigation is that every read
   and write routes through one small, unit-tested module and the service-role
   key never leaves the server. A production system should add RLS as
   defence in depth.
3. **No OCR.** Scanned PDFs are detected and reported rather than processed.
4. **Staged ingestion stands in for a job queue.** It is shaped around Vercel's
   60-second limit. A real queue (or a long-running worker) would be cleaner.
5. **Comment threading is one level deep.** Replies attach to top-level comments
   only. A reply-to-a-reply is flattened onto the same thread rather than nesting
   further, so a crafted request cannot produce unbounded indentation.
6. **No end-to-end browser test in CI.** The full journey was verified manually
   in a browser against the real database, storage, and Gemini, but it is not
   automated. A Playwright spec is the obvious next addition.
7. **The token estimator is an approximation** (~4 characters per token) rather
   than a real tokenizer. It only routes threshold decisions, never billing, and
   the 40k threshold has ample headroom.
8. **Function region matters.** The Supabase project is in `ap-northeast-1`
   (Tokyo). Vercel functions default to `iad1` (US East), which adds ~150–200ms
   per query. Set the Vercel function region to `hnd1` to co-locate them.

### Bugs found during development

Recorded because they are the interesting part of the work:

- The **chunker exceeded its own ceiling by 2×** — overlap re-queued the last
  whole segment, so a pre-split oversized paragraph prepended ~1400 tokens.
  Caught by the ceiling test.
- **Every summary would have been truncated mid-sentence** — thinking tokens
  consumed the output budget. Caught only by running the real API.
- **The planned similarity floor would have broken semantic search** — unrelated
  text scores above it. Caught by measuring against the live API.
- **`deleteDocument` was an access-control hole** — it filtered on document id
  alone, letting any signed-in user delete any document.
- **A hydration mismatch on every dashboard card** — `toLocaleDateString` with
  an undefined locale resolves differently on server and client.
