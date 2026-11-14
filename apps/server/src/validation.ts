import type { z } from 'zod';
import { badRequest } from './errors.js';

/** Parses request input with a Zod schema; throws a 400 AppError on failure. */
export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const res = schema.safeParse(value);
  if (!res.success) {
    const issue = res.error.issues[0];
    throw badRequest('invalid_request', issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request');
  }
  return res.data;
}
