import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { S3Storage } from '../../src/storage/s3-storage.js';
import { createTestContext } from '../helpers/context.js';
import { FAKE_PDF, FakeRunner } from '../helpers/fake-runner.js';

/**
 * Runs against an S3-compatible server given by S3_TEST_ENDPOINT, e.g. MinIO
 * from docker-compose (http://localhost:9000) or any other S3 implementation.
 */
const endpoint = process.env.S3_TEST_ENDPOINT;
const credentials = {
  accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID ?? 'minioadmin',
  secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY ?? 'minioadmin',
};

async function newBucket(): Promise<string> {
  const bucket = `oversells-test-${randomBytes(4).toString('hex')}`;
  const client = new S3Client({ region: 'us-east-1', endpoint, forcePathStyle: true, credentials });
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  client.destroy();
  return bucket;
}

describe.skipIf(!endpoint)('S3 storage', () => {
  it('stores, reads, streams, checks and deletes objects', async () => {
    const storage = new S3Storage({ bucket: await newBucket(), region: 'us-east-1', endpoint, forcePathStyle: true, prefix: 'app', ...credentials });
    await storage.check();
    expect(await storage.put('projects/p1/files/a', Buffer.from('Salom'))).toBe(5);
    expect(await storage.put('projects/p1/files/b', Readable.from([Buffer.from('oqim '), Buffer.from('maʼlumoti')]))).toBe(Buffer.byteLength('oqim maʼlumoti'));
    expect((await storage.get('projects/p1/files/a')).toString()).toBe('Salom');
    expect(Buffer.concat(await (await storage.getStream('projects/p1/files/b')).toArray()).toString()).toBe('oqim maʼlumoti');
    expect(await storage.exists('projects/p1/files/a')).toBe(true);
    expect(await storage.exists('projects/p1/files/zzz')).toBe(false);
    await expect(storage.get('projects/p1/files/zzz')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(storage.put('../escape', Buffer.from('x'))).rejects.toThrow(/Invalid storage key/);

    await storage.put('projects/p2/files/c', Buffer.from('boshqa'));
    await storage.deletePrefix('projects/p1');
    expect(await storage.exists('projects/p1/files/a')).toBe(false);
    expect(await storage.exists('projects/p1/files/b')).toBe(false);
    expect(await storage.exists('projects/p2/files/c')).toBe(true);
    await storage.delete('projects/p2/files/c');
    expect(await storage.exists('projects/p2/files/c')).toBe(false);
    storage.destroy();
  });

  it('runs the app on S3: projects, files, compile outputs, readiness', async () => {
    const bucket = await newBucket();
    const ctx = await createTestContext(new FakeRunner(), {
      STORAGE_DRIVER: 's3',
      S3_BUCKET: bucket,
      S3_ENDPOINT: endpoint!,
      S3_ACCESS_KEY_ID: credentials.accessKeyId,
      S3_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    });
    try {
      expect(ctx.services.storage).toBeInstanceOf(S3Storage);
      expect((await ctx.api.inject('/api/ready')).json().checks.storage).toEqual({ ok: true });
      const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'S3' } })).json().project;
      const files = (await ctx.api.inject(`/api/projects/${p.id}`)).json().project.files as Array<{ id: string; path: string }>;
      const main = files.find((f) => f.path === 'main.tex')!;
      await ctx.api.inject({ method: 'PUT', url: `/api/projects/${p.id}/files/${main.id}/content`, payload: { content: 'S3 dan salom' } });
      expect((await ctx.api.inject(`/api/projects/${p.id}/files/${main.id}`)).body).toBe('S3 dan salom');
      const job = (await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/compile`, payload: { wait: true } })).json().job;
      const pdf = await ctx.api.inject(`/api/projects/${p.id}/compile/${job.id}/output.pdf`);
      expect(pdf.rawPayload.equals(FAKE_PDF)).toBe(true);
      expect((await ctx.api.inject(`/api/projects/${p.id}/download.zip`)).statusCode).toBe(200);
      expect((await ctx.api.inject({ method: 'DELETE', url: `/api/projects/${p.id}` })).statusCode).toBe(204);
    } finally {
      await ctx.close();
    }
  });
});
