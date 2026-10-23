/**
 * npm run db:bootstrap — idempotent production bootstrap.
 *   1. runs migrations
 *   2. upserts platform config defaults
 *   3. creates the ADMIN_EMAILS accounts (random one-time password, printed once)
 *   4. seeds the launch subscription plan and FSSAI walkthrough content
 * Creates no demo users.
 */
import { loadDotEnv } from '../src/lib/dotenv';

async function main() {
  loadDotEnv();
  const { runMigrations, runBootstrap } = await import('../src/lib/bootstrap');
  const { getDb } = await import('../src/lib/db');
  await runMigrations();
  const db = await getDb();
  const report = await runBootstrap(db);
  for (const a of report.adminsCreated) {
    console.log('\n================ ONE-TIME ADMIN PASSWORD ================');
    console.log(`  ${a.email}  →  ${a.password}`);
    console.log('  You will be forced to change it at first login.');
    console.log('==========================================================\n');
  }
  if (report.adminsCreated.length === 0) console.log('bootstrap: no new admin accounts needed.');
  console.log('bootstrap: done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('bootstrap failed:', err);
  process.exit(1);
});
