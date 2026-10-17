import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Production (Replit Autoscale): PostgreSQL via DATABASE_URL with the
 * postgres-js driver. DATABASE_URL is REQUIRED when NODE_ENV=production — the
 * app fails fast instead of silently falling back to a throw-away embedded
 * database.
 *
 * Local dev only: when DATABASE_URL is unset, an embedded PGlite (WASM
 * Postgres) database is created at ./.data/pglite, migrated from ./drizzle
 * and seeded with demo data automatically. Both paths speak the same Drizzle
 * API.
 */

export type Db = ReturnType<typeof drizzlePostgres<typeof schema>>;

const g = globalThis as unknown as { __padosiDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!g.__padosiDb) g.__padosiDb = initDb();
  return g.__padosiDb;
}

/** `db.execute()` returns an array on postgres-js and `{ rows }` on PGlite. */
export function rowsOf<T = Record<string, unknown>>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const rows = (res as { rows?: T[] } | null)?.rows;
  return rows ?? [];
}

export function requireDatabaseUrlInProduction(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is required when NODE_ENV=production. On Replit, add the PostgreSQL tool (it sets DATABASE_URL for you).',
    );
  }
}

async function initDb(): Promise<Db> {
  requireDatabaseUrlInProduction();
  const url = process.env.DATABASE_URL;
  if (url) {
    const client = postgres(url, { max: 5, onnotice: () => {} });
    return drizzlePostgres(client, { schema });
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const path = await import('node:path');
  const fs = await import('node:fs');

  const dataDir = process.env.PGLITE_DIR || path.join(process.cwd(), '.data', 'pglite');
  fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  await migrate(db as never, {
    migrationsFolder: path.join(process.cwd(), 'drizzle'),
  });
  if (process.env.SKIP_DEMO_SEED !== 'true') {
    const { seedIfEmpty } = await import('./seed-data');
    await seedIfEmpty(db);
  }
  return db;
}
