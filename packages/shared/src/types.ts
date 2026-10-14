/** LaTeX engines a project can be compiled with. */
export const COMPILERS = ['pdflatex', 'xelatex', 'lualatex'] as const;
export type Compiler = (typeof COMPILERS)[number];

export type FileKind = 'text' | 'binary';

export interface ProjectDTO {
  id: string;
  name: string;
  compiler: Compiler;
  mainFile: string;
  /** Spell-check language (see SPELL_LANGUAGES). */
  spellLanguage: string;
  /** Design applied in the editor ("Dizayn"), if any. */
  designId: string | null;
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

export type UserRole = 'user' | 'admin';

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  role: UserRole;
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
  /** True when SyncTeX data is available (PDF <-> source navigation). */
  hasSynctex: boolean;
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

// --- Phase 4: SyncTeX ----------------------------------------------------------

/** Rectangle on a PDF page in points from the top-left corner. */
export interface PdfBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SyncTexPositionDTO {
  page: number;
  x: number;
  y: number;
  boxes: PdfBox[];
}

export interface SyncTexSourceDTO {
  file: string;
  line: number;
  fileId: string | null;
}

// --- Phase 4: spell checking ------------------------------------------------------

/** Spell-check language of a project ('off' disables it). */
export const SPELL_LANGUAGES = ['off', 'uz-latn', 'uz-cyrl', 'ru', 'en'] as const;
export type SpellLanguage = (typeof SPELL_LANGUAGES)[number];
/** Dictionaries shipped with the web client. */
export type Dictionary = 'uz-latn' | 'uz-cyrl' | 'ru' | 'en';

// --- Phase 4: AI assistance ---------------------------------------------------------

/** Languages the AI answers in (the UI language). */
export const AI_LANGUAGES = ['uz', 'ru', 'en'] as const;
export type AiLanguage = (typeof AI_LANGUAGES)[number];
export const AI_KINDS = ['explain', 'fix', 'exercises', 'tikz', 'design', 'image'] as const;
export type AiKind = (typeof AI_KINDS)[number];

/** LaTeX read from a picture of formulas or a page (AI). */
export interface AiImageLatexDTO {
  latex: string;
  /** The picture holds a displayed formula (to put inside \[ \]) rather than text. */
  display: boolean;
  notes: string;
}
export const EXERCISE_LEVELS = ['easy', 'medium', 'hard'] as const;
export type ExerciseLevel = (typeof EXERCISE_LEVELS)[number];

export interface AiStatusDTO {
  enabled: boolean;
  /** Requests left today (null when AI is disabled or the user is anonymous). */
  remaining: number | null;
  dailyLimit: number | null;
}

export interface AiExplainDTO {
  explanation: string;
}

/** A suggested replacement of lines startLine..endLine (1-based, inclusive). */
export interface AiFixDTO {
  fileId: string;
  path: string;
  startLine: number;
  endLine: number;
  original: string;
  suggestion: string;
  explanation: string;
}

export interface AiSnippetDTO {
  latex: string;
  /** Preamble lines the snippet needs that the main file lacks (e.g. \usepackage{tikz}). */
  preambleAdditions: string[];
}

// --- Phase 4: administration --------------------------------------------------------

export interface UserLimitsDTO {
  maxProjects: number | null;
  storageQuotaBytes: number | null;
  aiDailyLimit: number | null;
}

export interface AdminUserDTO {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  blockedAt: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  projectCount: number;
  storageBytes: number;
  aiRequestsToday: number;
  compiles7d: number;
  /** Per-user overrides (null = server default). */
  limits: UserLimitsDTO;
  /** Limits in effect (override or default). */
  effective: { maxProjects: number; storageQuotaBytes: number; aiDailyLimit: number };
}

export interface CompileCountsDTO {
  total: number;
  success: number;
  failed: number;
  timeout: number;
  error: number;
}

export interface AdminStatsDTO {
  users: { total: number; admins: number; blocked: number; new7d: number; active7d: number };
  projects: { total: number; created7d: number };
  compiles: {
    last24h: CompileCountsDTO;
    last7d: CompileCountsDTO;
    avgMs7d: number | null;
    p95Ms7d: number | null;
    queued: number;
    running: number;
    /** Compiles per day (UTC), oldest first, last 14 days. */
    daily: Array<{ day: string; total: number; failed: number }>;
  };
  storage: { fileBytes: number; fileCount: number; docHistoryBytes: number; versionCount: number };
  ai: { enabled: boolean; requests24h: number; requests7d: number; inputTokens7d: number; outputTokens7d: number };
}

// --- Phase 5: designs ------------------------------------------------------------------

/** Text fonts available in the compiler image that cover Uzbek Latin/Cyrillic and Russian. */
export const DESIGN_TEXT_FONTS = ['Noto Serif', 'Noto Sans', 'DejaVu Serif', 'DejaVu Sans', 'Inter', 'Lato'] as const;
export type DesignTextFont = (typeof DESIGN_TEXT_FONTS)[number];
/** OpenType math fonts available in the compiler image. */
export const DESIGN_MATH_FONTS = ['Latin Modern Math', 'TeX Gyre Pagella Math', 'TeX Gyre DejaVu Math'] as const;
export type DesignMathFont = (typeof DESIGN_MATH_FONTS)[number];
export const DESIGN_HEADINGS = ['classic', 'band', 'bar', 'circle', 'underline'] as const;
export type DesignHeadings = (typeof DESIGN_HEADINGS)[number];
export const DESIGN_BOXES = ['rule', 'soft', 'card', 'rounded', 'frame'] as const;
export type DesignBoxes = (typeof DESIGN_BOXES)[number];
export const DESIGN_MARGINS = ['narrow', 'normal', 'wide'] as const;
export const DESIGN_HEADERS = ['none', 'simple', 'fancy'] as const;
export const DESIGN_DRAWINGS = ['clean', 'playful'] as const;
/** Language of the generated box titles ("Teorema", "Теорема", ...). */
export const DESIGN_LANGUAGES = ['uz-latn', 'uz-cyrl', 'ru', 'en'] as const;
export type DesignLanguage = (typeof DESIGN_LANGUAGES)[number];

/**
 * Everything a design decides; the server turns it into `dizayn.sty`.
 * Colours are "#RRGGBB".
 */
export interface DesignSpec {
  fonts: {
    body: DesignTextFont;
    heading: DesignTextFont;
    math: DesignMathFont;
    /** Letters and digits in formulas from the body font ("text") or the math font. */
    mathLetters: 'math' | 'text';
    size: 10 | 11 | 12;
  };
  colors: {
    /** Headings, theorems, key formulas. */
    primary: string;
    /** Definitions. */
    secondary: string;
    /** Examples, exercises, highlights in drawings. */
    accent: string;
    /** Body text. */
    ink: string;
  };
  headings: DesignHeadings;
  boxes: DesignBoxes;
  page: { margins: (typeof DESIGN_MARGINS)[number]; header: (typeof DESIGN_HEADERS)[number] };
  drawings: (typeof DESIGN_DRAWINGS)[number];
  /** Small pictograms (lightbulb, pencil, ...) in box titles. */
  icons: boolean;
  /** A coloured banner for \maketitle. */
  titleBanner: boolean;
}

/** A design proposed by the AI from pages of a book (not saved yet). */
export interface AiDesignDTO {
  name: string;
  notes: string;
  spec: DesignSpec;
}

export interface DesignDTO {
  id: string;
  name: Localized;
  description: Localized;
  builtIn: boolean;
  spec: DesignSpec;
  /** Changes whenever the generated package changes (for preview caching). */
  hash: string;
}
