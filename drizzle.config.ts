import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Load .env.local explicitly. `dotenv/config` would read .env, which we do not use.
config({ path: '.env.local' });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('Set DIRECT_URL (or DATABASE_URL) in .env.local');

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  // Session pooler (port 5432), NOT the transaction pooler: DDL such as
  // CREATE EXTENSION and CREATE INDEX needs a real session.
  dbCredentials: { url },
});
