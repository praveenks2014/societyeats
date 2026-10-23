import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '@/lib/db/schema';
import type { Db } from '@/lib/db';

/** Fresh in-memory Postgres (PGlite) with every migration applied, installed as the app's db singleton. */
export async function useTestDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  (globalThis as { __padosiDb?: unknown }).__padosiDb = Promise.resolve(db);
  return db as unknown as Db;
}
