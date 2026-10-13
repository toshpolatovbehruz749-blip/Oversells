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

// --- Phase 3: collaboration ----------------------------------------------------

export interface CommentAuthorDTO {
  id: string;
  name: string;
}

export interface CommentReplyDTO {
  id: string;
  author: CommentAuthorDTO;
  body: string;
  createdAt: string;
}

export interface CommentThreadDTO {
  id: string;
  fileId: string;
  author: CommentAuthorDTO;
  body: string;
  /** Base64 of the encoded Yjs relative positions (resolve them on the client's Y.Doc). */
  anchorStart: string;
  anchorEnd: string;
  /** Range in the server's current document, or null if the text was deleted. */
  from: number | null;
  to: number | null;
  /** Text the comment was made on (at creation time). */
  quote: string;
  resolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
  replies: CommentReplyDTO[];
}

export const VERSION_KINDS = ['auto', 'named', 'restore'] as const;
export type VersionKind = (typeof VERSION_KINDS)[number];

export interface VersionDTO {
  id: string;
  kind: VersionKind;
  name: string | null;
  createdBy: CommentAuthorDTO | null;
  fileCount: number;
  createdAt: string;
}

export interface VersionFileDTO {
  fileId: string;
  path: string;
  content: string;
}

export interface VersionContentDTO {
  version: VersionDTO | null;
  files: VersionFileDTO[];
}

export interface SharedProjectDTO extends ProjectDTO {
  role: ShareRole;
  /** Share token to open it with (/s/:token). */
  token: string;
  ownerName: string;
  lastOpenedAt: string;
}
