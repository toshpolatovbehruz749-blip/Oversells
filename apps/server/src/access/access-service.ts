import type { PrismaClient, Project, User } from '@prisma/client';
import type { ProjectRole } from '@oversells/shared';
import { forbidden, notFound } from '../errors.js';

export type AccessNeed = 'read' | 'write' | 'owner';

const RANK: Record<ProjectRole, number> = { viewer: 0, editor: 1, owner: 2 };
const NEEDED: Record<AccessNeed, ProjectRole> = { read: 'viewer', write: 'editor', owner: 'owner' };

export interface ProjectAccess {
  project: Project;
  role: ProjectRole;
}

/**
 * Decides what a caller may do with a project:
 *  - the owner (logged-in user who created it) may do everything;
 *  - a valid, unrevoked share link grants its role; an editor link only
 *    grants editing to logged-in users, anonymous holders get viewer access;
 *  - everyone else gets 404, so project ids cannot be probed;
 *  - projects of a blocked account answer 404 to everyone.
 */
export class AccessService {
  constructor(private readonly prisma: PrismaClient) {}

  async resolve(user: User | null, shareToken: string | null, projectId: string): Promise<ProjectAccess | null> {
    const found = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { owner: { select: { blockedAt: true } } },
    });
    // The projects of a blocked account are frozen: nobody can open them.
    if (!found || found.owner.blockedAt) return null;
    const { owner: _owner, ...project } = found;
    if (user && project.ownerId === user.id) return { project, role: 'owner' };
    if (shareToken && shareToken.length <= 64) {
      const link = await this.prisma.shareLink.findUnique({ where: { token: shareToken } });
      if (link && link.projectId === project.id && !link.revokedAt) {
        return { project, role: link.role === 'editor' && user ? 'editor' : 'viewer' };
      }
    }
    return null;
  }

  /** Resolves access and enforces the needed level (404 without access, 403 if too low). */
  async require(
    user: User | null,
    shareToken: string | null,
    projectId: string,
    need: AccessNeed,
  ): Promise<ProjectAccess> {
    const access = await this.resolve(user, shareToken, projectId);
    if (!access) throw notFound('Project');
    if (RANK[access.role] < RANK[NEEDED[need]]) {
      throw forbidden('forbidden', need === 'owner' ? 'Only the owner can do this' : 'You can only view this project');
    }
    return access;
  }
}
