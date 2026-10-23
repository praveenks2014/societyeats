import { log } from '@/lib/log';

/**
 * Object storage behind one interface so uploads survive Replit Autoscale
 * (instances have ephemeral disks).
 *   STORAGE_ADAPTER=local   dev default — files under ./.data/uploads
 *   STORAGE_ADAPTER=replit  Replit Object Storage (bucket via env)
 *   STORAGE_ADAPTER=s3      S3-compatible (AWS S3, R2, MinIO)
 * In production the default is `replit`.
 */
export interface StorageAdapter {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  ping(): Promise<void>;
}

const g = globalThis as unknown as { __padosiStorage?: StorageAdapter };

export function storageAdapterName(): string {
  return (process.env.STORAGE_ADAPTER || (process.env.NODE_ENV === 'production' ? 'replit' : 'local')).toLowerCase();
}

export async function getStorage(): Promise<StorageAdapter> {
  if (g.__padosiStorage) return g.__padosiStorage;
  const name = storageAdapterName();
  let adapter: StorageAdapter;
  if (name === 'replit') adapter = new (await import('./replit')).ReplitStorage();
  else if (name === 's3') adapter = new (await import('./s3')).S3Storage();
  else adapter = new (await import('./local')).LocalStorage();
  log.info('storage.init', { adapter: adapter.name });
  g.__padosiStorage = adapter;
  return adapter;
}

/** Test hook. */
export function setStorageForTests(a: StorageAdapter | undefined) {
  g.__padosiStorage = a;
}
