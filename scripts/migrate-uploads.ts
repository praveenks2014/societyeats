/**
 * npm run uploads:migrate — one-off: moves files from the old public/uploads
 * directory into the configured StorageAdapter, registers them in `files`, and
 * rewrites every stored `/uploads/<name>` URL in the database to
 * `/api/files/<key>`. Safe to re-run.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadDotEnv } from '../src/lib/dotenv';

async function main() {
  loadDotEnv();
  const { sql } = await import('drizzle-orm');
  const { getDb } = await import('../src/lib/db');
  const { getStorage } = await import('../src/lib/storage');
  const { detectType } = await import('../src/lib/storage/files');
  const { files } = await import('../src/lib/db/schema');
  const db = await getDb();
  const storage = await getStorage();

  const dir = path.join(process.cwd(), 'public', 'uploads');
  if (!fs.existsSync(dir)) {
    console.log('No public/uploads directory — nothing to migrate.');
    process.exit(0);
  }
  const map = new Map<string, string>();
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const buf = fs.readFileSync(path.join(dir, name));
    const det = detectType(buf);
    if (!det) {
      console.warn('skip (unknown type):', name);
      continue;
    }
    const key = `${crypto.randomBytes(12).toString('hex')}.${det.ext}`;
    await storage.put(key, buf, det.mime);
    // Certificates were stored alongside photos; treat PDFs as private, everything else public.
    await db.insert(files).values({ key, ownerId: null, purpose: det.kind === 'pdf' ? 'fssai_doc' : 'dish', visibility: det.kind === 'pdf' ? 'private' : 'public', contentType: det.mime, sizeBytes: buf.length });
    map.set(`/uploads/${name}`, `/api/files/${key}`);
    console.log('moved', name, '→', key);
  }

  // Rewrite references. Plain text columns first, then JSON columns via text cast.
  for (const [oldUrl, newUrl] of map) {
    await db.execute(sql`UPDATE listings SET photo_url = ${newUrl} WHERE photo_url = ${oldUrl}`);
    await db.execute(sql`UPDATE seller_profiles SET kitchen_video_url = ${newUrl} WHERE kitchen_video_url = ${oldUrl}`);
    await db.execute(sql`UPDATE seller_profiles SET fssai_certificate_url = ${newUrl} WHERE fssai_certificate_url = ${oldUrl}`);
    await db.execute(sql`UPDATE complaints SET photo_url = ${newUrl} WHERE photo_url = ${oldUrl}`);
    await db.execute(sql`UPDATE seller_profiles SET kitchen_photos_json = replace(kitchen_photos_json::text, ${oldUrl}, ${newUrl})::jsonb WHERE kitchen_photos_json::text LIKE ${'%' + oldUrl + '%'}`);
    await db.execute(sql`UPDATE fssai_applications SET documents_json = replace(documents_json::text, ${oldUrl}, ${newUrl})::jsonb WHERE documents_json::text LIKE ${'%' + oldUrl + '%'}`);
  }
  console.log(`Migrated ${map.size} file(s). You can now delete public/uploads.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
