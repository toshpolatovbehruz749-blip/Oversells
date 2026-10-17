import type { CompileJob, PrismaClient } from '@prisma/client';
import { previewPath } from '@oversells/shared';
import { badRequest } from '../errors.js';
import type { Storage } from '../storage/storage.js';
import { SyncTex, type ForwardResult } from './synctex.js';

const CACHE_SIZE = 20;
/** Parsed data of big books is large: also bound the cache by memory. */
const CACHE_BYTES = 256 * 1024 * 1024;

/** Loads and caches parsed SyncTeX data per compile job, answers both directions. */
export class SyncTexService {
  private readonly cache = new Map<string, Promise<SyncTex>>();
  private readonly sizes = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: Storage,
  ) {}

  private load(job: CompileJob): Promise<SyncTex> {
    if (!job.synctexKey) throw badRequest('no_synctex', 'This compile has no SyncTeX data');
    let entry = this.cache.get(job.id);
    if (entry) {
      // Refresh the LRU position.
      this.cache.delete(job.id);
      this.cache.set(job.id, entry);
      return entry;
    }
    const id = job.id;
    entry = this.storage.get(job.synctexKey).then((gz) => {
      const sync = SyncTex.fromGzip(gz);
      if (this.cache.has(id)) this.sizes.set(id, sync.bytes);
      this.evict();
      return sync;
    });
    entry.catch(() => this.forget(id));
    this.cache.set(id, entry);
    this.evict();
    return entry;
  }

  private forget(id: string) {
    this.cache.delete(id);
    this.sizes.delete(id);
  }

  /** Drops the least recently used entries beyond the count and memory limits (keeps the newest). */
  private evict() {
    let total = [...this.sizes.values()].reduce((a, b) => a + b, 0);
    while (this.cache.size > 1 && (this.cache.size > CACHE_SIZE || total > CACHE_BYTES)) {
      const oldest = this.cache.keys().next().value!;
      total -= this.sizes.get(oldest) ?? 0;
      this.forget(oldest);
    }
  }

  /** Source -> PDF. */
  async forward(job: CompileJob, file: string, line: number): Promise<ForwardResult | null> {
    // A chapter preview is compiled as main-bob.tex with the main file's line numbers.
    const compiled = job.previewLine !== null && file === job.mainFile ? previewPath(job.mainFile) : file;
    return (await this.load(job)).forward(compiled, line);
  }

  /** PDF -> source, with the id of the project file (if it still exists). */
  async reverse(job: CompileJob, page: number, x: number, y: number) {
    const found = (await this.load(job)).reverse(page, x, y);
    if (!found) return null;
    const result = job.previewLine !== null && found.file === previewPath(job.mainFile) ? { ...found, file: job.mainFile } : found;
    const file = await this.prisma.projectFile.findUnique({
      where: { projectId_path: { projectId: job.projectId ?? '', path: result.file } },
    });
    return { ...result, fileId: file?.id ?? null };
  }
}
