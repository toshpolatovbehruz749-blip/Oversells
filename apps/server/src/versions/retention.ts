import type { PrismaClient, VersionKind } from '@prisma/client';
import type { Storage } from '../storage/storage.js';

const DAY_MS = 24 * 3600 * 1000;

export interface RetentionPolicy {
  /** Keep every automatic version younger than this. */
  keepAllMs: number;
  /** Then keep the newest automatic version per day until this age... */
  dailyMs: number;
  /** ...and the newest per week after that. */
}

export const DEFAULT_RETENTION: RetentionPolicy = { keepAllMs: DAY_MS, dailyMs: 30 * DAY_MS };

interface VersionRow {
  id: string;
  kind: VersionKind;
  createdAt: Date;
}

/** Monday-based week number since the epoch (UTC). */
function weekOf(d: Date): number {
  return Math.floor((d.getTime() / DAY_MS + 3) / 7); // 1970-01-01 was a Thursday
}

/**
 * Which versions to delete. Named versions and restore points are always
 * kept. Automatic versions: all from the last 24 hours, then the newest one
 * of each day for 30 days, then the newest one of each week.
 */
export function versionsToPrune(versions: VersionRow[], now: Date, policy = DEFAULT_RETENTION): string[] {
  const keep = new Set<string>();
  const seen = new Set<string>();
  const sorted = versions.filter((v) => v.kind === 'auto').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const v of sorted) {
    const age = now.getTime() - v.createdAt.getTime();
    let bucket: string;
    if (age < policy.keepAllMs) bucket = `v:${v.id}`;
    else if (age < policy.dailyMs) bucket = `d:${v.createdAt.toISOString().slice(0, 10)}`;
    else bucket = `w:${weekOf(v.createdAt)}`;
    if (!seen.has(bucket)) {
      seen.add(bucket);
      keep.add(v.id);
    }
  }
  return sorted.filter((v) => !keep.has(v.id)).map((v) => v.id);
}

/** Applies the policy to every project with automatic versions; returns how many were deleted. */
export async function applyVersionRetention(
  prisma: PrismaClient,
  storage: Storage,
  now = new Date(),
  policy = DEFAULT_RETENTION,
): Promise<number> {
  const projects = await prisma.version.groupBy({
    by: ['projectId'],
    where: { kind: 'auto', createdAt: { lt: new Date(now.getTime() - policy.keepAllMs) } },
    _count: true,
  });
  let deleted = 0;
  for (const { projectId, _count } of projects) {
    if (_count < 2) continue;
    const versions = await prisma.version.findMany({
      where: { projectId },
      select: { id: true, kind: true, createdAt: true, contentKey: true },
    });
    const prune = new Set(versionsToPrune(versions, now, policy));
    for (const v of versions) {
      if (!prune.has(v.id)) continue;
      await prisma.version.delete({ where: { id: v.id } }).catch(() => undefined);
      if (v.contentKey) await storage.delete(v.contentKey).catch(() => undefined);
      deleted++;
    }
  }
  return deleted;
}
