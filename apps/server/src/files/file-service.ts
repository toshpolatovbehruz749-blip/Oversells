import { Prisma, type PrismaClient, type ProjectFile } from '@prisma/client';
import { fileKindOf, joinProjectPath, mimeTypeOf, sanitizeFileName } from '@oversells/shared';
import { badRequest, conflict, notFound, tooLarge } from '../errors.js';
import { newId } from '../ids.js';
import { keys, type Storage } from '../storage/storage.js';
import { decodeUtf8, requireFilePath, requireFolderPath } from './validation.js';

export interface FileLimits {
  maxUploadBytes: number;
  maxTextFileBytes: number;
  maxProjectBytes: number;
  maxFilesPerProject: number;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Collaborative text documents (see DocManager). Text changes made through
 * this service go through it so that connected editors see them live.
 */
export interface TextDocuments {
  setText(fileId: string, text: string): Promise<boolean>;
  currentText(fileId: string): string | null;
  drop(fileId: string): void;
}

/** Manages the files of a project: metadata in the database, contents in storage. */
export class FileService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: Storage,
    private readonly limits: FileLimits,
    private readonly docs?: TextDocuments,
    private readonly quotas?: { assertStorage(projectId: string, addedBytes: number): Promise<void> },
  ) {}

  list(projectId: string): Promise<ProjectFile[]> {
    return this.prisma.projectFile.findMany({ where: { projectId }, orderBy: { path: 'asc' } });
  }

  async require(projectId: string, fileId: string): Promise<ProjectFile> {
    const file = await this.prisma.projectFile.findFirst({ where: { id: fileId, projectId } });
    if (!file) throw notFound('File');
    return file;
  }

  async read(projectId: string, fileId: string): Promise<{ file: ProjectFile; data: Buffer }> {
    const file = await this.require(projectId, fileId);
    const live = file.kind === 'text' ? this.docs?.currentText(file.id) : null;
    return { file, data: live != null ? Buffer.from(live, 'utf8') : await this.storage.get(file.storageKey) };
  }

  /** Creates a new text file. */
  async createText(projectId: string, rawPath: unknown, content = ''): Promise<ProjectFile> {
    const path = requireFilePath(rawPath);
    if (fileKindOf(path) !== 'text') throw badRequest('not_text_file', 'Only text files can be created here');
    const data = Buffer.from(content, 'utf8');
    this.checkTextSize(data.length);
    return this.insert(projectId, path, data);
  }

  /**
   * Stores an uploaded file. The name is sanitised; `folder` must be a valid
   * folder path (or empty). Existing files are replaced only when `overwrite`.
   */
  async upload(
    projectId: string,
    folder: string,
    originalName: string,
    data: Buffer,
    overwrite: boolean,
  ): Promise<ProjectFile> {
    const cleanFolder = folder ? requireFolderPath(folder) : '';
    const name = sanitizeFileName(originalName);
    const path = requireFilePath(joinProjectPath(cleanFolder, name));
    if (data.length > this.limits.maxUploadBytes) {
      throw tooLarge('file_too_large', 'File exceeds the upload size limit');
    }
    const kind = fileKindOf(path);
    let content = data;
    if (kind === 'text') {
      this.checkTextSize(data.length);
      const text = decodeUtf8(data);
      if (text === null) throw badRequest('not_utf8', 'Text files must be UTF-8 encoded');
      content = Buffer.from(text, 'utf8'); // BOM stripped
    }

    const existing = await this.prisma.projectFile.findUnique({
      where: { projectId_path: { projectId, path } },
    });
    if (existing) {
      if (!overwrite) throw conflict('file_exists', `A file named ${path} already exists`);
      return this.replaceContent(existing, content);
    }
    return this.insert(projectId, path, content);
  }

  /** Replaces the content of a text file (used by auto-save). */
  async saveText(projectId: string, fileId: string, content: unknown): Promise<ProjectFile> {
    if (typeof content !== 'string') throw badRequest('invalid_content', 'Content must be a string');
    const file = await this.require(projectId, fileId);
    if (file.kind !== 'text') throw badRequest('not_text_file', 'Binary files cannot be edited');
    const data = Buffer.from(content, 'utf8');
    this.checkTextSize(data.length);
    return this.replaceContent(file, data);
  }

  /** Renames or moves a file. */
  async move(projectId: string, fileId: string, rawPath: unknown): Promise<ProjectFile> {
    const file = await this.require(projectId, fileId);
    const path = requireFilePath(rawPath);
    if (path === file.path) return file;
    if (fileKindOf(path) !== file.kind) {
      throw badRequest('kind_change', 'Renaming may not change a file between text and binary');
    }
    await this.assertNoFolderConflict(projectId, path);
    try {
      const updated = await this.prisma.projectFile.update({
        where: { id: file.id },
        data: { path, mimeType: mimeTypeOf(path) },
      });
      await this.followMainFile(projectId, file.path, path);
      return updated;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('file_exists', `A file named ${path} already exists`);
      throw err;
    }
  }

  async delete(projectId: string, fileId: string): Promise<void> {
    const file = await this.require(projectId, fileId);
    this.docs?.drop(file.id);
    await this.prisma.projectFile.delete({ where: { id: file.id } });
    await this.storage.delete(file.storageKey);
  }

  /** Moves every file below `from/` to `to/`. Returns the number of files moved. */
  async renameFolder(projectId: string, rawFrom: unknown, rawTo: unknown): Promise<number> {
    const from = requireFolderPath(rawFrom);
    const to = requireFolderPath(rawTo);
    if (from === to) return 0;
    if (to.startsWith(`${from}/`)) throw badRequest('invalid_move', 'A folder cannot be moved into itself');
    const files = await this.filesInFolder(projectId, from);
    if (files.length === 0) throw notFound('Folder');

    const renames = files.map((f) => ({ file: f, path: requireFilePath(to + f.path.slice(from.length)) }));
    const clash = await this.prisma.projectFile.findFirst({
      where: { projectId, path: { in: renames.map((r) => r.path) } },
    });
    if (clash) throw conflict('file_exists', `A file named ${clash.path} already exists`);
    await this.assertNoFolderConflict(projectId, `${to}/x`);

    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    await this.prisma.$transaction([
      ...renames.map((r) =>
        this.prisma.projectFile.update({ where: { id: r.file.id }, data: { path: r.path } }),
      ),
      ...renames
        .filter((r) => r.file.path === project.mainFile)
        .map((r) => this.prisma.project.update({ where: { id: projectId }, data: { mainFile: r.path } })),
    ]);
    return renames.length;
  }

  async deleteFolder(projectId: string, rawFolder: unknown): Promise<number> {
    const folder = requireFolderPath(rawFolder);
    const files = await this.filesInFolder(projectId, folder);
    if (files.length === 0) throw notFound('Folder');
    for (const f of files) this.docs?.drop(f.id);
    await this.prisma.projectFile.deleteMany({ where: { id: { in: files.map((f) => f.id) } } });
    await Promise.all(files.map((f) => this.storage.delete(f.storageKey)));
    return files.length;
  }

  // --- helpers -------------------------------------------------------------

  private checkTextSize(bytes: number): void {
    if (bytes > this.limits.maxTextFileBytes) {
      throw tooLarge('file_too_large', 'Text file exceeds the size limit');
    }
  }

  private filesInFolder(projectId: string, folder: string): Promise<ProjectFile[]> {
    return this.prisma.projectFile.findMany({
      where: { projectId, path: { startsWith: `${folder}/` } },
    });
  }

  private async checkProjectQuota(projectId: string, addedBytes: number, addedFiles: number) {
    const agg = await this.prisma.projectFile.aggregate({
      where: { projectId },
      _sum: { size: true },
      _count: true,
    });
    if (agg._count + addedFiles > this.limits.maxFilesPerProject) {
      throw tooLarge('too_many_files', 'The project has too many files');
    }
    if ((agg._sum.size ?? 0) + addedBytes > this.limits.maxProjectBytes) {
      throw tooLarge('project_too_large', 'The project exceeds its size limit');
    }
    await this.quotas?.assertStorage(projectId, addedBytes);
  }

  /**
   * A path must not be both a file and a folder: `a.tex` cannot coexist with
   * `a.tex/b.tex`, and `a/b.tex` cannot be created when `a` is a file.
   */
  private async assertNoFolderConflict(projectId: string, path: string): Promise<void> {
    const segments = path.split('/');
    const parents = segments.slice(0, -1).map((_, i) => segments.slice(0, i + 1).join('/'));
    const clash = await this.prisma.projectFile.findFirst({
      where: {
        projectId,
        OR: [{ path: { in: parents } }, { path: { startsWith: `${path}/` } }],
      },
    });
    if (clash) throw conflict('path_conflict', `${path} conflicts with ${clash.path}`);
  }

  private async insert(projectId: string, path: string, data: Buffer): Promise<ProjectFile> {
    await this.checkProjectQuota(projectId, data.length, 1);
    await this.assertNoFolderConflict(projectId, path);
    const id = newId();
    const storageKey = keys.file(projectId, id);
    await this.storage.put(storageKey, data);
    try {
      return await this.prisma.projectFile.create({
        data: {
          id,
          projectId,
          path,
          kind: fileKindOf(path) ?? 'binary',
          size: data.length,
          mimeType: mimeTypeOf(path),
          storageKey,
        },
      });
    } catch (err) {
      await this.storage.delete(storageKey);
      if (isUniqueViolation(err)) throw conflict('file_exists', `A file named ${path} already exists`);
      throw err;
    }
  }

  private async replaceContent(file: ProjectFile, data: Buffer): Promise<ProjectFile> {
    await this.checkProjectQuota(file.projectId, data.length - file.size, 0);
    if (file.kind === 'text' && this.docs) {
      // Applied as a collaborative edit; DocManager mirrors it to storage.
      await this.docs.setText(file.id, data.toString('utf8'));
      return this.prisma.projectFile.findUniqueOrThrow({ where: { id: file.id } });
    }
    await this.storage.put(file.storageKey, data);
    return this.prisma.projectFile.update({ where: { id: file.id }, data: { size: data.length } });
  }

  private async followMainFile(projectId: string, oldPath: string, newPath: string) {
    if (!newPath.endsWith('.tex')) return;
    await this.prisma.project.updateMany({
      where: { id: projectId, mainFile: oldPath },
      data: { mainFile: newPath },
    });
  }
}
