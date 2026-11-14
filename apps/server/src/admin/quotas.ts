import type { PrismaClient, User } from '@prisma/client';
import { tooLarge } from '../errors.js';

export interface QuotaDefaults {
  maxProjects: number;
  storageQuotaBytes: number;
}

/** Per-user limits: the user's own override, else the server default. */
export class QuotaService {
  constructor(
    private readonly prisma: PrismaClient,
    readonly defaults: QuotaDefaults,
  ) {}

  maxProjects(user: Pick<User, 'maxProjects'>): number {
    return user.maxProjects ?? this.defaults.maxProjects;
  }

  storageQuota(user: Pick<User, 'storageQuotaBytes'>): number {
    return user.storageQuotaBytes === null ? this.defaults.storageQuotaBytes : Number(user.storageQuotaBytes);
  }

  /** Total size of the files in all projects the user owns. */
  async storageUsed(userId: string): Promise<number> {
    const agg = await this.prisma.projectFile.aggregate({ where: { project: { ownerId: userId } }, _sum: { size: true } });
    return agg._sum.size ?? 0;
  }

  async assertCanCreateProject(user: User): Promise<void> {
    const owned = await this.prisma.project.count({ where: { ownerId: user.id } });
    if (owned >= this.maxProjects(user)) throw tooLarge('project_limit', 'You have reached your project limit');
    if ((await this.storageUsed(user.id)) >= this.storageQuota(user)) {
      throw tooLarge('storage_quota', 'Your storage quota is used up');
    }
  }

  /** Checks that adding `addedBytes` to a project stays within its owner's quota. */
  async assertStorage(projectId: string, addedBytes: number): Promise<void> {
    if (addedBytes <= 0) return;
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, include: { owner: true } });
    if (!project) return;
    const used = await this.storageUsed(project.ownerId);
    if (used + addedBytes > this.storageQuota(project.owner)) {
      throw tooLarge('storage_quota', "The project owner's storage quota is used up");
    }
  }
}
