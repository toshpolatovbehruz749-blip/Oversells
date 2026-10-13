import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AI_LANGUAGES, EXERCISE_LEVELS } from '@oversells/shared';
import { parse } from '../validation.js';
import { requireUser } from '../auth/http.js';
import type { AccessService } from '../access/access-service.js';
import { shareTokenOf } from '../routes.js';
import { aiDisabled, type AiService } from './ai-service.js';
import type { AiAttachment } from './ai-client.js';
import { AppError, badRequest } from '../errors.js';

const MAX_BOOK_FILES = 5;
const MAX_BOOK_BYTES = 15 * 1024 * 1024;

/** Media type from the file's first bytes (the name and the browser's type are not trusted). */
export function sniffMediaType(data: Buffer): AiAttachment['mediaType'] | null {
  if (data.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

const idParams = z.object({ id: z.string().min(1).max(64) });
const errorBody = z.object({
  jobId: z.string().min(1).max(64),
  entry: z.number().int().nonnegative().max(10_000),
  lang: z.enum(AI_LANGUAGES),
});
const exercisesBody = z.object({
  topic: z.string().trim().min(2).max(500),
  count: z.number().int().min(1).max(20),
  level: z.enum(EXERCISE_LEVELS),
  lang: z.enum(AI_LANGUAGES),
});
const tikzBody = z.object({
  description: z.string().trim().min(3).max(2000),
  lang: z.enum(AI_LANGUAGES),
});

export async function registerAiRoutes(app: FastifyInstance, ai: AiService, access: AccessService): Promise<void> {
  /**
   * Every AI route starts here: when AI is disabled it answers 404 before
   * reading the request, so no project data is touched or sent anywhere.
   */
  const guard = async (req: FastifyRequest, need: 'read' | 'write') => {
    if (!ai.enabled) throw aiDisabled();
    const user = requireUser(req.user);
    const { id } = parse(idParams, req.params);
    await access.require(user, shareTokenOf(req), id, need);
    return { user, id };
  };

  app.get('/api/ai/status', async (req) => ({ status: await ai.status(req.user) }));

  // Explaining an error is reading; a fix is only useful to someone who can apply it.
  app.post('/api/projects/:id/ai/explain', async (req) => {
    const { user, id } = await guard(req, 'read');
    const body = parse(errorBody, req.body);
    return { result: await ai.explain(user, id, body.jobId, body.entry, body.lang) };
  });

  app.post('/api/projects/:id/ai/fix', async (req) => {
    const { user, id } = await guard(req, 'write');
    const body = parse(errorBody, req.body);
    return { result: await ai.fix(user, id, body.jobId, body.entry, body.lang) };
  });

  app.post('/api/projects/:id/ai/exercises', async (req) => {
    const { user, id } = await guard(req, 'write');
    return { result: await ai.exercises(user, id, parse(exercisesBody, req.body)) };
  });

  app.post('/api/projects/:id/ai/tikz', async (req) => {
    const { user, id } = await guard(req, 'write');
    return { result: await ai.tikz(user, id, parse(tikzBody, req.body)) };
  });

  /**
   * A design from pages of a book: up to 5 files (PDF pages or photos/scans,
   * 15 MB in total) as multipart, wishes and language in the query string.
   */
  app.post('/api/ai/design-from-book', async (req) => {
    if (!ai.enabled) throw aiDisabled();
    const user = requireUser(req.user);
    const query = parse(
      z.object({ wishes: z.string().trim().max(1000).default(''), lang: z.enum(AI_LANGUAGES).default('uz') }),
      req.query,
    );
    if (!req.isMultipart()) throw badRequest('invalid_request', 'Expected multipart/form-data');
    const attachments: AiAttachment[] = [];
    let total = 0;
    for await (const part of req.files()) {
      const data = await part.toBuffer();
      total += data.length;
      if (attachments.length >= MAX_BOOK_FILES || total > MAX_BOOK_BYTES) {
        throw new AppError(413, 'book_too_large', 'Send at most 5 files and 15 MB');
      }
      const mediaType = sniffMediaType(data);
      if (!mediaType) throw badRequest('book_file_type', 'Only PDF, PNG, JPEG and WebP files are accepted');
      attachments.push({ mediaType, data: data.toString('base64') });
    }
    if (attachments.length === 0) throw badRequest('no_files', 'No files were uploaded');
    return { result: await ai.designFromBook(user, attachments, query.wishes, query.lang) };
  });
}
