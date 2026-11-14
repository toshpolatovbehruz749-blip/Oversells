import { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { assertValidKey, type Storage } from './storage.js';

export interface S3StorageOptions {
  bucket: string;
  region: string;
  /** For S3-compatible services such as MinIO (e.g. http://minio:9000). */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Path-style URLs (bucket in the path); needed by MinIO. */
  forcePathStyle: boolean;
  /** Prepended to every key, e.g. "oversells/". */
  prefix?: string;
}

function isNotFound(err: unknown): boolean {
  if (err instanceof S3ServiceException) {
    return err.name === 'NoSuchKey' || err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404;
  }
  return false;
}

/** Same error shape as the local disk storage, so callers can treat both alike. */
function enoent(key: string): NodeJS.ErrnoException {
  const err = new Error(`ENOENT: no such object: ${key}`) as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  return err;
}

/** Blob storage in an S3-compatible bucket (AWS S3, MinIO, ...). */
export class S3Storage implements Storage {
  private readonly client: S3Client;
  private readonly prefix: string;

  constructor(private readonly opts: S3StorageOptions) {
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: opts.forcePathStyle,
      credentials:
        opts.accessKeyId && opts.secretAccessKey
          ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey }
          : undefined,
    });
    this.prefix = opts.prefix ? opts.prefix.replace(/\/*$/, '/') : '';
  }

  private key(key: string): string {
    assertValidKey(key);
    return this.prefix + key;
  }

  async put(key: string, data: Buffer | Readable): Promise<number> {
    // Buffer first: the S3 API needs the length up front, and our blobs are bounded by the upload limits.
    const body = Buffer.isBuffer(data) ? data : Buffer.concat(await data.toArray());
    await this.client.send(new PutObjectCommand({ Bucket: this.opts.bucket, Key: this.key(key), Body: body }));
    return body.length;
  }

  async get(key: string): Promise<Buffer> {
    const stream = await this.getStream(key);
    return Buffer.concat(await stream.toArray());
  }

  async getStream(key: string): Promise<Readable> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: this.key(key) }));
      return res.Body as Readable;
    } catch (err) {
      if (isNotFound(err)) throw enoent(key);
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.opts.bucket, Key: this.key(key) }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: this.key(key) }));
  }

  async deletePrefix(prefix: string): Promise<void> {
    const listPrefix = `${this.key(prefix)}/`;
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.opts.bucket, Prefix: listPrefix, ContinuationToken: token }),
      );
      const objects = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (objects.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({ Bucket: this.opts.bucket, Delete: { Objects: objects, Quiet: true } }),
        );
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  /** Creates the bucket when it does not exist yet (convenient with a fresh MinIO). */
  async ensureBucket(): Promise<boolean> {
    try {
      await this.check();
      return false;
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
    await this.client.send(new CreateBucketCommand({ Bucket: this.opts.bucket }));
    return true;
  }

  /** Readiness check: the bucket is reachable with our credentials. */
  async check(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.opts.bucket }));
  }

  destroy(): void {
    this.client.destroy();
  }
}
