import fs from 'node:fs/promises';
import path from 'node:path';
import type { StorageAdapter } from './index';

/** Dev adapter: files live OUTSIDE public/, so they are only reachable through /api/files/[key]. */
export class LocalStorage implements StorageAdapter {
  readonly name = 'local';
  private dir = process.env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), '.data', 'uploads');

  /** A key is one or more `/`-separated names (uploads are flat; backups live under `backups/`). No `.`/`..` segments, no escaping the folder. */
  private file(key: string) {
    const parts = key.split('/');
    if (!parts.every((p) => /^[A-Za-z0-9._-]+$/.test(p) && p !== '.' && p !== '..')) throw new Error('bad storage key');
    return path.join(this.dir, ...parts);
  }
  async put(key: string, body: Buffer) {
    const file = this.file(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
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
