import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ZipArchive } from 'archiver';
import { unzipSync } from 'fflate';
import type { PrismaClient, Project, ProjectFile, User } from '@prisma/client';
import { checkProjectPath, SPELL_LANGUAGES } from '@oversells/shared';
import { badRequest } from '../errors.js';
import type { Storage } from '../storage/storage.js';
import type { ProjectService } from '../projects/project-service.js';

/** manifest.json at the root of a backup ZIP. */
interface Manifest {
  format: 'oversells-backup';
  version: 1;
  createdAt: string;
  projects: Array<{
    dir: string;
    name: string;
    owner?: string;
    compiler: string;
    mainFile: string;
    spellLanguage: string;
    designId: string | null;
  }>;
}

interface Log {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

type ProjectWithFiles = Project & { files: ProjectFile[]; owner?: { email: string } };

const MANIFEST = 'manifest.json';
const AUTO_NAME = /^oversells-(\d{4}-\d{2}-\d{2})\.zip$/;
/** Arbitrary constant for pg_try_advisory_lock: one instance writes the daily backup. */
const BACKUP_LOCK = 724_355_002;

/** A folder for a project inside the ZIP (owner/name in full backups): readable and unique. */
function folderName(parts: string[], used: Set<string>): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 80) || 'loyiha';
  const base = parts.map(clean).join('/');
  let dir = base;
  for (let n = 2; used.has(dir.toLowerCase()); n++) dir = `${base} (${n})`;
  used.add(dir.toLowerCase());
  return dir;
}

/**
 * Backups of projects as ZIP files with a manifest: downloaded by a user
 * (their own projects), written daily to BACKUP_DIR (everyone's, kept for
 * BACKUP_KEEP_DAYS days), and restored into new projects.
 */
