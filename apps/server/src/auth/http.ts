import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { User } from '@prisma/client';
import type { UserDTO } from '@oversells/shared';
import { z } from 'zod';
import { randomToken } from './crypto.js';
import { unauthorized, type AuthService } from './auth-service.js';
import { parse } from '../validation.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The logged-in user, or null. Set for every /api request. */
    user: User | null;
  }
}

export const SESSION_COOKIE = 'oversells_session';
/** Double-submit CSRF cookie: readable by the page, echoed in X-CSRF-Token. */
export const CSRF_COOKIE = 'oversells_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface AuthHttpOptions {
  cookieSecure: boolean;
  rateLimit: { max: number; timeWindow: number };
}

export function toUserDTO(u: User): UserDTO {
  return { id: u.id, email: u.email, name: u.name };
}

/** Throws 401 unless a user is logged in. */
export function requireUser(user: User | null): User {
  if (!user) throw unauthorized();
  return user;
}

function sameToken(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Installs the request hooks: issues the CSRF cookie, rejects state-changing
 * API requests without a matching X-CSRF-Token header, and resolves the
 * session cookie to `req.user`.
 */
export function registerAuthHooks(app: FastifyInstance, auth: AuthService, opts: AuthHttpOptions): void {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const csrfCookie = req.cookies[CSRF_COOKIE];
    if (!csrfCookie) {
      reply.setCookie(CSRF_COOKIE, randomToken(18), {
        path: '/',
        sameSite: 'lax',
        secure: opts.cookieSecure,
        httpOnly: false,
      });
    }
    if (!SAFE_METHODS.has(req.method)) {
      const header = req.headers[CSRF_HEADER];
      if (typeof header !== 'string' || !csrfCookie || !sameToken(header, csrfCookie)) {
        return reply.code(403).send({ error: { code: 'csrf_failed', message: 'Missing or invalid CSRF token' } });
      }
    }
    req.user = await auth.userForSession(req.cookies[SESSION_COOKIE]);
  });
}

export async function registerAuthRoutes(app: FastifyInstance, auth: AuthService, opts: AuthHttpOptions) {
  const limited = { config: { rateLimit: opts.rateLimit } };

  const startSession = async (reply: FastifyReply, user: User) => {
    const { token, expiresAt } = await auth.createSession(user.id);
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: opts.cookieSecure,
      expires: expiresAt,
    });
  };

  app.get('/api/auth/me', async (req) => ({ user: req.user ? toUserDTO(req.user) : null }));

  app.post('/api/auth/register', limited, async (req, reply) => {
    const body = parse(z.object({ email: z.string(), password: z.string(), name: z.string().optional() }), req.body);
    const user = await auth.register(body);
    await startSession(reply, user);
    reply.code(201);
    return { user: toUserDTO(user) };
  });

  app.post('/api/auth/login', limited, async (req, reply) => {
    const body = parse(z.object({ email: z.string(), password: z.string() }), req.body);
    const user = await auth.verifyCredentials(body.email, body.password);
    await startSession(reply, user);
    return { user: toUserDTO(user) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await auth.destroySession(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    reply.code(204);
  });

  app.post('/api/auth/password-reset/request', limited, async (req) => {
    const body = parse(z.object({ email: z.string(), lang: z.enum(['uz', 'ru', 'en']).optional() }), req.body);
    await auth.requestPasswordReset(body.email, body.lang);
    // Same answer whether or not the account exists.
    return { ok: true };
  });

  app.post('/api/auth/password-reset/confirm', limited, async (req) => {
    const body = parse(z.object({ token: z.string(), password: z.string() }), req.body);
    await auth.resetPassword(body.token, body.password);
    return { ok: true };
  });
}
