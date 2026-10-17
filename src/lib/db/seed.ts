/**
 * CLI entrypoint: npm run db:seed
 * Loads .env manually (tsx does not), connects via DATABASE_URL or the PGlite
 * fallback, and force-seeds if the database is empty.
 */
import { loadDotEnv } from '../dotenv';

async function main() {
  loadDotEnv();
  const { getDb } = await import('./index');
  const { seedIfEmpty } = await import('./seed-data');
  const db = await getDb();
  await seedIfEmpty(db);
  console.log('db:seed done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
