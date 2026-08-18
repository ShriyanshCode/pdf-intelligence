import {
  pgTable, uuid, text, integer, boolean, timestamp, vector, index, uniqueIndex, check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const documentStatuses = [
  'uploading', 'extracting', 'summarizing', 'indexing', 'ready', 'failed',
] as const;
export type DocumentStatus = (typeof documentStatuses)[number];

/**
 * Emails are plain `text` rather than citext, normalized to lowercase at every
 * write by normalizeEmail() in lib/auth.ts. This avoids depending on a Postgres
 * extension and keeps the column natively typed in Drizzle.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('users_email_key').on(t.email)]);

/**
 * Single-use password reset tokens.
 *
 * Only a SHA-256 hash of the token is stored, never the token itself, so read
 * access to this table cannot be turned into account takeover. SHA-256 rather
 * than bcrypt is correct here: the token is 256 bits of randomness, so there is
 * nothing to brute-force, and lookup needs to be deterministic.
 */
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('password_reset_token_hash_key').on(t.tokenHash),
  index('password_reset_user_idx').on(t.userId),
]);

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
  // 768 rather than the model's native 3072: pgvector's HNSW index caps at 2000
  // dimensions. Vectors are L2-normalized in lib/ai/embed.ts because truncated
  // Gemini embeddings do not arrive unit-length.
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

/**
 * parentId is declared without an inline .references() call: a self-reference
 * needs a separate ALTER TABLE in the generated SQL, added by hand in the
 * migration.
 */
export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id'),
  body: text('body').notNull(),
  authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
  authorShareId: uuid('author_share_id').references(() => shares.id, { onDelete: 'set null' }),
  // Denormalized at write time so a revoked share still shows who wrote what.
  authorLabel: text('author_label').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('comments_document_created_idx').on(t.documentId, t.createdAt),
  check('comments_author_present', sql`${t.authorUserId} IS NOT NULL OR ${t.authorShareId} IS NOT NULL`),
]);

/**
 * sessionKey is 'user:<uuid>' for owners or 'share:<share_id>' for guests, so two
 * guests holding different tokens for the same document never see each other's
 * questions. Built by sessionKeyFor() in lib/authz.ts.
 */
export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  sessionKey: text('session_key').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('chat_session_created_idx').on(t.sessionKey, t.createdAt)]);
