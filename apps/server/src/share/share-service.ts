import type { PrismaClient, ShareLink, User } from '@prisma/client';
import type { ShareLinkDTO, ShareResolutionDTO, ShareRole } from '@oversells/shared';
import { badRequest, notFound } from '../errors.js';
import { randomToken } from '../auth/crypto.js';

export const MAX_ACTIVE_LINKS = 20;

export function toShareLinkDTO(l: ShareLink): ShareLinkDTO {
  return { id: l.id, role: l.role, token: l.token, createdAt: l.createdAt.toISOString() };
}

/** Revocable capability links (viewer or editor) to a project. */
export class ShareService {
  constructor(private readonly prisma: PrismaClient) {}

  list(projectId: string): Promise<ShareLink[]> {
    return this.prisma.shareLink.findMany({
      where: { projectId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(projectId: string, role: ShareRole, createdBy: User): Promise<ShareLink> {
    const active = await this.prisma.shareLink.count({ where: { projectId, revokedAt: null } });
    if (active >= MAX_ACTIVE_LINKS) throw badRequest('too_many_links', 'Revoke an existing link first');
    return this.prisma.shareLink.create({
      data: { projectId, role, token: randomToken(24), createdById: createdBy.id },
    });
  }

  async revoke(projectId: string, linkId: string): Promise<void> {
    const res = await this.prisma.shareLink.updateMany({
      where: { id: linkId, projectId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count === 0) throw notFound('Share link');
  }

  /** Looks up an active link; 404 when unknown or revoked. */
  async resolve(token: string, user: User | null): Promise<ShareResolutionDTO> {
    const link =
      token.length <= 64
        ? await this.prisma.shareLink.findUnique({ where: { token }, include: { project: true } })
        : null;
    if (!link || link.revokedAt) throw notFound('Share link');
    const owner = user?.id === link.project.ownerId;
    return {
      projectId: link.projectId,
      projectName: link.project.name,
      linkRole: link.role,
      role: owner || (link.role === 'editor' && user) ? 'editor' : 'viewer',
    };
  }
}
