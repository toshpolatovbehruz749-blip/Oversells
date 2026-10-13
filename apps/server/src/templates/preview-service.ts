import type { FastifyBaseLogger } from 'fastify';
import type { Storage } from '../storage/storage.js';
import type { CompileRunner } from '../compile/runner.js';
import type { CompileService } from '../compile/compile-service.js';
import type { TemplateStore } from '../projects/templates.js';

/**
 * Preview images of templates, produced by actually compiling each template
 * in the sandbox and rendering its first page. Cached in storage under the
 * template's content hash, so editing a template regenerates its preview.
 */
export class TemplatePreviewService {
  private readonly inflight = new Map<string, Promise<Buffer | null>>();

  constructor(
    private readonly templates: TemplateStore,
    private readonly storage: Storage,
    private readonly runner: CompileRunner,
    private readonly compile: CompileService,
    private readonly log: Pick<FastifyBaseLogger, 'warn' | 'info'>,
  ) {}

  /** PNG of the first page, or null when the template is unknown or failed to compile. */
  async preview(name: string): Promise<Buffer | null> {
    const template = await this.templates.find(name);
    if (!template) return null;
    const key = `templates/${template.name}/${template.hash}.png`;
    if (await this.storage.exists(key)) return this.storage.get(key);

    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.compile
        .withSlot(() =>
          this.runner.run({
            jobId: `template-${template.name}`,
            compiler: template.compiler,
            mainFile: template.mainFile,
            files: template.files,
            preview: true,
          }),
        )
        .then(async (result) => {
          if (result.status !== 'success' || !result.preview) {
            this.log.warn(`Template ${template.name} preview failed: ${result.status} ${result.errorMessage ?? ''}`);
            return null;
          }
          await this.storage.put(key, result.preview);
          return result.preview;
        })
        .catch((err: Error) => {
          this.log.warn(`Template ${template.name} preview failed: ${err.message}`);
          return null;
        })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return pending;
  }

  /** Generates all previews one after another (call in the background at start-up). */
  async warmUp(): Promise<void> {
    for (const t of await this.templates.list()) await this.preview(t.name);
    this.log.info('Template previews ready');
  }
}
