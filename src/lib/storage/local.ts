import fs from 'node:fs/promises';
import path from 'node:path';
import type { StorageAdapter } from './index';

/** Dev adapter: files live OUTSIDE public/, so they are only reachable through /api/files/[key]. */
export class LocalStorage implements StorageAdapter {
  readonly name = 'local';
  private dir = process.env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), '.data', 'uploads');

  private file(key: string) {
    if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error('bad storage key');
    return path.join(this.dir, key);
  }
  async put(key: string, body: Buffer) {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.file(key), body);
  }
  async get(key: string) {
    try {
      return await fs.readFile(this.file(key));
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    await fs.rm(this.file(key), { force: true });
  }
  async ping() {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.access(this.dir);
  }
}
