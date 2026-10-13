import type { CompileJob, PrismaClient } from '@prisma/client';
import { badRequest } from '../errors.js';
import type { Storage } from '../storage/storage.js';
import { SyncTex, type ForwardResult } from './synctex.js';

const CACHE_SIZE = 20;

/** Loads and caches parsed SyncTeX data per compile job, answers both directions. */
export class SyncTexService {
  private readonly cache = new Map<string, Promise<SyncTex>>();

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
    entry = this.storage.get(job.synctexKey).then((gz) => SyncTex.fromGzip(gz));
    entry.catch(() => this.cache.delete(job.id));
    this.cache.set(job.id, entry);
    while (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    return entry;
  }

  /** Source -> PDF. */
  async forward(job: CompileJob, file: string, line: number): Promise<ForwardResult | null> {
    return (await this.load(job)).forward(file, line);
  }

  /** PDF -> source, with the id of the project file (if it still exists). */
  async reverse(job: CompileJob, page: number, x: number, y: number) {
    const result = (await this.load(job)).reverse(page, x, y);
    if (!result) return null;
    const file = await this.prisma.projectFile.findUnique({
      where: { projectId_path: { projectId: job.projectId, path: result.file } },
    });
    return { ...result, fileId: file?.id ?? null };
  }
}
