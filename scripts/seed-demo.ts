/** npm run db:seed:demo — loads the demo society, kitchens and buyers. Refuses to run in production. */
import { loadDotEnv } from '../src/lib/dotenv';

async function main() {
  loadDotEnv();
  if (process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT) {
    console.error('db:seed:demo refuses to run in production.');
    process.exit(1);
  }
  const { getDb } = await import('../src/lib/db');
  const { seedIfEmpty } = await import('../src/lib/db/seed-data');
  await seedIfEmpty(await getDb());
  console.log('db:seed:demo done.');
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
