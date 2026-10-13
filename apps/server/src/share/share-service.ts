import type { PrismaClient, ShareLink, User } from '@prisma/client';
import type { SharedProjectDTO, ShareLinkDTO, ShareResolutionDTO, ShareRole } from '@oversells/shared';
import { toProjectDTO } from '../dto.js';
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

  /** Revokes a link and forgets it from everyone's "shared with me". Returns its token. */
  async revoke(projectId: string, linkId: string): Promise<string> {
    const link = await this.prisma.shareLink.findFirst({ where: { id: linkId, projectId, revokedAt: null } });
    if (!link) throw notFound('Share link');
    await this.prisma.$transaction([
      this.prisma.shareLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } }),
      this.prisma.sharedProjectAccess.deleteMany({ where: { shareLinkId: link.id } }),
    ]);
    return link.token;
  }

  /** Projects shared with the user through links they opened, newest first. */
  async sharedWith(user: User): Promise<SharedProjectDTO[]> {
    const rows = await this.prisma.sharedProjectAccess.findMany({
      where: { userId: user.id, shareLink: { revokedAt: null }, project: { ownerId: { not: user.id }, owner: { blockedAt: null } } },
      orderBy: { lastOpenedAt: 'desc' },
      include: { shareLink: true, project: { include: { owner: { select: { name: true } } } } },
    });
    // One entry per project: prefer an editor link.
    const byProject = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const seen = byProject.get(r.projectId);
      if (!seen || (seen.shareLink.role === 'viewer' && r.shareLink.role === 'editor')) byProject.set(r.projectId, r);
    }
    return [...byProject.values()].map((r) => ({
      ...toProjectDTO(r.project),
      role: r.shareLink.role,
      token: r.shareLink.token,
      ownerName: r.project.owner.name,
      lastOpenedAt: r.lastOpenedAt.toISOString(),
    }));
  }

  /** Looks up an active link; 404 when unknown or revoked. */
  async resolve(token: string, user: User | null): Promise<ShareResolutionDTO> {
    const link =
      token.length <= 64
        ? await this.prisma.shareLink.findUnique({ where: { token }, include: { project: true } })
        : null;
    if (!link || link.revokedAt) throw notFound('Share link');
    const owner = user?.id === link.project.ownerId;
    if (user && !owner) {
      // Remember it for the user's "shared with me" list.
      await this.prisma.sharedProjectAccess.upsert({
        where: { userId_shareLinkId: { userId: user.id, shareLinkId: link.id } },
        create: { userId: user.id, shareLinkId: link.id, projectId: link.projectId },
        update: { lastOpenedAt: new Date() },
      });
    }
    return {
      projectId: link.projectId,
      projectName: link.project.name,
      linkRole: link.role,
      role: owner || (link.role === 'editor' && user) ? 'editor' : 'viewer',
    };
  }
}
