import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { assertValidKey, type Storage } from './storage.js';

/** Stores blobs as files below a root directory. Writes are atomic (temp file + rename). */
export class LocalDiskStorage implements Storage {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    assertValidKey(key);
    const full = path.resolve(this.root, key);
    // Defence in depth: the key regex already forbids traversal.
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error(`Storage key escapes root: ${key}`);
    }
    return full;
  }

  async put(key: string, data: Buffer | Readable): Promise<number> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      const source = Buffer.isBuffer(data) ? Readable.from([data]) : data;
      await pipeline(source, createWriteStream(tmp, { flags: 'wx' }));
      await rename(tmp, target);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    return (await stat(target)).size;
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async getStream(key: string): Promise<Readable> {
    const file = this.resolve(key);
    await stat(file); // throw ENOENT before handing out a stream
    return createReadStream(file);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    await rm(this.resolve(prefix), { recursive: true, force: true });
  }
}
