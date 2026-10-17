import crypto from 'node:crypto';
import type { StorageAdapter } from './index';

/**
 * Minimal S3-compatible adapter using SigV4 over fetch (no SDK dependency).
 * Env: S3_ENDPOINT (e.g. https://s3.ap-south-1.amazonaws.com), S3_REGION,
 * S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY. Path-style addressing.
 */
export class S3Storage implements StorageAdapter {
  readonly name = 's3';
  private cfg() {
    const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
    if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
      throw new Error('S3 storage needs S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY');
    }
    return { endpoint: S3_ENDPOINT.replace(/\/$/, ''), region: S3_REGION || 'us-east-1', bucket: S3_BUCKET, ak: S3_ACCESS_KEY_ID, sk: S3_SECRET_ACCESS_KEY };
  }

  private async req(method: string, key: string, body?: Buffer, contentType?: string): Promise<Response> {
    const c = this.cfg();
    const url = new URL(`${c.endpoint}/${c.bucket}/${key}`);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = amzDate.slice(0, 8);
    const payloadHash = crypto.createHash('sha256').update(body ?? '').digest('hex');
    const headers: Record<string, string> = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
    if (contentType) headers['content-type'] = contentType;
    const signedHeaders = Object.keys(headers).sort().join(';');
    const canonical = [method, url.pathname, '', ...Object.keys(headers).sort().map((h) => `${h}:${headers[h]}`), '', signedHeaders, payloadHash].join('\n');
    const scope = `${date}/${c.region}/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonical).digest('hex')].join('\n');
    const hmac = (k: crypto.BinaryLike | crypto.KeyObject, d: string) => crypto.createHmac('sha256', k).update(d).digest();
    const kSigning = hmac(hmac(hmac(hmac(`AWS4${c.sk}`, date), c.region), 's3'), 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(toSign).digest('hex');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${c.ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return fetch(url, { method, headers, body: body ? new Uint8Array(body) : undefined });
  }

  async put(key: string, body: Buffer, contentType: string) {
    const r = await this.req('PUT', key, body, contentType);
    if (!r.ok) throw new Error(`s3 put failed: ${r.status}`);
  }
  async get(key: string) {
    const r = await this.req('GET', key);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  }
  async delete(key: string) {
    await this.req('DELETE', key);
  }
  async ping() {
    const r = await this.req('HEAD', '__health__');
    if (r.status >= 500 || r.status === 403) throw new Error(`s3 unreachable: ${r.status}`);
  }
}
