import type { PrismaClient, User } from '@prisma/client';
import type {
  AiExplainDTO,
  AiFixDTO,
  AiKind,
  AiLanguage,
  AiSnippetDTO,
  AiStatusDTO,
  ExerciseLevel,
  LogEntry,
} from '@oversells/shared';
import { AppError, badRequest, notFound } from '../errors.js';
import type { CompileService } from '../compile/compile-service.js';
import type { DocManager } from '../collab/doc-manager.js';
import type { AiClient, AiCompletion } from './ai-client.js';
import {
  exercisesPrompt,
  explainPrompt,
  fixPrompt,
  numbered,
  systemPrompt,
  tikzPrompt,
  type ErrorContext,
} from './prompts.js';

export interface AiServiceOptions {
  /** Null when AI is disabled: nothing is ever sent anywhere. */
  client: AiClient | null;
  dailyLimit: number;
}

export const aiDisabled = () => new AppError(404, 'ai_disabled', 'AI assistance is not enabled on this server');

/** Lines of context sent with an explanation and replaced by a fix. */
const EXPLAIN_CONTEXT_LINES = 8;
const FIX_CONTEXT_LINES = 20;

const EXPLAIN_SCHEMA = {
  type: 'object',
  properties: { explanation: { type: 'string' } },
  required: ['explanation'],
  additionalProperties: false,
};
const FIX_SCHEMA = {
  type: 'object',
  properties: { replacement: { type: 'string' }, explanation: { type: 'string' } },
  required: ['replacement', 'explanation'],
  additionalProperties: false,
};
const EXERCISES_SCHEMA = {
  type: 'object',
  properties: { latex: { type: 'string' } },
  required: ['latex'],
  additionalProperties: false,
};
const TIKZ_SCHEMA = {
  type: 'object',
  properties: { latex: { type: 'string' }, libraries: { type: 'array', items: { type: 'string' } } },
  required: ['latex', 'libraries'],
  additionalProperties: false,
};

function str(data: unknown, key: string): string {
  const v = (data as Record<string, unknown> | null)?.[key];
  if (typeof v !== 'string') throw new AppError(502, 'ai_unavailable', 'The AI answer could not be read');
  return v;
}

function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Does the preamble load the package (also inside a list such as \usepackage{amsmath,tikz})? */
export function loadsPackage(preamble: string, pkg: string): boolean {
  const re = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
  for (const m of preamble.replace(/(^|[^\\])%.*$/gm, '$1').matchAll(re)) {
    if (m[1]!.split(',').some((p) => p.trim() === pkg)) return true;
  }
  return false;
}

export function loadsTikzLibrary(preamble: string, lib: string): boolean {
  const re = /\\usetikzlibrary\s*\{([^}]*)\}/g;
  for (const m of preamble.replace(/(^|[^\\])%.*$/gm, '$1').matchAll(re)) {
    if (m[1]!.split(',').some((p) => p.trim() === lib)) return true;
  }
  return false;
}

