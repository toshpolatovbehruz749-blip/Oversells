import type { CompileRequest, CompileResult, CompileRunner } from '../../src/compile/runner.js';

export const FAKE_PDF = Buffer.from('%PDF-1.5\n% fake\n%%EOF\n');
export const FAKE_PNG = Buffer.from('89504e470d0a1a0a66616b65', 'hex');

/** Scriptable CompileRunner for unit tests; records every request. */
export class FakeRunner implements CompileRunner {
  requests: CompileRequest[] = [];
  running = 0;
  maxRunning = 0;
  /** Resolvers for jobs paused by `hold`. */
  private gates: Array<() => void> = [];
  hold = false;
  result: (req: CompileRequest) => CompileResult | Promise<CompileResult> = () => ({
    status: 'success',
    exitCode: 0,
    log: 'This is a fake log\n',
    console: 'Latexmk: fake',
    pdf: FAKE_PDF,
    synctex: null,
    errorMessage: null,
  });

  async check() {
    return { ok: true, message: 'fake' };
  }

  async run(req: CompileRequest): Promise<CompileResult> {
    this.requests.push(req);
    this.running++;
    this.maxRunning = Math.max(this.maxRunning, this.running);
    try {
      if (this.hold) await new Promise<void>((resolve) => this.gates.push(resolve));
      const result = await this.result(req);
      return req.preview && result.status === 'success' ? { ...result, preview: FAKE_PNG } : result;
    } finally {
      this.running--;
    }
  }

  /** Releases all held jobs. */
  release(): void {
    this.hold = false;
    for (const g of this.gates.splice(0)) g();
  }

  get waiting(): number {
    return this.gates.length;
  }
}
