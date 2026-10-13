import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AI_LANGUAGES, EXERCISE_LEVELS } from '@oversells/shared';
import { parse } from '../validation.js';
import { requireUser } from '../auth/http.js';
import type { AccessService } from '../access/access-service.js';
import { shareTokenOf } from '../routes.js';
import { aiDisabled, type AiService } from './ai-service.js';

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
}
