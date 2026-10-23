import type { StorageAdapter } from './index';

/**
 * Replit Object Storage. The bucket id comes from REPLIT_OBJECT_STORAGE_BUCKET
 * (or DEFAULT_OBJECT_STORAGE_BUCKET_ID, which Replit sets once the Object
 * Storage tool is added to the Repl).
 */
export class ReplitStorage implements StorageAdapter {
  readonly name = 'replit';
  private clientP?: Promise<import('@replit/object-storage').Client>;

  private client() {
    if (!this.clientP) {
      this.clientP = import('@replit/object-storage').then(({ Client }) => {
        const bucketId = process.env.REPLIT_OBJECT_STORAGE_BUCKET || process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
        return new Client(bucketId ? { bucketId } : undefined);
      });
    }
    return this.clientP;
  }
  async put(key: string, body: Buffer) {
    const c = await this.client();
    const r = await c.uploadFromBytes(key, body);
    if (!r.ok) throw new Error(`object storage upload failed: ${r.error.message}`);
  }
  async get(key: string) {
    const c = await this.client();
    const r = await c.downloadAsBytes(key);
    if (!r.ok) return null;
    return r.value[0];
  }
  async delete(key: string) {
    const c = await this.client();
    await c.delete(key, { ignoreNotFound: true });
  }
  async ping() {
    const c = await this.client();
    const r = await c.exists('__health__');
    if (!r.ok) throw new Error(`object storage unreachable: ${r.error.message}`);
  }
}
