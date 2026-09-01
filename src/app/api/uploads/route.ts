import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { api, ApiError, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
// Pilot Hardening v2 — Phase 5 (Trust & hygiene, DECISIONS.md #73+): the
// optional 20-sec kitchen video reuses this same local-uploads endpoint
// rather than a separate route — same storage, just a different type/size
// allowance. 15 MB comfortably covers a 20s clip at phone-camera bitrates.
const VIDEO_TYPES = ['video/mp4', 'video/webm'];
const VIDEO_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Local uploads to /public/uploads (works on Replit). For production scale,
 * swap this handler for Replit Object Storage or S3 — see README.
 */
export const POST = api(async (req) => {
  await requireSession();
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new ApiError(400, 'No file');
  const isVideo = VIDEO_TYPES.includes(file.type);
  if (!IMAGE_TYPES.includes(file.type) && !isVideo) {
    throw new ApiError(400, 'Only JPG, PNG, WebP images or MP4/WebM video');
  }
  const maxBytes = isVideo ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES;
  if (file.size > maxBytes) {
    throw new ApiError(400, `Max file size is ${Math.round(maxBytes / (1024 * 1024))} MB`);
  }

  const ext =
    file.type === 'image/png'
      ? 'png'
      : file.type === 'image/webp'
        ? 'webp'
        : file.type === 'video/mp4'
          ? 'mp4'
          : file.type === 'video/webm'
            ? 'webm'
            : 'jpg';
  const name = `${crypto.randomBytes(10).toString('hex')}.${ext}`;
  const dir = path.join(process.cwd(), 'public', 'uploads');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
  return ok({ url: `/uploads/${name}` });
});
