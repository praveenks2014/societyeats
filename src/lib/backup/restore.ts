import { sql } from 'drizzle-orm';
import { rowsOf, type Db } from '@/lib/db';
import { appTables, migrationState, parseLogical, type Manifest } from './format';

const q = (name: string) => sql.identifier(name);

export type RestoreReport = { manifest: Manifest; counts: { table: string; expected: number; restored: number }[] };

/** The row count of every app table: restore into a database where any of them is non-zero is refused. */
export async function tableRowCounts(db: Db): Promise<{ table: string; rows: number }[]> {
  const out: { table: string; rows: number }[] = [];
  for (const t of await appTables(db)) {
    const n = rowsOf<{ n: number }>(await db.execute(sql`select count(*)::int as n from ${q(t)}`))[0]?.n ?? 0;
    out.push({ table: t, rows: n });
  }
  return out;
}

/**
 * Restores a logical backup into an EMPTY database whose schema is the same migration level as the backup. All or nothing (one transaction).
 * Refuses a non-empty database (any app table with rows) and a schema mismatch.
 */
export async function restoreLogical(db: Db, gz: Buffer): Promise<RestoreReport> {
  const { manifest, rowsByTable } = parseLogical(gz);
  const target = await migrationState(db);
  if (manifest.migrationHash && target.migrationHash && manifest.migrationHash !== target.migrationHash) {
    throw new Error(`Schema mismatch: the backup was taken at migration ${manifest.schemaVersion}, this database is at ${target.schemaVersion}. Restore with the same app version.`);
  }
  const present = new Set(await appTables(db));
  const missing = manifest.tables.map((t) => t.name).filter((n) => !present.has(n));
  if (missing.length) throw new Error(`The database is missing tables from the backup (${missing.slice(0, 5).join(', ')}). Apply the migrations first.`);
  const filled = (await tableRowCounts(db)).filter((t) => t.rows > 0);
  if (filled.length) throw new Error(`Refusing to restore: the database is not empty (${filled.map((t) => `${t.table}=${t.rows}`).slice(0, 6).join(', ')}). Restore into a new, empty database.`);

  await db.transaction(async (tx) => {
    for (const t of manifest.tables) {
      const rows = rowsByTable.get(t.name) ?? [];
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = JSON.stringify(rows.slice(i, i + 500));
        await tx.execute(sql`insert into ${q(t.name)} select * from json_populate_recordset(null::${q(t.name)}, ${chunk}::json)`);
      }
    }
    // serial / identity columns continue after the highest restored id
    const seqs = rowsOf<{ table_name: string; column_name: string }>(
      await tx.execute(sql`select table_name, column_name from information_schema.columns where table_schema = 'public' and column_default like 'nextval(%'`),
    );
    for (const { table_name, column_name } of seqs) {
      await tx.execute(
        sql`select setval(pg_get_serial_sequence(${`"${table_name}"`}, ${column_name}), coalesce((select max(${q(column_name)}) from ${q(table_name)}), 1), (select max(${q(column_name)}) is not null from ${q(table_name)}))`,
      );
    }
  });

  const after = new Map((await tableRowCounts(db)).map((t) => [t.table, t.rows]));
  const counts = manifest.tables.map((t) => ({ table: t.name, expected: t.rows, restored: after.get(t.name) ?? 0 }));
  const bad = counts.filter((c) => c.expected !== c.restored);
  if (bad.length) throw new Error(`Row counts differ after restore: ${bad.map((b) => `${b.table} ${b.restored}/${b.expected}`).join(', ')}`);
  return { manifest, counts };
}
