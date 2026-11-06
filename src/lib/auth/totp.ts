import crypto from 'node:crypto';

/**
 * TOTP (RFC 6238) with HMAC-SHA1, 6 digits, 30-second steps — what every authenticator app speaks.
 * Written against the RFC rather than pulling in a dependency for 60 lines (see tests for the RFC vectors).
 */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const generateTotpSecret = (): string => base32Encode(crypto.randomBytes(20));

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secret).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const totpAt = (secretB32: string, atMs: number, step = 30, digits = 6) => hotp(base32Decode(secretB32), Math.floor(atMs / 1000 / step), digits);

/** Accepts the current code and one step either side (clock drift). Constant-time compare. */
export function verifyTotp(secretB32: string, code: string, nowMs: number = Date.now(), window = 1): boolean {
  const c = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  let match = false;
  for (let w = -window; w <= window; w++) {
    const expected = totpAt(secretB32, nowMs + w * 30_000);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) match = true;
  }
  return match;
}

export function otpauthUri(account: string, secretB32: string, issuer: string): string {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** 10 one-time recovery codes like `k3x9-p2mq`; only their SHA-256 is stored. */
export function generateRecoveryCodes(n = 10): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const pick = () => Array.from(crypto.randomBytes(4), (b) => alphabet[b % alphabet.length]).join('');
  return Array.from({ length: n }, () => `${pick()}-${pick()}`);
}
export const hashRecoveryCode = (code: string) => crypto.createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
