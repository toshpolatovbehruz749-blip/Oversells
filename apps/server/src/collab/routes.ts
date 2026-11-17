import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import type { ProjectRole } from '@oversells/shared';
import { forbidden, notFound } from '../errors.js';
import { parse } from '../validation.js';
import type { AccessService } from '../access/access-service.js';
import type { DocManager, CollabConnection } from './doc-manager.js';
import { shareTokenOf } from '../routes.js';

const params = z.object({ id: z.string().min(1).max(64), fileId: z.string().min(1).max(64) });

const PING_INTERVAL_MS = 30_000;

declare module 'fastify' {
  interface FastifyRequest {
    collabRole?: ProjectRole;
  }
}

/**
 * Rejects cross-site WebSocket hijacking: browsers always send Origin on
 * WebSocket handshakes, and it must be this site. Non-browser clients
 * (no Origin) are judged by their credentials alone.
 */
export function originAllowed(req: FastifyRequest, appUrl: string): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === req.headers.host || host === new URL(appUrl).host;
  } catch {
    return false;
  }
}

/**
 * GET /api/collab/:id/:fileId (WebSocket, y-websocket protocol).
 * Owners and editors may change the document; viewers receive it read-only;
 * everyone else is refused before the upgrade (404).
 */
export async function registerCollabRoutes(
  app: FastifyInstance,
  deps: { docs: DocManager; access: AccessService; prisma: PrismaClient; appUrl: string },
): Promise<void> {
  app.get(
    '/api/collab/:id/:fileId',
    {
      websocket: true,
      preValidation: async (req) => {
        if (!originAllowed(req, deps.appUrl)) throw forbidden('bad_origin', 'Cross-site WebSocket refused');
        const { id, fileId } = parse(params, req.params);
        const { role } = await deps.access.require(req.user, shareTokenOf(req), id, 'read');
        const file = await deps.prisma.projectFile.findFirst({ where: { id: fileId, projectId: id } });
        if (!file || file.kind !== 'text') throw notFound('File');
        req.collabRole = role;
      },
    },
    (socket: WebSocket, req) => {
      const { fileId } = req.params as { fileId: string };
      const conn: CollabConnection = {
        readOnly: req.collabRole === 'viewer',
        shareToken: shareTokenOf(req),
        userId: req.user?.id ?? null,
        send: (data) => {
          if (socket.readyState === socket.OPEN) socket.send(data, (err) => err && socket.terminate());
        },
        close: (code, reason) => socket.close(code, reason),
      };

      // Messages can arrive while the document is still loading.
      const queue: Uint8Array[] = [];
      let handlers: Awaited<ReturnType<DocManager['connect']>> | null = null;
      let closed = false;
      socket.on('message', (data: Buffer) => {
        const bytes = new Uint8Array(data);
        if (handlers) handlers.message(bytes);
        else queue.push(bytes);
      });

      let alive = true;
      socket.on('pong', () => (alive = true));
      const ping = setInterval(() => {
        if (!alive) return socket.terminate();
        alive = false;
        socket.ping();
      }, PING_INTERVAL_MS);

      socket.on('close', () => {
        closed = true;
        clearInterval(ping);
        handlers?.close();
      });

      deps.docs.connect(fileId, conn).then(
        (h) => {
          handlers = h;
          if (closed) return h.close();
          for (const m of queue.splice(0)) h.message(m);
        },
        (err: Error) => {
          req.log.warn({ err }, 'Could not open document');
          socket.close(1011, 'could not open document');
        },
      );
    },
  );
}
