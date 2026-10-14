import Docker from 'dockerode';
import { PassThrough, Writable, type Duplex } from 'node:stream';
import tar from 'tar-stream';
import type { CompileRequest, CompileResult, CompileRunner } from './runner.js';

export interface DockerRunnerOptions {
  image: string;
  timeoutMs: number;
  memoryMb: number;
  cpus: number;
  workdirMb: number;
  maxOutputBytes: number;
  socketPath?: string;
  /** e.g. tcp://host:2375; takes precedence over socketPath. */
  dockerHost?: string;
}

/** uid/gid of the unprivileged `tex` user in compiler/Dockerfile. */
const TEX_UID = 1001;
/** Name of the auxiliary-file cache inside the job's input and output archives. */
export const CACHE_FILE = '.oversells-cache.tar';
const MAX_CONSOLE_BYTES = 2 * 1024 * 1024;
const MAX_LOG_CHARS = 5 * 1024 * 1024;

function dockerFromOptions(opts: DockerRunnerOptions): Docker {
  if (opts.dockerHost) {
    const url = new URL(opts.dockerHost);
    if (url.protocol === 'unix:') return new Docker({ socketPath: url.pathname });
    return new Docker({ host: url.hostname, port: Number(url.port || 2375), protocol: 'http' });
  }
  return new Docker({ socketPath: opts.socketPath ?? '/var/run/docker.sock' });
}

/** Packs the project files into a tar archive (paths were validated upstream). */
export async function packFiles(files: CompileRequest['files']): Promise<Buffer> {
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  pack.on('data', (c: unknown) => chunks.push(c as Buffer));
  const done = new Promise<void>((resolve, reject) => {
    pack.on('end', resolve);
    pack.on('error', reject);
  });
  for (const f of files) {
    await new Promise<void>((resolve, reject) =>
      pack.entry({ name: f.path, mode: 0o644, size: f.data.length }, f.data, (err) =>
        err ? reject(err) : resolve(),
      ),
    );
  }
  pack.finalize();
  await done;
  return Buffer.concat(chunks);
}

/** Extracts the expected output files from the job's stdout tar. */
export async function unpackOutputs(archive: Buffer, wanted: string[]): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  if (archive.length === 0) return out;
  const extract = tar.extract();
  await new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on('data', (c: unknown) => chunks.push(c as Buffer));
      stream.on('end', () => {
        if (header.type === 'file' && wanted.includes(header.name)) out.set(header.name, Buffer.concat(chunks));
        next();
      });
      stream.on('error', reject);
    });
    extract.on('finish', resolve);
    extract.on('error', reject);
    extract.end(archive);
  });
  return out;
}

/** Collects a stream into memory, signalling when `limit` bytes are exceeded. */
class BoundedSink extends Writable {
  private chunks: Buffer[] = [];
  size = 0;
  overflowed = false;

  constructor(
    private readonly limit: number,
    private readonly onOverflow?: () => void,
  ) {
    super();
  }

  override _write(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void) {
    this.size += chunk.length;
    if (this.size > this.limit) {
      if (!this.overflowed) {
        this.overflowed = true;
        this.onOverflow?.();
      }
    } else {
      this.chunks.push(chunk);
    }
    cb();
  }

  buffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

/**
 * Runs latexmk in a fresh, locked-down container per job:
 * no network, read-only root fs, tmpfs work dir, dropped capabilities,
 * memory/CPU/pids limits, unprivileged user, wall-clock timeout.
 */
export class DockerRunner implements CompileRunner {
  private readonly docker: Docker;

  constructor(private readonly opts: DockerRunnerOptions) {
    this.docker = dockerFromOptions(opts);
  }

  async check(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.docker.ping();
    } catch (err) {
      return { ok: false, message: `Docker is not reachable: ${(err as Error).message}` };
    }
    try {
      await this.docker.getImage(this.opts.image).inspect();
    } catch {
      return {
        ok: false,
        message: `Compiler image ${this.opts.image} not found. Build it with: docker build -t ${this.opts.image} compiler`,
      };
    }
    return { ok: true, message: 'ok' };
  }

