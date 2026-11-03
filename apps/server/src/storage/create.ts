import type { Config } from '../config.js';
import { LocalDiskStorage } from './local-disk-storage.js';
import { S3Storage } from './s3-storage.js';
import type { Storage } from './storage.js';

/** The storage backend chosen by STORAGE_DRIVER (shared by the app and the worker). */
export function createStorage(config: Config): Storage {
  if (config.STORAGE_DRIVER === 's3') {
    return new S3Storage({
      bucket: config.S3_BUCKET,
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      prefix: config.S3_PREFIX,
    });
  }
  return new LocalDiskStorage(config.DATA_DIR);
}

/** Start-up preparation of the storage backend (creates a missing S3 bucket if allowed). */
export async function prepareStorage(storage: Storage, config: Config): Promise<void> {
  if (storage instanceof S3Storage && config.S3_CREATE_BUCKET) await storage.ensureBucket();
}
