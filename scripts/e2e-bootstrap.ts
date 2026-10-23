/** Prepares the throw-away E2E database: production bootstrap + two test societies. Not used outside tests. */
import { loadDotEnv } from '../src/lib/dotenv';

async function main() {
  loadDotEnv();
  process.env.PGLITE_DIR ||= '.data/e2e/pglite';
  process.env.SKIP_DEMO_SEED = 'true';
  process.env.ADMIN_EMAILS ||= 'e2e-admin@example.com';
  process.env.ADMIN_BOOTSTRAP_PASSWORD ||= 'E2e-first-pass-1';
  const { getDb } = await import('../src/lib/db');
  const { runBootstrap } = await import('../src/lib/bootstrap');
  const { societies } = await import('../src/lib/db/schema');
  const { setPlatformSetting } = await import('../src/lib/db/platform');
  const db = await getDb();
  await runBootstrap(db);
  await db.insert(societies).values([
    { name: 'E2E Heights', city: 'Hyderabad', lat: 17.465, lng: 78.31, addressText: 'E2E Heights, Nallagandla', pincode: '500019', inviteCode: 'E2E-ONE', isLive: true },
    { name: 'E2E Meadows', city: 'Hyderabad', lat: 17.455, lng: 78.32, addressText: 'E2E Meadows, Nallagandla', pincode: '500019', inviteCode: 'E2E-TWO', isLive: true },
  ]);
  // The platform's own FSSAI registration is required for live (non-mock) orders; harmless in mock mode.
  await setPlatformSetting('platformFssaiCentralLicenseNo', '12345678901234');
  console.log('e2e bootstrap done');
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
