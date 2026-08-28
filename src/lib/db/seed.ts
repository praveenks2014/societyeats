/**
 * CLI entrypoint: npm run db:seed
 * Loads .env manually (tsx does not), connects via DATABASE_URL or the PGlite
 * fallback, and force-seeds if the database is empty.
 */
import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv() {
  const file = path.join(process.cwd(), '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

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