export class BackupService {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: Storage,
    private readonly projects: ProjectService,
    private readonly limits: { maxProjectBytes: number; maxFilesPerProject: number },
    private readonly auto: { dir?: string; keepDays: number },
  ) {}

  /** A ZIP of the given projects. */
  zip(projects: ProjectWithFiles[]): Readable {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const out = new PassThrough();
    archive.on('error', (err: Error) => out.destroy(err));
    archive.pipe(out);
    void (async () => {
      const used = new Set<string>();
      const missing: string[] = [];
      const manifest: Manifest = { format: 'oversells-backup', version: 1, createdAt: new Date().toISOString(), projects: [] };
      for (const p of projects) {
        const dir = folderName(p.owner ? [p.owner.email, p.name] : [p.name], used);
        manifest.projects.push({
          dir,
          name: p.name,
          ...(p.owner ? { owner: p.owner.email } : {}),
          compiler: p.compiler,
          mainFile: p.mainFile,
          spellLanguage: p.spellLanguage,
          designId: p.designId,
        });
        for (const f of p.files) {
          // A file whose content is missing must not stop the whole backup.
          const data = await this.storage.get(f.storageKey).catch(() => null);
          if (data) archive.append(data, { name: `${dir}/${f.path}` });
          else missing.push(`${dir}/${f.path}`);
        }
      }
      if (missing.length) (manifest as Manifest & { missing?: string[] }).missing = missing;
      archive.append(JSON.stringify(manifest, null, 2), { name: MANIFEST });
      await archive.finalize();
    })().catch((err: Error) => out.destroy(err));
    return out;
  }

  /** The user's own projects. */
  async userProjects(user: User): Promise<ProjectWithFiles[]> {
    return this.prisma.project.findMany({ where: { ownerId: user.id }, include: { files: true }, orderBy: { name: 'asc' } });
  }

  /**
   * Restores a backup ZIP (or a single project's ZIP) as new projects of the
   * user. Paths are checked like uploads; sizes are bounded before unpacking.
   */
  async restore(user: User, data: Buffer, fileName: string, canCreate: (n: number) => Promise<void>): Promise<Project[]> {
    const perProject = this.limits.maxProjectBytes;
    let total = 0;
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(new Uint8Array(data), {
        filter: (f) => {
          total += f.originalSize;
          if (f.originalSize > perProject || total > perProject * 50) throw new Error('too large');
          return !f.name.endsWith('/');
        },
      });
    } catch {
      throw badRequest('invalid_backup', 'Not a ZIP file, or it is too large');
    }
    const names = Object.keys(entries);
    let manifest: Manifest | null = null;
    if (entries[MANIFEST]) {
      try {
        const m = JSON.parse(Buffer.from(entries[MANIFEST]!).toString('utf8')) as Manifest;
        if (m.format === 'oversells-backup' && Array.isArray(m.projects)) manifest = m;
      } catch {
        // not ours: treat as one project
      }
    }
    const groups: Array<{ meta: Manifest['projects'][number] | { name: string }; prefix: string }> = manifest
      ? manifest.projects.map((p) => ({ meta: p, prefix: `${p.dir}/` }))
      : (() => {
          // One project; strip a common top folder (a ZIP of a folder).
          const top = names.every((n) => n.includes('/') && n.split('/')[0] === names[0]!.split('/')[0]) ? `${names[0]!.split('/')[0]}/` : '';
          return [{ meta: { name: fileName.replace(/\.zip$/i, '') || 'Loyiha' }, prefix: top }];
        })();
    if (groups.length === 0) throw badRequest('invalid_backup', 'The backup has no projects');
    await canCreate(groups.length);

    const created: Project[] = [];
    for (const g of groups) {
      const files: Array<{ path: string; data: Buffer }> = [];
      let bytes = 0;
      for (const name of names) {
        if (!name.startsWith(g.prefix) || name === MANIFEST) continue;
        const rel = name.slice(g.prefix.length);
        const check = checkProjectPath(rel);
        if (!check.ok) continue; // hidden files, odd names, unsupported types
        const content = Buffer.from(entries[name]!);
        bytes += content.length;
        files.push({ path: check.path, data: content });
      }
      if (files.length === 0) continue;
      if (bytes > perProject || files.length > this.limits.maxFilesPerProject) {
        throw badRequest('invalid_backup', `Project "${g.meta.name}" is larger than the project limits`);
      }
      const meta = g.meta as Partial<Manifest['projects'][number]> & { name: string };
      created.push(
        await this.projects.createFromFiles(
          user.id,
          {
            name: String(meta.name).slice(0, 200),
            compiler: meta.compiler,
            mainFile: meta.mainFile,
            spellLanguage: (SPELL_LANGUAGES as readonly string[]).includes(meta.spellLanguage ?? '') ? meta.spellLanguage : undefined,
            designId: typeof meta.designId === 'string' ? meta.designId : null,
          },
          files,
        ),
      );
    }
    if (created.length === 0) throw badRequest('invalid_backup', 'The backup has no project files');
    return created;
  }

  // --- automatic daily backups --------------------------------------------------------------

  get autoEnabled(): boolean {
    return !!this.auto.dir;
  }

  /** Daily backups in BACKUP_DIR (newest first). */
  async list(): Promise<Array<{ name: string; date: string; size: number }>> {
    if (!this.auto.dir) return [];
    const names = await readdir(this.auto.dir).catch(() => [] as string[]);
    const out = [];
    for (const name of names) {
      const m = AUTO_NAME.exec(name);
      if (!m) continue;
      const s = await stat(path.join(this.auto.dir, name)).catch(() => null);
      if (s) out.push({ name, date: m[1]!, size: s.size });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }

  /** Writes today's backup if it is missing and removes the old ones; null when not needed. */
  async runDaily(now = new Date(), log?: Log): Promise<string | null> {
    const dir = this.auto.dir;
    if (!dir) return null;
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(${BACKUP_LOCK}) AS locked`;
        if (!rows[0]?.locked) return null;
        await mkdir(dir, { recursive: true });
        const day = now.toISOString().slice(0, 10);
        const file = path.join(dir, `oversells-${day}.zip`);
        let written: string | null = null;
        if (!(await stat(file).catch(() => null))) {
          const projects = await this.prisma.project.findMany({
            include: { files: true, owner: { select: { email: true } } },
            orderBy: [{ ownerId: 'asc' }, { name: 'asc' }],
          });
          const tmp = `${file}.part`;
          try {
            await pipeline(this.zip(projects), createWriteStream(tmp));
            await rename(tmp, file);
          } catch (err) {
            await rm(tmp, { force: true });
            throw err;
          }
          written = file;
          log?.info({ file, projects: projects.length }, 'Daily backup written');
        }
        const cutoff = new Date(now.getTime() - this.auto.keepDays * 86_400_000).toISOString().slice(0, 10);
        for (const b of await this.list()) {
          if (b.date < cutoff) await rm(path.join(dir, b.name), { force: true });
        }
        return written;
      },
      { timeout: 30 * 60_000 },
    );
  }

  /** Checks every hour; the first check runs a minute after start-up. */
  start(log: Log): void {
    if (!this.auto.dir) return;
    const tick = () =>
      void this.runDaily(new Date(), log)
        .catch((err) => log.warn({ err }, 'Daily backup failed'))
        .finally(() => {
          if (this.timer) this.timer = setTimeout(tick, 60 * 60_000);
        });
    this.timer = setTimeout(tick, 60_000);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
