import { createHash } from 'node:crypto';
import type { PrismaClient, User, Version, VersionKind } from '@prisma/client';
import type { VersionContentDTO, VersionDTO, VersionFileDTO } from '@oversells/shared';
import { badRequest, notFound } from '../errors.js';
import type { Storage } from '../storage/storage.js';
import type { DocManager } from '../collab/doc-manager.js';
import type { FileService } from '../files/file-service.js';

export interface VersionOptions {
  /** Minimum time between automatic versions while people are editing. */
  autoIntervalMs: number;
}

export type VersionWithAuthor = Version & { createdBy: Pick<User, 'id' | 'name'> | null };

export function toVersionDTO(v: VersionWithAuthor): VersionDTO {
  return {
    id: v.id,
    kind: v.kind,
    name: v.name,
    createdBy: v.createdBy ? { id: v.createdBy.id, name: v.createdBy.name } : null,
    fileCount: v.fileCount,
    createdAt: v.createdAt.toISOString(),
  };
}

const versionKey = (projectId: string, versionId: string) => `projects/${projectId}/versions/${versionId}.json`;

/**
 * Project versions: the text of every text file at one moment.
 *  - automatic versions while editing (at most every `autoIntervalMs`) and
 *    when everyone has left a changed document;
 *  - named versions on request;
 *  - restore applies an old version as a new change (after saving the current
 *    state as a version), so history is never lost.
 * Binary files (images, fonts) are not versioned.
 */
export class VersionService {
  /** Serialises version work per project. */
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly lastAuto = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: Storage,
    private readonly docs: DocManager,
    private readonly opts: VersionOptions,
  ) {}

  private withLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(projectId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.locks.set(projectId, next);
    void next.finally(() => {
      if (this.locks.get(projectId) === next) this.locks.delete(projectId);
    }).catch(() => undefined);
    return next;
  }

  /** Current text of all text files (live documents included). */
  async currentFiles(projectId: string): Promise<VersionFileDTO[]> {
    await this.docs.flushProject(projectId);
    const files = await this.prisma.projectFile.findMany({
      where: { projectId, kind: 'text' },
      orderBy: { path: 'asc' },
    });
    return Promise.all(
      files.map(async (f) => ({
        fileId: f.id,
        path: f.path,
        content: this.docs.currentText(f.id) ?? (await this.storage.get(f.storageKey)).toString('utf8'),
      })),
    );
  }

  private static hash(files: VersionFileDTO[]): string {
    const h = createHash('sha256');
    for (const f of files) h.update(f.path).update('\0').update(f.content).update('\0');
    return h.digest('hex');
  }

  /**
   * Saves a version. Automatic versions are skipped (null) when nothing changed
   * since the latest version.
   */
  snapshot(projectId: string, kind: VersionKind, name: string | null, user: User | null): Promise<VersionWithAuthor | null> {
    return this.withLock(projectId, () => this.snapshotLocked(projectId, kind, name, user));
  }

  private async snapshotLocked(
    projectId: string,
    kind: VersionKind,
    name: string | null,
    user: User | null,
  ): Promise<VersionWithAuthor | null> {
    const files = await this.currentFiles(projectId);
    const contentHash = VersionService.hash(files);
    if (kind === 'auto') {
      const latest = await this.prisma.version.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' } });
      if (latest?.contentHash === contentHash) return null;
    }
    const version = await this.prisma.version.create({
      data: {
        projectId,
        kind,
        name,
        createdById: user?.id ?? null,
        contentKey: '',
        contentHash,
        fileCount: files.length,
      },
    });
    const contentKey = versionKey(projectId, version.id);
    await this.storage.put(contentKey, Buffer.from(JSON.stringify({ files }), 'utf8'));
    if (kind === 'auto') this.lastAuto.set(projectId, Date.now());
    return this.prisma.version.update({
      where: { id: version.id },
      data: { contentKey },
      include: { createdBy: { select: { id: true, name: true } } },
    });
  }

  /** Called on editing activity: takes an automatic version when the interval has passed. */
  async maybeAuto(projectId: string): Promise<VersionWithAuthor | null> {
    let last = this.lastAuto.get(projectId);
    if (last === undefined) {
      const latest = await this.prisma.version.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' } });
      last = latest?.createdAt.getTime() ?? 0;
      this.lastAuto.set(projectId, last);
    }
    if (Date.now() - last < this.opts.autoIntervalMs) return null;
    this.lastAuto.set(projectId, Date.now()); // claim the slot before the async work
    return this.snapshot(projectId, 'auto', null, null);
  }

  list(projectId: string): Promise<VersionWithAuthor[]> {
    return this.prisma.version.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { id: true, name: true } } },
      take: 500,
    });
  }

  async content(projectId: string, versionId: string): Promise<VersionContentDTO> {
    const version = await this.prisma.version.findFirst({
      where: { id: versionId, projectId },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (!version) throw notFound('Version');
    const { files } = JSON.parse((await this.storage.get(version.contentKey)).toString('utf8')) as {
      files: VersionFileDTO[];
    };
    return { version: toVersionDTO(version), files };
  }

  /**
   * Restores a version as a new change: saves the current state first, then
   * sets every versioned file back to its old text (live for connected
   * editors). Files deleted since are re-created; files added since are kept.
   */
  async restore(projectId: string, versionId: string, user: User, files: FileService): Promise<VersionWithAuthor> {
    const { version, files: old } = await this.content(projectId, versionId);
    // The edits below must not trigger an extra automatic version.
    this.lastAuto.set(projectId, Date.now());
    await this.snapshot(projectId, 'auto', null, null);
    await this.withLock(projectId, async () => {
      for (const f of old) {
        const byId = await this.prisma.projectFile.findFirst({ where: { id: f.fileId, projectId } });
        const target =
          byId ?? (await this.prisma.projectFile.findUnique({ where: { projectId_path: { projectId, path: f.path } } }));
        if (target && target.kind === 'text') {
          await this.docs.setText(target.id, f.content);
          if (target.path !== f.path) {
            await files.move(projectId, target.id, f.path).catch(() => undefined); // keep current name on conflict
          }
        } else if (!target) {
          await files.createText(projectId, f.path, f.content);
        }
      }
    });
    const label = version!.name ?? version!.createdAt;
    const restored = await this.snapshot(projectId, 'restore', label, user);
    if (!restored) throw badRequest('restore_failed', 'Could not save the restored version');
    return restored;
  }
}
