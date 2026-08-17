/**
 * Dev utility: how many Postgres connections are open, and what the server allows.
 *
 *   npx tsx --env-file=.env.local scripts/inspect-connections.mts
 *
 * Serverless functions multiply connections quickly. If `used` approaches
 * `max_connections`, queries start failing under load.
 */
import { sql } from 'drizzle-orm';
import { db } from '../lib/db';

const [{ max_connections }] = await db.execute<{ max_connections: string }>(
  sql`SELECT setting AS max_connections FROM pg_settings WHERE name = 'max_connections'`,
);

const [{ used }] = await db.execute<{ used: number }>(
  sql`SELECT count(*)::int AS used FROM pg_stat_activity`,
);

const byState = await db.execute<{ state: string | null; n: number }>(
  sql`SELECT state, count(*)::int AS n FROM pg_stat_activity GROUP BY state ORDER BY n DESC`,
);

const byApp = await db.execute<{ application_name: string; n: number }>(
  sql`SELECT coalesce(nullif(application_name, ''), '(none)') AS application_name,
             count(*)::int AS n
        FROM pg_stat_activity GROUP BY 1 ORDER BY n DESC LIMIT 10`,
);

console.log({ max_connections: Number(max_connections), used, headroom: Number(max_connections) - used });
console.log('by state:', byState);
console.log('by application:', byApp);

process.exit(0);