export class AiService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly compile: CompileService,
    private readonly docs: DocManager,
    private readonly opts: AiServiceOptions,
  ) {}

  get enabled(): boolean {
    return this.opts.client !== null;
  }

  limitFor(user: User): number {
    return user.aiDailyLimit ?? this.opts.dailyLimit;
  }

  async status(user: User | null): Promise<AiStatusDTO> {
    if (!this.enabled || !user) return { enabled: this.enabled, remaining: null, dailyLimit: null };
    const limit = this.limitFor(user);
    const used = await this.prisma.aiRequest.count({
      where: { userId: user.id, createdAt: { gte: startOfUtcDay() } },
    });
    return { enabled: true, remaining: Math.max(0, limit - used), dailyLimit: limit };
  }

  // --- features --------------------------------------------------------------

  async explain(user: User, projectId: string, jobId: string, entryIndex: number, lang: AiLanguage): Promise<AiExplainDTO> {
    const client = this.requireClient();
    const ctx = await this.errorContext(projectId, jobId, entryIndex);
    const source = ctx.fileId && ctx.entry.line ? await this.excerpt(ctx.fileId, ctx.entry.line, EXPLAIN_CONTEXT_LINES) : null;
    return this.run(
      user,
      projectId,
      'explain',
      () =>
        client.complete({
          system: systemPrompt('explain', lang),
          prompt: explainPrompt({ ...ctx.error, source: source && numbered(source.lines, source.start) }),
          schema: EXPLAIN_SCHEMA,
        }),
      (data) => ({ explanation: str(data, 'explanation').trim() }),
    );
  }

  async fix(user: User, projectId: string, jobId: string, entryIndex: number, lang: AiLanguage): Promise<AiFixDTO> {
    const client = this.requireClient();
    const ctx = await this.errorContext(projectId, jobId, entryIndex);
    if (!ctx.fileId || !ctx.entry.line) {
      throw badRequest('no_location', 'This message does not point to a line in a project file');
    }
    const ex = await this.excerpt(ctx.fileId, ctx.entry.line, FIX_CONTEXT_LINES);
    const original = ex.lines.join('\n');
    const fileId = ctx.fileId;
    return this.run(
      user,
      projectId,
      'fix',
      () =>
        client.complete({
          system: systemPrompt('fix', lang),
          prompt: fixPrompt({ ...ctx.error, source: null }, original),
          schema: FIX_SCHEMA,
        }),
      (data) => {
        let suggestion = str(data, 'replacement').replace(/\r\n/g, '\n');
        // Models sometimes add one final newline; the excerpt has none.
        if (suggestion.endsWith('\n') && !original.endsWith('\n')) suggestion = suggestion.slice(0, -1);
        return {
          fileId,
          path: ctx.entry.file!,
          startLine: ex.start,
          endLine: ex.start + ex.lines.length - 1,
          original,
          suggestion,
          explanation: str(data, 'explanation').trim(),
        };
      },
    );
  }

  async exercises(
    user: User,
    projectId: string,
    input: { topic: string; count: number; level: ExerciseLevel; lang: AiLanguage },
  ): Promise<AiSnippetDTO> {
    const client = this.requireClient();
    const preamble = await this.preamble(projectId);
    const latex = await this.run(
      user,
      projectId,
      'exercises',
      () =>
        client.complete({
          system: systemPrompt('exercises', input.lang),
          prompt: exercisesPrompt(input.lang, input.topic, input.count, input.level),
          schema: EXERCISES_SCHEMA,
        }),
      (data) => str(data, 'latex').trim(),
    );
    const additions: string[] = [];
    if (preamble !== null) {
      for (const pkg of ['amsmath', 'amssymb']) {
        if (!loadsPackage(preamble, pkg)) additions.push(`\\usepackage{${pkg}}`);
      }
    }
    return { latex, preambleAdditions: additions };
  }

  async tikz(user: User, projectId: string, input: { description: string; lang: AiLanguage }): Promise<AiSnippetDTO> {
    const client = this.requireClient();
    const preamble = await this.preamble(projectId);
    const { latex, libraries } = await this.run(
      user,
      projectId,
      'tikz',
      () =>
        client.complete({
          system: systemPrompt('tikz', input.lang),
          prompt: tikzPrompt(input.description),
          schema: TIKZ_SCHEMA,
        }),
      (data) => {
        const latex = str(data, 'latex').trim();
        if (!/\\begin\{tikzpicture\}/.test(latex)) {
          throw new AppError(502, 'ai_unavailable', 'The AI answer was not a TikZ picture');
        }
        const raw = (data as { libraries?: unknown }).libraries;
        const libraries = (Array.isArray(raw) ? raw : []).filter(
          (l): l is string => typeof l === 'string' && /^[A-Za-z][A-Za-z0-9.-]{0,40}$/.test(l),
        );
        return { latex, libraries };
      },
    );
    const additions: string[] = [];
    if (preamble !== null) {
      if (!loadsPackage(preamble, 'tikz')) additions.push('\\usepackage{tikz}');
      const missing = libraries.filter((l) => !loadsTikzLibrary(preamble, l));
      if (missing.length) additions.push(`\\usetikzlibrary{${missing.join(',')}}`);
    }
    return { latex, preambleAdditions: additions };
  }

  // --- helpers ---------------------------------------------------------------

  private requireClient(): AiClient {
    if (!this.opts.client) throw aiDisabled();
    return this.opts.client;
  }

  /**
   * Reserves one request of the user's daily quota, runs the call, and records
   * the token usage. A request the provider could not serve is not counted.
   */
  private async run<T>(
    user: User,
    projectId: string,
    kind: AiKind,
    call: () => Promise<AiCompletion>,
    read: (data: unknown) => T,
  ): Promise<T> {
    const limit = this.limitFor(user);
    const reserved = await this.prisma.$transaction(async (tx) => {
      // Serialises concurrent requests of one user so the limit holds exactly.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'ai:' + user.id}))`;
      const used = await tx.aiRequest.count({ where: { userId: user.id, createdAt: { gte: startOfUtcDay() } } });
      if (used >= limit) return null;
      return tx.aiRequest.create({ data: { userId: user.id, projectId, kind } });
    });
    if (!reserved) throw new AppError(429, 'ai_quota', 'You have used all AI requests for today');
    try {
      const result = await call();
      const value = read(result.data); // an unusable answer is not charged either
      await this.prisma.aiRequest.update({
        where: { id: reserved.id },
        data: { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
      });
      return value;
    } catch (err) {
      const code = err instanceof AppError ? err.code : null;
      if (code === 'ai_refused') {
        await this.prisma.aiRequest.update({ where: { id: reserved.id }, data: { ok: false } });
      } else {
        await this.prisma.aiRequest.delete({ where: { id: reserved.id } }).catch(() => undefined);
      }
      throw err;
    }
  }

  private async errorContext(projectId: string, jobId: string, entryIndex: number) {
    const job = await this.compile.get(projectId, jobId);
    const entries = (job.entries ?? []) as unknown as LogEntry[];
    const entry = entries[entryIndex];
    if (!entry) throw notFound('Log entry');
    let fileId: string | null = null;
    if (entry.file) {
      const file = await this.prisma.projectFile.findUnique({
        where: { projectId_path: { projectId, path: entry.file } },
      });
      if (file?.kind === 'text') fileId = file.id;
    }
    const error: ErrorContext = {
      message: entry.message,
      file: entry.file,
      line: entry.line,
      logContext: entry.context.slice(0, 2000),
      source: null,
      compiler: job.compiler,
    };
    return { entry, fileId, error };
  }

  /** Lines around `line` (1-based) of a text file, from the live document. */
  private async excerpt(fileId: string, line: number, radius: number): Promise<{ start: number; lines: string[] }> {
    const all = (await this.docs.getText(fileId)).split('\n');
    const at = Math.min(Math.max(line, 1), all.length);
    const start = Math.max(1, at - radius);
    const end = Math.min(all.length, at + radius);
    return { start, lines: all.slice(start - 1, end) };
  }

  /** The main file up to \begin{document}, or null when there is none. */
  private async preamble(projectId: string): Promise<string | null> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound('Project');
    const main = await this.prisma.projectFile.findUnique({
      where: { projectId_path: { projectId, path: project.mainFile } },
    });
    if (!main || main.kind !== 'text') return null;
    const text = await this.docs.getText(main.id);
    const i = text.indexOf('\\begin{document}');
    return i === -1 ? text : text.slice(0, i);
  }
}
