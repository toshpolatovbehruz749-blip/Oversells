import * as Y from 'yjs';
import type { Comment, PrismaClient, User } from '@prisma/client';
import type { CommentThreadDTO } from '@oversells/shared';
import { badRequest, forbidden, notFound } from '../errors.js';
import type { DocManager } from '../collab/doc-manager.js';

export const MAX_COMMENT_LENGTH = 5000;

type CommentWithAuthor = Comment & { author: Pick<User, 'id' | 'name'> };
type Thread = CommentWithAuthor & { replies: CommentWithAuthor[] };

const authorSelect = { select: { id: true, name: true } } as const;

function normalizeBody(body: unknown): string {
  const text = typeof body === 'string' ? body.normalize('NFC').trim() : '';
  if (!text) throw badRequest('invalid_comment', 'Comment text is required');
  if (text.length > MAX_COMMENT_LENGTH) throw badRequest('invalid_comment', 'Comment is too long');
  return text;
}

function decodeAnchor(b64: unknown): Uint8Array {
  if (typeof b64 !== 'string' || b64.length > 2000) throw badRequest('invalid_anchor', 'Invalid comment anchor');
  const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  try {
    Y.decodeRelativePosition(bytes);
  } catch {
    throw badRequest('invalid_anchor', 'Invalid comment anchor');
  }
  return bytes;
}

/** Absolute index of a relative position in the file's Y.Text, or null if its text is gone. */
export function resolveAnchor(doc: Y.Doc, text: Y.Text, anchor: Uint8Array): number | null {
  const abs = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(anchor), doc);
  return abs && abs.type === text ? abs.index : null;
}

/**
 * Comment threads on text ranges. A thread stores its range as two Yjs
 * relative positions, so it keeps pointing at the same text while people
 * edit around it (and through version restores, which are applied as diffs).
 */
export class CommentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly docs: DocManager,
  ) {}

  async list(projectId: string, fileId?: string): Promise<CommentThreadDTO[]> {
    const threads = (await this.prisma.comment.findMany({
      where: { projectId, parentId: null, ...(fileId ? { fileId } : {}) },
      orderBy: { createdAt: 'asc' },
      include: { author: authorSelect, replies: { orderBy: { createdAt: 'asc' }, include: { author: authorSelect } } },
    })) as Thread[];
    return Promise.all(threads.map((t) => this.toDTO(t)));
  }

  private async toDTO(t: Thread): Promise<CommentThreadDTO> {
    let from: number | null = null;
    let to: number | null = null;
    if (t.anchorStart && t.anchorEnd) {
      const shared = await this.docs.open(t.fileId);
      from = resolveAnchor(shared.doc, shared.text, t.anchorStart);
      to = resolveAnchor(shared.doc, shared.text, t.anchorEnd);
      // A range that collapsed although it covered text means the text was deleted.
      if (from === null || to === null || to < from || (to === from && (t.quote ?? '') !== '')) {
        from = null;
        to = null;
      }
    }
    return {
      id: t.id,
      fileId: t.fileId,
      author: t.author,
      body: t.body,
      anchorStart: Buffer.from(t.anchorStart ?? []).toString('base64'),
      anchorEnd: Buffer.from(t.anchorEnd ?? []).toString('base64'),
      from,
      to,
      quote: t.quote ?? '',
      resolved: t.resolvedAt !== null,
      resolvedAt: t.resolvedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      replies: t.replies.map((r) => ({ id: r.id, author: r.author, body: r.body, createdAt: r.createdAt.toISOString() })),
    };
  }

  private async thread(projectId: string, id: string): Promise<Thread> {
    const t = (await this.prisma.comment.findFirst({
      where: { id, projectId, parentId: null },
      include: { author: authorSelect, replies: { orderBy: { createdAt: 'asc' }, include: { author: authorSelect } } },
    })) as Thread | null;
    if (!t) throw notFound('Comment');
    return t;
  }

  /** Starts a thread on the range [anchorStart, anchorEnd) of a text file. */
  async create(
    projectId: string,
    user: User,
    input: { fileId: string; anchorStart: string; anchorEnd: string; body: string },
  ): Promise<CommentThreadDTO> {
    const file = await this.prisma.projectFile.findFirst({ where: { id: input.fileId, projectId } });
    if (!file) throw notFound('File');
    if (file.kind !== 'text') throw badRequest('not_text_file', 'Comments need a text file');
    const body = normalizeBody(input.body);
    const anchorStart = decodeAnchor(input.anchorStart);
    const anchorEnd = decodeAnchor(input.anchorEnd);
    const shared = await this.docs.open(file.id);
    const from = resolveAnchor(shared.doc, shared.text, anchorStart);
    const to = resolveAnchor(shared.doc, shared.text, anchorEnd);
    if (from === null || to === null || to < from) throw badRequest('invalid_anchor', 'The commented text does not exist');
    const created = await this.prisma.comment.create({
      data: {
        projectId,
        fileId: file.id,
        authorId: user.id,
        body,
        anchorStart: Buffer.from(anchorStart),
        anchorEnd: Buffer.from(anchorEnd),
        quote: shared.text.toString().slice(from, to).slice(0, 500),
      },
    });
    return this.toDTO(await this.thread(projectId, created.id));
  }

  async reply(projectId: string, user: User, threadId: string, body: unknown): Promise<CommentThreadDTO> {
    const t = await this.thread(projectId, threadId);
    await this.prisma.comment.create({
      data: { projectId, fileId: t.fileId, parentId: t.id, authorId: user.id, body: normalizeBody(body) },
    });
    return this.toDTO(await this.thread(projectId, threadId));
  }

  async setResolved(projectId: string, user: User, threadId: string, resolved: boolean): Promise<CommentThreadDTO> {
    await this.thread(projectId, threadId);
    await this.prisma.comment.update({
      where: { id: threadId },
      data: resolved ? { resolvedAt: new Date(), resolvedById: user.id } : { resolvedAt: null, resolvedById: null },
    });
    return this.toDTO(await this.thread(projectId, threadId));
  }

  /** Deletes a thread or a reply: its author or the project owner may do this. */
  async delete(projectId: string, user: User, commentId: string, isOwner: boolean): Promise<void> {
    const c = await this.prisma.comment.findFirst({ where: { id: commentId, projectId } });
    if (!c) throw notFound('Comment');
    if (c.authorId !== user.id && !isOwner) throw forbidden('forbidden', 'Only the author or the owner can delete this');
    await this.prisma.comment.delete({ where: { id: c.id } });
  }
}
