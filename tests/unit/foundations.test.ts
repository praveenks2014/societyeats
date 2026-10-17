import { beforeAll, describe, expect, test } from 'vitest';
import sharp from 'sharp';
import { useTestDb } from '../helpers/db';
import { decryptBytes, detectType, encryptBytes, sanitizeImage } from '@/lib/storage/files';

describe('rate limiter (postgres-backed)', () => {
  beforeAll(async () => {
    await useTestDb();
  });

  test('allows up to the limit then throws 429, per key', async () => {
    const { rateLimit } = await import('@/lib/rate-limit');
    for (let i = 0; i < 3; i++) await rateLimit('t:a', { limit: 3, windowMs: 60_000 });
    await expect(rateLimit('t:a', { limit: 3, windowMs: 60_000 })).rejects.toMatchObject({ status: 429 });
    await expect(rateLimit('t:b', { limit: 3, windowMs: 60_000 })).resolves.toBeUndefined();
  });

  test('window resets after it expires', async () => {
    const { rateLimit } = await import('@/lib/rate-limit');
    await rateLimit('t:c', { limit: 1, windowMs: 1000 });
    await expect(rateLimit('t:c', { limit: 1, windowMs: 1000 })).rejects.toMatchObject({ status: 429 });
    await new Promise((r) => setTimeout(r, 1100));
    await expect(rateLimit('t:c', { limit: 1, windowMs: 1000 })).resolves.toBeUndefined();
  });
});

describe('upload validation', () => {
  test('detects type from magic bytes, ignoring any claimed MIME', () => {
    expect(detectType(Buffer.from('%PDF-1.7 hello world'))?.kind).toBe('pdf');
    expect(detectType(Buffer.from('MZ\u0090 not an image at all'))).toBeNull();
    expect(detectType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))?.mime).toBe('image/jpeg');
  });

  test('images are resized to max 1600px and EXIF/GPS is stripped', async () => {
    const big = await sharp({ create: { width: 3200, height: 2000, channels: 3, background: '#e8a020' } })
      .withExif({ IFD0: { Copyright: 'secret-owner' }, IFD3: { GPSLatitudeRef: 'N' } })
      .jpeg()
      .toBuffer();
    expect((await sharp(big).metadata()).exif).toBeTruthy();
    const out = await sanitizeImage(big, 'image/jpeg');
    const meta = await sharp(out).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(1600);
    expect(meta.exif).toBeUndefined();
  });

  test('document encryption round-trips and is not plaintext', () => {
    const plain = Buffer.from('masked aadhaar bytes');
    const enc = encryptBytes(plain);
    expect(enc.includes(plain)).toBe(false);
    expect(decryptBytes(enc).equals(plain)).toBe(true);
  });
});
