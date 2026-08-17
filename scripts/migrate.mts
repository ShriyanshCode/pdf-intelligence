/**
 * Applies the SQL migrations in drizzle/ to the database.
 *
 *   npx tsx --env-file=.env.local scripts/migrate.mts
 *
 * Used instead of `drizzle-kit push` because push pulls the existing schema and
 * prompts for confirmation, which hangs in a non-interactive shell. Migrations
 * also leave a reviewable SQL file in the repo.
 *
 * Connects over DIRECT_URL (session pooler): DDL needs a real session, and the
 * transaction pooler cannot run it.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('Set DIRECT_URL (or DATABASE_URL) in .env.local');

// max:1 because migrations must all run on one connection, in order.
const client = postgres(url, { max: 1, prepare: false });

try {
  await migrate(drizzle(client), { migrationsFolder: './drizzle' });
  console.log('OK: migrations applied');
} finally {
  await client.end();
}
