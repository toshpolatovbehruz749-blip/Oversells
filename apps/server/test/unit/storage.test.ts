import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalDiskStorage } from '../../src/storage/local-disk-storage.js';
import { assertValidKey } from '../../src/storage/storage.js';

describe('LocalDiskStorage', () => {
  let dir: string;
  let storage: LocalDiskStorage;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'oversells-storage-'));
    storage = new LocalDiskStorage(dir);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('stores and reads buffers and streams', async () => {
    expect(await storage.put('projects/p1/files/f1', Buffer.from('salom'))).toBe(5);
    expect((await storage.get('projects/p1/files/f1')).toString()).toBe('salom');
    await storage.put('projects/p1/files/f2', Readable.from([Buffer.from('a'), Buffer.from('b')]));
    const chunks: Buffer[] = [];
    for await (const c of await storage.getStream('projects/p1/files/f2')) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('ab');
    expect(await storage.exists('projects/p1/files/f2')).toBe(true);
    expect(await storage.exists('projects/p1/files/nope')).toBe(false);
  });

  it('overwrites atomically without leaving temp files', async () => {
    await storage.put('k/a', Buffer.from('1'));
    await storage.put('k/a', Buffer.from('22'));
    expect((await storage.get('k/a')).toString()).toBe('22');
    expect(await readdir(path.join(dir, 'k'))).toEqual(['a']);
  });

  it('deletes keys and prefixes', async () => {
    await storage.put('projects/p1/files/a', Buffer.from('1'));
    await storage.put('projects/p1/output/j/output.pdf', Buffer.from('2'));
    await storage.put('projects/p2/files/a', Buffer.from('3'));
    await storage.delete('projects/p1/files/a');
    expect(await storage.exists('projects/p1/files/a')).toBe(false);
    await storage.deletePrefix('projects/p1');
    expect(await storage.exists('projects/p1/output/j/output.pdf')).toBe(false);
    expect(await storage.exists('projects/p2/files/a')).toBe(true);
    await storage.delete('projects/none'); // missing keys are fine
  });

  it.each(['../x', 'a/../../x', '/etc/passwd', 'a//b', 'a/./b', '', 'a\\b', 'a/b c'])(
    'rejects unsafe key %j',
    async (key) => {
      expect(() => assertValidKey(key)).toThrow();
      await expect(storage.put(key, Buffer.from('x'))).rejects.toThrow();
      await expect(storage.get(key)).rejects.toThrow();
    },
  );
});
