import type { Readable } from 'node:stream';

/**
 * Blob storage used for file contents and compile outputs.
 *
 * Keys are server-generated, '/'-separated strings such as
 * `projects/<projectId>/files/<fileId>`. Implementations: LocalDiskStorage
 * (Phase 1); an S3-compatible implementation can be added without touching
 * the services.
 */
export interface Storage {
  put(key: string, data: Buffer | Readable): Promise<number>;
  get(key: string): Promise<Buffer>;
  getStream(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Deletes every key starting with `prefix/`. */
  deletePrefix(prefix: string): Promise<void>;
}

const KEY_RE = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*$/;

export function assertValidKey(key: string): void {
  if (!KEY_RE.test(key) || key.split('/').some((s) => s === '.' || s === '..')) {
    throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
  }
}

export const keys = {
  project: (projectId: string) => `projects/${projectId}`,
  file: (projectId: string, fileId: string) => `projects/${projectId}/files/${fileId}`,
  output: (projectId: string, jobId: string) => `projects/${projectId}/output/${jobId}`,
  outputPdf: (projectId: string, jobId: string) => `projects/${projectId}/output/${jobId}/output.pdf`,
  outputLog: (projectId: string, jobId: string) => `projects/${projectId}/output/${jobId}/output.log`,
  outputSynctex: (projectId: string, jobId: string) => `projects/${projectId}/output/${jobId}/output.synctex.gz`,
  /** Auxiliary files of the last successful compile (one per project). */
  compileCacheDir: (projectId: string) => `projects/${projectId}/compile-cache`,
  compileCache: (projectId: string, name: string) => `projects/${projectId}/compile-cache/${name}.tar`,
};
