import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { api, ApiError, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Local uploads to /public/uploads (works on Replit). For production scale,
 * swap this handler for Replit Object Storage or S3 — see README.
 */
export const POST = api(async (req) => {
  await requireSession();
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new ApiError(400, 'No file');
  if (!ALLOWED.includes(file.type)) throw new ApiError(400, 'Only JPG, PNG or WebP images');
  if (file.size > MAX_BYTES) throw new ApiError(400, 'Max file size is 4 MB');

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const name = `${crypto.randomBytes(10).toString('hex')}.${ext}`;
  const dir = path.join(process.cwd(), 'public', 'uploads');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
  return ok({ url: `/uploads/${name}` });
});
