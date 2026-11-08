import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { sql } from 'drizzle-orm';
import { rowsOf, type Db } from '@/lib/db';

/**
 * Logical backup format (used when pg_dump is not available): ONE gzipped file of JSON lines.
 *   line 1      {"manifest": {format, createdAt, schemaVersion, migrationHash, tables:[{name, rows}]}}   (tables in dependency order)
 *   then        {"t": "<table>", "r": {<row as Postgres jsonb>}}
 * Rows are exported with Postgres' own `to_jsonb`, so every column type round-trips exactly, and encrypted columns are copied as the
 * ciphertext that is stored (nothing is ever decrypted). Uploaded files in Object Storage are not part of this database backup.
 */
export type Manifest = {
  format: 1;
  createdAt: string;
  schemaVersion: number | null;
  migrationHash: string | null;
  tables: { name: string; rows: number }[];
  /** tables that sit in a foreign-key cycle (restored with constraints deferred by row ordering where possible) */
  cyclic: string[];
};

const q = (name: string) => sql.identifier(name);

export async function appTables(db: Db): Promise<string[]> {
  const res = await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`);
  return rowsOf<{ table_name: string }>(res).map((r) => r.table_name);
}

/** Tables ordered so that a table comes after every table it references (Kahn's algorithm; cycles are appended and reported). */
export async function dependencyOrder(db: Db): Promise<{ order: string[]; cyclic: string[] }> {
  const tables = await appTables(db);
  const res = await db.execute(sql`
    select c.relname as child, p.relname as parent
    from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_class p on p.oid = k.confrelid
    where k.contype = 'f' and c.relnamespace = 'public'::regnamespace`);
  const deps = new Map<string, Set<string>>(tables.map((t) => [t, new Set<string>()]));
  for (const { child, parent } of rowsOf<{ child: string; parent: string }>(res)) if (child !== parent && deps.has(child) && deps.has(parent)) deps.get(child)!.add(parent);
  const order: string[] = [];
  const left = new Set(tables);
  while (left.size) {
    const ready = [...left].filter((t) => [...deps.get(t)!].every((p) => !left.has(p))).sort();
    if (!ready.length) break;
    for (const t of ready) {
      order.push(t);
      left.delete(t);
    }
  }
  const cyclic = [...left].sort();
  return { order: [...order, ...cyclic], cyclic };
}

/** The schema version of a database: how many migrations are applied and a hash over all of them. */
export async function migrationState(db: Db): Promise<{ schemaVersion: number | null; migrationHash: string | null }> {
  try {
    const res = await db.execute(sql`select hash from drizzle.__drizzle_migrations order by id`);
    const hashes = rowsOf<{ hash: string }>(res).map((r) => r.hash);
    return { schemaVersion: hashes.length, migrationHash: crypto.createHash('sha256').update(hashes.join('|')).digest('hex') };
  } catch {
    return { schemaVersion: null, migrationHash: null };
  }
}

export async function exportLogical(db: Db, now: Date = new Date()): Promise<{ gz: Buffer; manifest: Manifest; rows: number }> {
  const { order, cyclic } = await dependencyOrder(db);
  const state = await migrationState(db);
  const lines: string[] = [];
  const tables: Manifest['tables'] = [];
  let total = 0;
  for (const t of order) {
    const rows = rowsOf<{ r: unknown }>(await db.execute(sql`select to_jsonb(x) as r from ${q(t)} x`));
    for (const { r } of rows) lines.push(JSON.stringify({ t, r }));
    tables.push({ name: t, rows: rows.length });
    total += rows.length;
  }
  const manifest: Manifest = { format: 1, createdAt: now.toISOString(), ...state, tables, cyclic };
  const gz = zlib.gzipSync(Buffer.from([JSON.stringify({ manifest }), ...lines].join('\n') + '\n'));
  return { gz, manifest, rows: total };
}

/** Reads a logical backup file. Throws if it is not one. */
export function parseLogical(gz: Buffer): { manifest: Manifest; rowsByTable: Map<string, unknown[]> } {
  const lines = zlib.gunzipSync(gz).toString('utf8').split('\n').filter(Boolean);
  const first = JSON.parse(lines[0] ?? '{}') as { manifest?: Manifest };
  if (!first.manifest || first.manifest.format !== 1) throw new Error('This is not a PadosiPlate logical backup (format 1).');
  const rowsByTable = new Map<string, unknown[]>(first.manifest.tables.map((t) => [t.name, []]));
  for (const line of lines.slice(1)) {
    const { t, r } = JSON.parse(line) as { t: string; r: unknown };
    rowsByTable.get(t)?.push(r);
  }
  return { manifest: first.manifest, rowsByTable };
}
