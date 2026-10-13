/** LaTeX engines a project can be compiled with. */
export const COMPILERS = ['pdflatex', 'xelatex', 'lualatex'] as const;
export type Compiler = (typeof COMPILERS)[number];

export type FileKind = 'text' | 'binary';

export interface ProjectDTO {
  id: string;
  name: string;
  compiler: Compiler;
  mainFile: string;
  createdAt: string;
  updatedAt: string;
}

export interface FileDTO {
  id: string;
  path: string;
  kind: FileKind;
  size: number;
  mimeType: string;
  updatedAt: string;
}

/** How the current user may use a project. */
export const PROJECT_ROLES = ['viewer', 'editor', 'owner'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export interface ProjectDetailDTO extends ProjectDTO {
  files: FileDTO[];
  /** The caller's access level. */
  access: ProjectRole;
}

export interface UserDTO {
  id: string;
  email: string;
  name: string;
}

export const SHARE_ROLES = ['viewer', 'editor'] as const;
export type ShareRole = (typeof SHARE_ROLES)[number];

export interface ShareLinkDTO {
  id: string;
  role: ShareRole;
  token: string;
  createdAt: string;
}

/** Result of opening a share link. */
export interface ShareResolutionDTO {
  projectId: string;
  projectName: string;
  /** Role granted by the link. */
  linkRole: ShareRole;
  /** Role the caller actually gets (editor links need a logged-in user). */
  role: ShareRole;
}

export type Localized = Record<'uz' | 'ru' | 'en', string>;

export interface TemplateDTO {
  name: string;
  title: Localized;
  description: Localized;
  compiler: Compiler;
}

export const COMPILE_STATUSES = ['queued', 'running', 'success', 'failed', 'timeout', 'error'] as const;
export type CompileStatus = (typeof COMPILE_STATUSES)[number];

export type LogLevel = 'error' | 'warning' | 'typesetting';

/** One entry extracted from the LaTeX log. */
export interface LogEntry {
  level: LogLevel;
  message: string;
  /** Project-relative path of the file the entry refers to, when known. */
  file: string | null;
  /** 1-based line number, when known. */
  line: number | null;
  /** Extra context lines from the log (e.g. the "l.12 ..." excerpt). */
  context: string;
}

export interface CompileJobDTO {
  id: string;
  projectId: string;
  status: CompileStatus;
  compiler: Compiler;
  mainFile: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  /** True when a PDF was produced (possibly despite errors). */
  hasPdf: boolean;
  entries: LogEntry[];
  /** Short, human readable failure reason for status error/timeout. */
  errorMessage: string | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
