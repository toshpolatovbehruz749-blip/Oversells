import { ZipArchive } from 'archiver';
import { PassThrough, type Readable } from 'node:stream';
import type { ProjectFile } from '@prisma/client';
import type { Storage } from '../storage/storage.js';

/** Streams the project files as a ZIP archive. */
export function zipProject(files: ProjectFile[], storage: Storage): Readable {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const out = new PassThrough();
  archive.on('error', (err: Error) => out.destroy(err));
  archive.pipe(out);
  void (async () => {
    try {
      for (const f of files) {
        archive.append(await storage.getStream(f.storageKey), { name: f.path, date: f.updatedAt });
      }
      await archive.finalize();
    } catch (err) {
      out.destroy(err as Error);
    }
  })();
  return out;
}

/** ASCII-safe file name plus RFC 5987 UTF-8 variant for Content-Disposition. */
export function contentDisposition(kind: 'attachment' | 'inline', name: string): string {
  const ascii = name.normalize('NFKD').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
