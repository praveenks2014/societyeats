/**
 * npm run db:push
 * - With DATABASE_URL (Replit/production): runs `drizzle-kit push` against Postgres.
 * - Without it (local dev): applies the committed ./drizzle migrations to the
 *   embedded PGlite database at ./.data/pglite.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv() {
  const file = path.join(process.cwd(), '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

loadDotEnv();

if (process.env.DATABASE_URL) {
  console.log('DATABASE_URL found — running drizzle-kit push against Postgres…');
  const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(bin, ['drizzle-kit', 'push', '--force'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exit(result.status ?? 0);
} else {
  console.log('No DATABASE_URL — applying migrations to embedded PGlite at ./.data/pglite…');
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const dataDir = path.join(process.cwd(), '.data', 'pglite');
  fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  await client.close();
  console.log('PGlite schema up to date.');
  process.exit(0);
}