  async run(req: CompileRequest): Promise<CompileResult> {
    const base = req.mainFile.slice(req.mainFile.lastIndexOf('/') + 1).replace(/\.tex$/, '');
    const input = await packFiles(
      req.cache ? [...req.files.filter((f) => f.path !== CACHE_FILE), { path: CACHE_FILE, data: req.cache }] : req.files,
    );
    const memory = this.opts.memoryMb * 1024 * 1024;
    // No single file may outgrow what we would accept as output anyway.
    const fsize = Math.max(512 * 1024 * 1024, this.opts.maxOutputBytes);

    let container: Docker.Container;
    try {
      container = await this.docker.createContainer({
        Image: this.opts.image,
        Cmd: [req.compiler, req.mainFile],
        User: `${TEX_UID}:${TEX_UID}`,
        WorkingDir: '/work',
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        OpenStdin: true,
        StdinOnce: true,
        Tty: false,
        NetworkDisabled: true,
        Env: req.preview ? ['OVERSELLS_PREVIEW=1'] : [],
        Labels: { 'oversells.compile-job': req.jobId },
        HostConfig: {
          NetworkMode: 'none',
          ReadonlyRootfs: true,
          Memory: memory,
          MemorySwap: memory,
          NanoCpus: Math.round(this.opts.cpus * 1e9),
          PidsLimit: 256,
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges'],
          Tmpfs: {
            '/work': `rw,nosuid,nodev,noexec,size=${this.opts.workdirMb}m,uid=${TEX_UID},gid=${TEX_UID},mode=0700`,
            '/tmp': 'rw,nosuid,nodev,noexec,size=256m,mode=1777',
          },
          // Outputs travel over the attach stream; keep them out of container logs.
          LogConfig: { Type: 'none', Config: {} },
          Ulimits: [{ Name: 'fsize', Soft: fsize, Hard: fsize }],
        },
      });
    } catch (err) {
      return this.failure('error', `Could not create compile container: ${(err as Error).message}`);
    }

    let timedOut = false;
    let outputTooLarge = false;
    const kill = () => container.kill().catch(() => undefined);
    const stdout = new BoundedSink(this.opts.maxOutputBytes, () => {
      outputTooLarge = true;
      void kill();
    });
    const stderr = new BoundedSink(MAX_CONSOLE_BYTES);

    try {
      const stream = (await container.attach({
        stream: true,
        stdin: true,
        stdout: true,
        stderr: true,
        hijack: true,
      })) as unknown as Duplex;
      const streamEnded = new Promise<void>((resolve) => {
        stream.on('end', resolve);
        stream.on('close', resolve);
        stream.on('error', () => resolve());
      });
      const out = new PassThrough();
      const err = new PassThrough();
      out.pipe(stdout);
      err.pipe(stderr);
      this.docker.modem.demuxStream(stream, out, err);

      await container.start();
      stream.end(input);

      const timer = setTimeout(() => {
        timedOut = true;
        void kill();
      }, this.opts.timeoutMs);
      let exitCode: number | null = null;
      try {
        const res = (await container.wait()) as { StatusCode: number };
        exitCode = res.StatusCode;
      } finally {
        clearTimeout(timer);
      }
      // Let the attach stream drain after the process exits.
      await Promise.race([streamEnded, new Promise((r) => setTimeout(r, 2000))]);
      out.end();
      err.end();

      const state = (await container.inspect()).State;
      const console = stderr.buffer().toString('utf8');

      if (timedOut) {
        return { ...this.failure('timeout', `Compilation exceeded ${Math.round(this.opts.timeoutMs / 1000)} s`), console };
      }
      if (outputTooLarge) return { ...this.failure('error', 'Compile output is too large'), console };
      if (state.OOMKilled) return { ...this.failure('error', 'Compilation ran out of memory'), console };

      let files = new Map<string, Buffer>();
      try {
        files = await unpackOutputs(stdout.buffer(), [`${base}.pdf`, `${base}.log`, `${base}.synctex.gz`, `${base}.preview.png`, CACHE_FILE]);
      } catch {
        // A corrupt archive means no outputs; the console still explains what happened.
      }
      const log = files.get(`${base}.log`)?.toString('utf8').slice(0, MAX_LOG_CHARS) ?? null;
      const pdf = files.get(`${base}.pdf`) ?? null;
      let errorMessage: string | null = null;
      if (exitCode === 4) errorMessage = `Main file ${req.mainFile} not found`;
      else if (exitCode !== 0 && !log) errorMessage = 'The compiler did not produce a log';
      return {
        status: exitCode === 0 && pdf ? 'success' : 'failed',
        exitCode,
        log,
        console,
        pdf,
        synctex: files.get(`${base}.synctex.gz`) ?? null,
        preview: files.get(`${base}.preview.png`) ?? null,
        cache: exitCode === 0 ? (files.get(CACHE_FILE) ?? null) : null,
        errorMessage,
      };
    } catch (err) {
      return {
        ...this.failure('error', `Compile container failed: ${(err as Error).message}`),
        console: stderr.buffer().toString('utf8'),
      };
    } finally {
      await container.remove({ force: true, v: true }).catch(() => undefined);
    }
  }

  private failure(status: CompileResult['status'], message: string): CompileResult {
    return { status, exitCode: null, log: null, console: '', pdf: null, synctex: null, errorMessage: message };
  }
}
