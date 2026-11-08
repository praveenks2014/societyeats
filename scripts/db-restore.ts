/**
 * npm run db:restore -- [<backup-key>]
 * Restores a backup from Object Storage into an EMPTY database (a new Replit database works: migrations are applied first).
 * Without a key it uses the newest backup in `backups/index.json`. Refuses if any app table already has rows.
 *   logical backups (.jsonl.gz): restored in one transaction, row counts checked against the manifest
 *   pg_dump backups (.sql.gz):   piped to psql (needs psql), only into a database with no tables at all
 */
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import { loadDotEnv } from '../src/lib/dotenv';

async function main() {
  loadDotEnv();
  process.env.SKIP_DEMO_SEED = 'true'; // never seed demo data into a database we are about to restore
  const { runMigrations } = await import('../src/lib/bootstrap');
  const { getDb } = await import('../src/lib/db');
  const { getStorage } = await import('../src/lib/storage');
  const { readIndex } = await import('../src/lib/backup/run');
  const { appTables } = await import('../src/lib/backup/format');
  const { restoreLogical, tableRowCounts } = await import('../src/lib/backup/restore');

  const storage = await getStorage();
  let key = process.argv.slice(2).find((a) => !a.startsWith('-'));
  if (!key) {
    const latest = (await readIndex()).sort((a, b) => b.at.localeCompare(a.at))[0];
    if (!latest) throw new Error('No backup key given and backups/index.json is empty.');
    key = latest.key;
    console.log(`No key given: using the newest backup, ${key}`);
  }
  const gz = await storage.get(key);
  if (!gz) throw new Error(`Backup not found in storage: ${key}`);

  if (key.endsWith('.sql.gz')) {
    const db = await getDb();
    if ((await appTables(db)).length) throw new Error('A pg_dump backup can only be restored into a database with no tables. Create a new, empty database.');
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required to restore a pg_dump backup.');
    const r = spawnSync('psql', ['--set', 'ON_ERROR_STOP=1', url], { input: zlib.gunzipSync(gz), stdio: ['pipe', 'inherit', 'inherit'] });
    if (r.status !== 0) throw new Error('psql failed (is it installed?). Nothing more was done.');
  } else {
    await runMigrations(); // an empty database gets the schema first; a database that already has it is left as is
    const report = await restoreLogical(await getDb(), gz);
    console.log(`Backup taken ${report.manifest.createdAt}, schema migration ${report.manifest.schemaVersion}.`);
  }
  console.log('\nRows per table after the restore:');
  for (const t of await tableRowCounts(await getDb())) console.log(`  ${t.table.padEnd(34)} ${t.rows}`);
  console.log('\nrestore: done. Next: set DATABASE_URL to this database in Secrets, redeploy, then check /api/health and log in as an admin.');
  process.exit(0);
}

main().catch((e) => {
  console.error('restore failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
