import type { StorageAdapter } from './index';

/** In-memory adapter for mock-mode smoke tests and CI (STORAGE_ADAPTER=memory). Loses everything on restart; refused when MOCK_MODE=false. */
export class MemoryStorage implements StorageAdapter {
  readonly name = 'memory';
  private files = new Map<string, Buffer>();
  async put(key: string, body: Buffer) {
    this.files.set(key, Buffer.from(body));
  }
  async get(key: string) {
    return this.files.get(key) ?? null;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
  async ping() {
    /* always reachable */
  }
}
