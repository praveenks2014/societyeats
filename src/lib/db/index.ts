import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Primary path (Replit / production): PostgreSQL via DATABASE_URL with the
 * postgres-js driver (no native binaries).
 *
 * Zero-config dev fallback: when DATABASE_URL is unset, an embedded PGlite
 * (WASM Postgres) database is created at ./.data/pglite, migrated from
 * ./drizzle and seeded automatically — `npm run dev` alone gives a fully
 * working demo. Both paths speak the same Drizzle API.
 */

export type Db = ReturnType<typeof drizzlePostgres<typeof schema>>;

const g = globalThis as unknown as { __padosiDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!g.__padosiDb) g.__padosiDb = initDb();
  return g.__padosiDb;
}

async function initDb(): Promise<Db> {
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

  const dataDir = path.join(process.cwd(), '.data', 'pglite');
  fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  await migrate(db as never, {
    migrationsFolder: path.join(process.cwd(), 'drizzle'),
  });
  const { seedIfEmpty } = await import('./seed-data');
  await seedIfEmpty(db);
  return db;
}
