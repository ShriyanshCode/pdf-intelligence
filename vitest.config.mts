import { defineConfig } from 'vitest/config';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';

/**
 * Several modules under test transitively import lib/db, which throws at module
 * scope when DATABASE_URL is missing. Loading .env.local here keeps those imports
 * resolvable. No connection is opened: postgres.js connects lazily on first query,
 * and the unit suite never issues one.
 */
loadEnv({ path: '.env.local' });

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Forks emit a spurious "kill EPERM" teardown error on Windows after the run
    // has already reported. Threads avoid it and start faster.
    pool: 'threads',
  },
  resolve: {
    // Mirrors the "@/*" path alias in tsconfig.json so tests import the same way
    // application code does.
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
});
