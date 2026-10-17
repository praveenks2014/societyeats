import path from 'node:path';
import { log } from '@/lib/log';
import type { Db } from '@/lib/db';

/** Applies ./drizzle migrations to whichever database getDb() resolves to. */
export async function runMigrations(): Promise<void> {
  const migrationsFolder = path.join(process.cwd(), 'drizzle');
  const url = process.env.DATABASE_URL;
  if (url) {
    const postgres = (await import('postgres')).default;
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    const client = postgres(url, { max: 1, onnotice: () => {} });
    try {
      await migrate(drizzle(client), { migrationsFolder });
    } finally {
      await client.end();
    }
  }
  // PGlite (dev / e2e): getDb() migrates on first connect, nothing to do here.
}

export type BootstrapReport = { adminsCreated: { email: string; password: string }[] };

/**
 * Idempotent production bootstrap: platform config defaults, subscription
 * plan, admin accounts, FSSAI walkthrough content. Creates NO demo users.
 * Steps register themselves below as the features land.
 */
export async function runBootstrap(db: Db): Promise<BootstrapReport> {
  const report: BootstrapReport = { adminsCreated: [] };
  const { seedPlatformDefaults } = await import('@/lib/db/platform');
  await seedPlatformDefaults();
  const { ensureAdminAccounts } = await import('@/lib/auth/admins');
  report.adminsCreated = await ensureAdminAccounts(db);
  log.info('bootstrap.done', { adminsCreated: report.adminsCreated.length });
  return report;
}
