import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

/**
 * prepare:false is mandatory, not an optimization: DATABASE_URL points at
 * Supabase's Supavisor pooler in transaction mode, which does not support
 * prepared statements.
 */
const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });
export { schema };
