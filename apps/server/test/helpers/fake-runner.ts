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

  /** Result of conversions (pandoc); defaults to small fake outputs. */
  convertResult: (req: CompileRequest) => CompileResult = (req) => ({
    status: 'success',
    exitCode: 0,
    log: null,
    console: 'pandoc: fake',
    pdf: null,
    synctex: null,
    errorMessage: null,
    outputs:
      req.convert === 'pdf-to-text'
        ? [
            { path: 'text.txt', data: Buffer.from('BIRINCHI BOB\n\nQishloq tongi goʻzal edi.\n\n   1\n\f') },
            { path: 'info.txt', data: Buffer.from('Pages:          1\nPage size:       419.528 x 595.276 pts (A5)\n') },
          ]
        : req.convert === 'docx-styles-to-latex'
        ? [
            {
              path: 'main.tex',
              data: Buffer.from(
                '\\documentclass{article}\n\\begin{document}\n\\begin{uslub}{iqtibos}\nIqtibos.\n\\end{uslub}\n\\matnuslubi{atama}{atama}\n\\end{document}\n',
              ),
            },
            { path: 'media/rasm.png', data: FAKE_PNG },
            { path: 'styles.txt', data: Buffer.from('p\tiqtibos\tIqtibos\nc\tatama\tAtama') },
          ]
        : req.convert === 'docx-to-latex'
        ? [
            { path: 'main.tex', data: Buffer.from('\\documentclass{article}\n\\begin{document}\nWord matni.\n\\includegraphics{media/rasm.png}\n\\end{document}\n') },
            { path: 'media/rasm.png', data: FAKE_PNG },
          ]
        : req.convert === 'pdf-preflight'
          ? [
              { path: 'info.txt', data: Buffer.from('Pages:           6\n') },
              {
                path: 'fonts.txt',
                data: Buffer.from('name type encoding emb sub uni object ID\n---\nABCDEF+NotoSerif-Regular CID TrueType Identity-H yes yes yes 10 0\n'),
              },
              { path: 'images.txt', data: Buffer.from('page num type\n---\n   2     0 image     300   200  rgb     3   8  image  no 15  0    72    72  657B 0.4%\n') },
              { path: 'pages.txt', data: Buffer.from('1 120\n2 40\n3 0\n4 10\n5 10\n6 10\n') },
            ]
          : [{ path: req.convert === 'latex-to-docx' ? 'output.docx' : 'output.epub', data: Buffer.from('PK fake') }],
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
      if (req.convert) return await this.convertResult(req);
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
