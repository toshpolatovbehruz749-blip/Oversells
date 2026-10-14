import type { Compiler } from '@oversells/shared';

export interface CompileInputFile {
  path: string;
  data: Buffer;
}

export interface CompileRequest {
  jobId: string;
  compiler: Compiler;
  mainFile: string;
  files: CompileInputFile[];
  /** Also render the first page as PNG (used for template previews). */
  preview?: boolean;
  /** Auxiliary files of the previous successful compile (a tar archive). */
  cache?: Buffer | null;
}

export type RunnerStatus = 'success' | 'failed' | 'timeout' | 'error';

export interface CompileResult {
  status: RunnerStatus;
  exitCode: number | null;
  /** Contents of <main>.log, if produced. */
  log: string | null;
  /** latexmk console output (stderr of the job). */
  console: string;
  pdf: Buffer | null;
  synctex: Buffer | null;
  /** First page as PNG when the request asked for a preview. */
  preview?: Buffer | null;
  /** Auxiliary files (.aux, .toc, ...) of a successful compile, for the next one. */
  cache?: Buffer | null;
  errorMessage: string | null;
}

/**
 * Runs one compile job in isolation. The only production implementation is
 * DockerRunner; tests use fakes. User LaTeX must never run on the host.
 */
export interface CompileRunner {
  run(request: CompileRequest): Promise<CompileResult>;
  /** Checks that the runner can work (e.g. Docker reachable, image present). */
  check(): Promise<{ ok: boolean; message: string }>;
}
