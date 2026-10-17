import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { ApiError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { files } from '@/lib/db/schema';
import { getStorage } from './index';

export type UploadPurpose =
  | 'dish'
  | 'kitchen'
  | 'kitchen_video'
  | 'fssai_doc'
  | 'id_proof'
  | 'address_proof'
  | 'complaint'
  | 'attachment'
  | 'fssai_content';

export type Detected = { mime: string; ext: string; kind: 'image' | 'video' | 'pdf' };

/** Sniff the real type from magic bytes; the client-supplied MIME is never trusted. */
export function detectType(b: Buffer): Detected | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg', kind: 'image' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png', kind: 'image' };
  if (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: 'webp', kind: 'image' };
  if (b.subarray(0, 5).toString('ascii') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf', kind: 'pdf' };
  if (b.subarray(4, 8).toString('ascii') === 'ftyp') return { mime: 'video/mp4', ext: 'mp4', kind: 'video' };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { mime: 'video/webm', ext: 'webm', kind: 'video' };
  return null;
}

export const SIZE_LIMITS = { image: 6 * 1024 * 1024, video: 15 * 1024 * 1024, pdf: 8 * 1024 * 1024 } as const;
export const MAX_IMAGE_DIM = 1600;

/** Strips EXIF/GPS (sharp drops metadata unless asked to keep it), applies orientation, caps at 1600px. */
export async function sanitizeImage(buf: Buffer, mime: string): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  let p = sharp(buf, { failOn: 'error' }).rotate().resize({ width: MAX_IMAGE_DIM, height: MAX_IMAGE_DIM, fit: 'inside', withoutEnlargement: true });
  if (mime === 'image/png') p = p.png();
  else if (mime === 'image/webp') p = p.webp({ quality: 85 });
  else p = p.jpeg({ quality: 85, mozjpeg: true });
  return p.toBuffer();
}

// ---- encryption at rest for ID / address proofs (AES-256-GCM) ----
function docKey(): Buffer {
  const raw = process.env.DOC_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!raw) throw new Error('DOC_ENCRYPTION_KEY (or JWT_SECRET) is required to encrypt documents');
  return crypto.createHash('sha256').update(`padosi-doc-key:${raw}`).digest();
}
export function encryptBytes(plain: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', docKey(), iv);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}
export function decryptBytes(blob: Buffer): Buffer {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const d = crypto.createDecipheriv('aes-256-gcm', docKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}

export type SaveOpts = {
  ownerId: number | null;
  purpose: UploadPurpose;
  buffer: Buffer;
  visibility: 'public' | 'private';
  encrypt?: boolean;
  deleteAfter?: Date | null;
  allowed: ('image' | 'video' | 'pdf')[];
};

/** Validate, sanitise, store and register a file. Returns its serving URL. */
export async function saveUpload(o: SaveOpts): Promise<{ key: string; url: string; contentType: string }> {
  const det = detectType(o.buffer);
  if (!det || !o.allowed.includes(det.kind)) {
    throw new ApiError(400, `Unsupported file. Allowed: ${o.allowed.map((k) => (k === 'image' ? 'JPG/PNG/WebP image' : k === 'video' ? 'MP4/WebM video' : 'PDF')).join(', ')}`);
  }
  if (o.buffer.length > SIZE_LIMITS[det.kind]) {
    throw new ApiError(400, `Max file size is ${Math.round(SIZE_LIMITS[det.kind] / (1024 * 1024))} MB`);
  }
  let body = o.buffer;
  if (det.kind === 'image') {
    try {
      body = await sanitizeImage(o.buffer, det.mime);
    } catch {
      throw new ApiError(400, 'That image could not be read — try another photo');
    }
  }
  const key = `${crypto.randomBytes(12).toString('hex')}.${det.ext}`;
  const stored = o.encrypt ? encryptBytes(body) : body;
  const storage = await getStorage();
  await storage.put(key, stored, o.encrypt ? 'application/octet-stream' : det.mime);
  const db = await getDb();
  await db.insert(files).values({
    key,
    ownerId: o.ownerId,
    purpose: o.purpose,
    visibility: o.visibility,
    contentType: det.mime,
    sizeBytes: body.length,
    encrypted: !!o.encrypt,
    deleteAfter: o.deleteAfter ?? null,
  });
  return { key, url: fileUrl(key), contentType: det.mime };
}

export function fileUrl(key: string): string {
  return `/api/files/${key}`;
}

export function keyFromUrl(url: string | null | undefined): string | null {
  const m = url?.match(/^\/api\/files\/([a-f0-9]{24}\.[a-z0-9]{2,4})$/);
  return m ? m[1] : null;
}

/** Remove a stored object and its metadata row. */
export async function deleteFile(key: string): Promise<void> {
  const db = await getDb();
  await (await getStorage()).delete(key);
  await db.delete(files).where(eq(files.key, key));
}
