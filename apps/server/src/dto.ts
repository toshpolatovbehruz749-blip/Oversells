import type { CompileJob, Project, ProjectFile } from '@prisma/client';
import type { CompileJobDTO, FileDTO, LogEntry, ProjectDTO } from '@oversells/shared';

export function toProjectDTO(p: Project): ProjectDTO {
  return {
    id: p.id,
    name: p.name,
    compiler: p.compiler,
    mainFile: p.mainFile,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function toFileDTO(f: ProjectFile): FileDTO {
  return {
    id: f.id,
    path: f.path,
    kind: f.kind,
    size: f.size,
    mimeType: f.mimeType,
    updatedAt: f.updatedAt.toISOString(),
  };
}

export function toCompileJobDTO(j: CompileJob): CompileJobDTO {
  return {
    id: j.id,
    projectId: j.projectId,
    status: j.status,
    compiler: j.compiler,
    mainFile: j.mainFile,
    createdAt: j.createdAt.toISOString(),
    startedAt: j.startedAt?.toISOString() ?? null,
    finishedAt: j.finishedAt?.toISOString() ?? null,
    durationMs: j.durationMs,
    hasPdf: j.pdfKey !== null,
    entries: (j.entries ?? []) as unknown as LogEntry[],
    errorMessage: j.errorMessage,
  };
}
