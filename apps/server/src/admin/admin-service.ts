import { Prisma, type PrismaClient, type User } from '@prisma/client';
import type { AdminStatsDTO, AdminUserDTO, CompileCountsDTO, UserRole } from '@oversells/shared';
import { badRequest, notFound } from '../errors.js';
import type { DocManager } from '../collab/doc-manager.js';
import type { QuotaService } from './quotas.js';

export interface UserPatch {
  blocked?: boolean;
  role?: UserRole;
  maxProjects?: number | null;
  storageQuotaBytes?: number | null;
  aiDailyLimit?: number | null;
}

const DAY_MS = 24 * 3600 * 1000;

function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const num = (v: bigint | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

/** User management and server statistics for the admin panel. */
export class AdminService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly quotas: QuotaService,
    private readonly docs: DocManager,
    private readonly ai: { enabled: boolean; dailyLimit: number },
  ) {}

  async listUsers(query: string, offset: number, limit: number): Promise<{ users: AdminUserDTO[]; total: number }> {
    const where: Prisma.UserWhereInput = query
      ? {
          OR: [
            { email: { contains: query, mode: 'insensitive' } },
            { name: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {};
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: { _count: { select: { projects: true } } },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { users: await this.describe(users), total };
  }

  async getUser(id: string): Promise<AdminUserDTO> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { _count: { select: { projects: true } } } });
    if (!user) throw notFound('User');
    return (await this.describe([user]))[0]!;
  }

  async updateUser(admin: User, id: string, patch: UserPatch): Promise<AdminUserDTO> {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw notFound('User');
    if (target.id === admin.id && (patch.blocked === true || patch.role === 'user')) {
      throw badRequest('cannot_change_self', 'You cannot block yourself or remove your own admin role');
    }
    const data: Prisma.UserUpdateInput = {};
    if (patch.role !== undefined) data.role = patch.role;
    if (patch.maxProjects !== undefined) data.maxProjects = patch.maxProjects;
    if (patch.aiDailyLimit !== undefined) data.aiDailyLimit = patch.aiDailyLimit;
    if (patch.storageQuotaBytes !== undefined) {
      data.storageQuotaBytes = patch.storageQuotaBytes === null ? null : BigInt(patch.storageQuotaBytes);
    }
    const blocking = patch.blocked === true && !target.blockedAt;
    if (patch.blocked !== undefined) data.blockedAt = patch.blocked ? (target.blockedAt ?? new Date()) : null;

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data }),
      ...(blocking ? [this.prisma.session.deleteMany({ where: { userId: id } })] : []),
    ]);
    if (blocking) await this.disconnect(id);
    return this.getUser(id);
  }

  /** Closes the live connections of a blocked user and to the user's (now frozen) projects. */
  private async disconnect(userId: string): Promise<void> {
    const owned = (await this.prisma.project.findMany({ where: { ownerId: userId }, select: { id: true } })).map((p) => p.id);
    this.docs.closeConnections({ userId, projectIds: owned }, 4403, 'account blocked');
  }

  private async describe(
    users: Array<User & { _count: { projects: number } }>,
  ): Promise<AdminUserDTO[]> {
    if (users.length === 0) return [];
    const ids = users.map((u) => u.id);
    const since7d = new Date(Date.now() - 7 * DAY_MS);
    const [storage, ai, seen, compiles] = await Promise.all([
      this.prisma.$queryRaw<Array<{ ownerId: string; bytes: bigint | null }>>`
        SELECT p."ownerId", SUM(f."size")::bigint AS bytes
        FROM "ProjectFile" f JOIN "Project" p ON p."id" = f."projectId"
        WHERE p."ownerId" IN (${Prisma.join(ids)})
        GROUP BY p."ownerId"`,
      this.prisma.aiRequest.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, createdAt: { gte: startOfUtcDay() } },
        _count: true,
      }),
      this.prisma.session.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _max: { lastSeenAt: true } }),
      this.prisma.$queryRaw<Array<{ ownerId: string; n: bigint }>>`
        SELECT p."ownerId", COUNT(*)::bigint AS n
        FROM "CompileJob" j JOIN "Project" p ON p."id" = j."projectId"
        WHERE p."ownerId" IN (${Prisma.join(ids)}) AND j."createdAt" >= ${since7d}
        GROUP BY p."ownerId"`,
    ]);
    const storageBy = new Map(storage.map((r) => [r.ownerId, num(r.bytes)]));
    const aiBy = new Map(ai.map((r) => [r.userId, r._count]));
    const seenBy = new Map(seen.map((r) => [r.userId, r._max.lastSeenAt]));
    const compilesBy = new Map(compiles.map((r) => [r.ownerId, num(r.n)]));
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      blockedAt: u.blockedAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      lastSeenAt: seenBy.get(u.id)?.toISOString() ?? null,
      projectCount: u._count.projects,
      storageBytes: storageBy.get(u.id) ?? 0,
      aiRequestsToday: aiBy.get(u.id) ?? 0,
      compiles7d: compilesBy.get(u.id) ?? 0,
      limits: {
        maxProjects: u.maxProjects,
        storageQuotaBytes: u.storageQuotaBytes === null ? null : Number(u.storageQuotaBytes),
        aiDailyLimit: u.aiDailyLimit,
      },
      effective: {
        maxProjects: this.quotas.maxProjects(u),
        storageQuotaBytes: this.quotas.storageQuota(u),
        aiDailyLimit: u.aiDailyLimit ?? this.ai.dailyLimit,
      },
    }));
  }

  async stats(): Promise<AdminStatsDTO> {
    const now = Date.now();
    const since24h = new Date(now - DAY_MS);
    const since7d = new Date(now - 7 * DAY_MS);
    const since14d = new Date(startOfUtcDay().getTime() - 13 * DAY_MS);

    const counts = async (since: Date): Promise<CompileCountsDTO> => {
      const rows = await this.prisma.compileJob.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: true });
      const out: CompileCountsDTO = { total: 0, success: 0, failed: 0, timeout: 0, error: 0 };
      for (const r of rows) {
        out.total += r._count;
        if (r.status in out) out[r.status as keyof CompileCountsDTO] += r._count;
      }
      return out;
    };

    const [
      usersTotal,
      admins,
      blocked,
      new7d,
      active7d,
      projectsTotal,
      projects7d,
      last24h,
      last7d,
      durations,
      queued,
      running,
      daily,
      files,
      history,
      versionCount,
      ai24h,
      ai7d,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { role: 'admin' } }),
      this.prisma.user.count({ where: { blockedAt: { not: null } } }),
      this.prisma.user.count({ where: { createdAt: { gte: since7d } } }),
      this.prisma.session.groupBy({ by: ['userId'], where: { lastSeenAt: { gte: since7d } } }).then((r) => r.length),
      this.prisma.project.count(),
      this.prisma.project.count({ where: { createdAt: { gte: since7d } } }),
      counts(since24h),
      counts(since7d),
      this.prisma.$queryRaw<Array<{ avg: number | null; p95: number | null }>>`
        SELECT AVG("durationMs")::float8 AS avg,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs")::float8 AS p95
        FROM "CompileJob" WHERE "createdAt" >= ${since7d} AND "durationMs" IS NOT NULL`,
      this.prisma.compileJob.count({ where: { status: 'queued' } }),
      this.prisma.compileJob.count({ where: { status: 'running' } }),
      this.prisma.$queryRaw<Array<{ day: Date; total: bigint; failed: bigint }>>`
        SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS total,
               COUNT(*) FILTER (WHERE "status" IN ('failed', 'timeout', 'error'))::bigint AS failed
        FROM "CompileJob" WHERE "createdAt" >= ${since14d}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.projectFile.aggregate({ _sum: { size: true }, _count: true }),
      this.prisma.$queryRaw<Array<{ bytes: bigint | null }>>`SELECT SUM(octet_length("data"))::bigint AS bytes FROM "DocUpdate"`,
      this.prisma.version.count(),
      this.prisma.aiRequest.count({ where: { createdAt: { gte: since24h } } }),
      this.prisma.aiRequest.aggregate({
        where: { createdAt: { gte: since7d } },
        _count: true,
        _sum: { inputTokens: true, outputTokens: true },
      }),
    ]);

    // Every one of the last 14 days, including days without compiles.
    const byDay = new Map(daily.map((d) => [d.day.toISOString().slice(0, 10), d]));
    const days: AdminStatsDTO['compiles']['daily'] = [];
    for (let i = 0; i < 14; i++) {
      const day = new Date(since14d.getTime() + i * DAY_MS).toISOString().slice(0, 10);
      const row = byDay.get(day);
      days.push({ day, total: num(row?.total), failed: num(row?.failed) });
    }

    return {
      users: { total: usersTotal, admins, blocked, new7d, active7d },
      projects: { total: projectsTotal, created7d: projects7d },
      compiles: {
        last24h,
        last7d,
        avgMs7d: durations[0]?.avg === null || durations[0]?.avg === undefined ? null : Math.round(durations[0].avg),
        p95Ms7d: durations[0]?.p95 === null || durations[0]?.p95 === undefined ? null : Math.round(durations[0].p95),
        queued,
        running,
        daily: days,
      },
      storage: {
        fileBytes: files._sum.size ?? 0,
        fileCount: files._count,
        docHistoryBytes: num(history[0]?.bytes),
        versionCount,
      },
      ai: {
        enabled: this.ai.enabled,
        requests24h: ai24h,
        requests7d: ai7d._count,
        inputTokens7d: ai7d._sum.inputTokens ?? 0,
        outputTokens7d: ai7d._sum.outputTokens ?? 0,
      },
    };
  }
}
