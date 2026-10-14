import type {
  AiDesignDTO,
  DesignDTO,
  DesignLanguage,
  DesignSpec,
  AdminStatsDTO,
  AdminUserDTO,
  AiExplainDTO,
  AiFixDTO,
  AiLanguage,
  AiSnippetDTO,
  AiStatusDTO,
  ApiErrorBody,
  ExerciseLevel,
  CompileJobDTO,
  Compiler,
  FileDTO,
  ProjectDetailDTO,
  ProjectDTO,
  CommentThreadDTO,
  SharedProjectDTO,
  ShareLinkDTO,
  VersionContentDTO,
  VersionDTO,
  ShareResolutionDTO,
  ShareRole,
  SyncTexPositionDTO,
  SyncTexSourceDTO,
  TemplateDTO,
  UserDTO,
} from '@oversells/shared';

/** Error returned by the API; `code` is translated in the UI (errors.<code>). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Share token of the project being viewed through a share link. Sent as
 * X-Share-Token on API calls and as ?share= on plain URLs (PDF, ZIP, images).
 */
let shareToken: string | null = null;

export function setShareToken(token: string | null): void {
  shareToken = token;
}

/** Appends the share token to URLs that are opened without our headers. */
function withShare(url: string): string {
  if (!shareToken) return url;
  return `${url}${url.includes('?') ? '&' : '?'}share=${encodeURIComponent(shareToken)}`;
}

/** Value of the double-submit CSRF cookie set by the server. */
function csrfToken(): string {
  const match = /(?:^|;\s*)oversells_csrf=([^;]*)/.exec(document.cookie);
  return match ? decodeURIComponent(match[1]!) : '';
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const init: RequestInit = { method, headers, credentials: 'same-origin' };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }
  if (method !== 'GET') {
    // The cookie is issued on the first API GET (the app always starts with /api/auth/me).
    if (!csrfToken()) await fetch('/api/auth/me', { credentials: 'same-origin' });
    headers['x-csrf-token'] = csrfToken();
  }
  if (shareToken) headers['x-share-token'] = shareToken;
  const res = await fetch(url, init);
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? 'internal', err?.message ?? res.statusText);
  }
  return data as T;
}

const p = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export const api = {
  me: () => request<{ user: UserDTO | null }>('GET', '/api/auth/me').then((r) => r.user),
  register: (email: string, password: string, name: string) =>
    request<{ user: UserDTO }>('POST', '/api/auth/register', { email, password, name }).then((r) => r.user),
  login: (email: string, password: string) =>
    request<{ user: UserDTO }>('POST', '/api/auth/login', { email, password }).then((r) => r.user),
  logout: () => request<void>('POST', '/api/auth/logout'),
  requestPasswordReset: (email: string, lang: string) =>
    request<{ ok: true }>('POST', '/api/auth/password-reset/request', { email, lang }),
  resetPassword: (token: string, password: string) =>
    request<{ ok: true }>('POST', '/api/auth/password-reset/confirm', { token, password }),

  listTemplates: () => request<{ templates: TemplateDTO[] }>('GET', '/api/templates').then((r) => r.templates),
  templatePreviewUrl: (name: string) => `/api/templates/${encodeURIComponent(name)}/preview.png`,

  listShareLinks: (id: string) =>
    request<{ links: ShareLinkDTO[] }>('GET', `${p(id)}/share-links`).then((r) => r.links),
  createShareLink: (id: string, role: ShareRole) =>
    request<{ link: ShareLinkDTO }>('POST', `${p(id)}/share-links`, { role }).then((r) => r.link),
  revokeShareLink: (id: string, linkId: string) =>
    request<void>('DELETE', `${p(id)}/share-links/${encodeURIComponent(linkId)}`),
  resolveShare: (token: string) =>
    request<{ share: ShareResolutionDTO }>('GET', `/api/share/${encodeURIComponent(token)}`).then((r) => r.share),
  shareUrl: (token: string) => `${window.location.origin}/s/${encodeURIComponent(token)}`,

  listSharedProjects: () =>
    request<{ projects: SharedProjectDTO[] }>('GET', '/api/projects/shared').then((r) => r.projects),

  listComments: (id: string, fileId?: string) =>
    request<{ comments: CommentThreadDTO[] }>(
      'GET',
      `${p(id)}/comments${fileId ? `?fileId=${encodeURIComponent(fileId)}` : ''}`,
    ).then((r) => r.comments),
  createComment: (id: string, input: { fileId: string; anchorStart: string; anchorEnd: string; body: string }) =>
    request<{ comment: CommentThreadDTO }>('POST', `${p(id)}/comments`, input).then((r) => r.comment),
  replyComment: (id: string, commentId: string, body: string) =>
    request<{ comment: CommentThreadDTO }>('POST', `${p(id)}/comments/${encodeURIComponent(commentId)}/replies`, {
      body,
    }).then((r) => r.comment),
  resolveComment: (id: string, commentId: string, resolved: boolean) =>
    request<{ comment: CommentThreadDTO }>('PATCH', `${p(id)}/comments/${encodeURIComponent(commentId)}`, {
      resolved,
    }).then((r) => r.comment),
  deleteComment: (id: string, commentId: string) =>
    request<void>('DELETE', `${p(id)}/comments/${encodeURIComponent(commentId)}`),

  listVersions: (id: string) =>
    request<{ versions: VersionDTO[] }>('GET', `${p(id)}/versions`).then((r) => r.versions),
  saveVersion: (id: string, name: string) =>
    request<{ version: VersionDTO }>('POST', `${p(id)}/versions`, { name }).then((r) => r.version),
  versionContent: (id: string, versionId: string) =>
    request<VersionContentDTO>('GET', `${p(id)}/versions/${encodeURIComponent(versionId)}`),
  currentContent: (id: string) => request<VersionContentDTO>('GET', `${p(id)}/versions/current`),
  restoreVersion: (id: string, versionId: string) =>
    request<{ version: VersionDTO }>('POST', `${p(id)}/versions/${encodeURIComponent(versionId)}/restore`).then(
      (r) => r.version,
    ),

  listProjects: () => request<{ projects: ProjectDTO[] }>('GET', '/api/projects').then((r) => r.projects),
  createProject: (name: string, template?: string) =>
    request<{ project: ProjectDTO }>('POST', '/api/projects', { name, template }).then((r) => r.project),
  getProject: (id: string) => request<{ project: ProjectDetailDTO }>('GET', p(id)).then((r) => r.project),
  dictionary: () => request<{ words: string[] }>('GET', '/api/me/dictionary').then((r) => r.words),
  addWord: (word: string) => request<{ word: string }>('POST', '/api/me/dictionary', { word }),
  updateProject: (id: string, patch: { name?: string; compiler?: Compiler; mainFile?: string; spellLanguage?: string }) =>
    request<{ project: ProjectDTO }>('PATCH', p(id), patch).then((r) => r.project),
  deleteProject: (id: string) => request<void>('DELETE', p(id)),
  zipUrl: (id: string) => withShare(`${p(id)}/download.zip`),
  exportUrl: (id: string, format: 'docx' | 'epub') => withShare(`${p(id)}/export/${format}`),
  importDocx: (file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return request<{ project: ProjectDTO }>('POST', '/api/projects/import-docx', form).then((r) => r.project);
  },

  fileUrl: (id: string, fileId: string) => withShare(`${p(id)}/files/${encodeURIComponent(fileId)}`),
  readText: async (id: string, fileId: string) => {
    const res = await fetch(withShare(`${p(id)}/files/${encodeURIComponent(fileId)}`));
    if (!res.ok) throw new ApiError(res.status, 'not_found', res.statusText);
    return res.text();
  },
  createFile: (id: string, path: string, content = '') =>
    request<{ file: FileDTO }>('POST', `${p(id)}/files`, { path, content }).then((r) => r.file),
  saveFile: (id: string, fileId: string, content: string) =>
    request<{ file: FileDTO }>('PUT', `${p(id)}/files/${encodeURIComponent(fileId)}/content`, { content }).then(
      (r) => r.file,
    ),
  moveFile: (id: string, fileId: string, path: string) =>
    request<{ file: FileDTO }>('PATCH', `${p(id)}/files/${encodeURIComponent(fileId)}`, { path }).then((r) => r.file),
  deleteFile: (id: string, fileId: string) => request<void>('DELETE', `${p(id)}/files/${encodeURIComponent(fileId)}`),
  upload: (id: string, folder: string, files: File[], overwrite = false) => {
    const form = new FormData();
    for (const f of files) form.append('file', f, f.name);
    const q = new URLSearchParams({ folder, overwrite: String(overwrite) });
    return request<{ files: FileDTO[] }>('POST', `${p(id)}/upload?${q}`, form).then((r) => r.files);
  },
  renameFolder: (id: string, from: string, to: string) =>
    request<{ moved: number }>('POST', `${p(id)}/folders/rename`, { from, to }),
  deleteFolder: (id: string, path: string) =>
    request<{ deleted: number }>('DELETE', `${p(id)}/folders?${new URLSearchParams({ path })}`),

  compile: (id: string) => request<{ job: CompileJobDTO }>('POST', `${p(id)}/compile`, {}).then((r) => r.job),
  getJob: (id: string, jobId: string) =>
    request<{ job: CompileJobDTO }>('GET', `${p(id)}/compile/${encodeURIComponent(jobId)}`).then((r) => r.job),
  /** Answers as soon as the job's status is no longer `status` (or after `seconds`). */
  waitJob: (id: string, jobId: string, status: string, seconds = 25) =>
    request<{ job: CompileJobDTO }>(
      'GET',
      `${p(id)}/compile/${encodeURIComponent(jobId)}?${new URLSearchParams({ wait: String(seconds), status })}`,
    ).then((r) => r.job),
  latestJob: (id: string) =>
    request<{ job: CompileJobDTO | null }>('GET', `${p(id)}/compile/latest`).then((r) => r.job),
  pdfUrl: (id: string, jobId: string, download = false) =>
    withShare(`${p(id)}/compile/${encodeURIComponent(jobId)}/output.pdf${download ? '?download=1' : ''}`),
  adminUsers: (q: string, offset: number, limit: number) =>
    request<{ users: AdminUserDTO[]; total: number }>(
      'GET',
      `/api/admin/users?${new URLSearchParams({ q, offset: String(offset), limit: String(limit) })}`,
    ),
  adminUpdateUser: (
    userId: string,
    patch: {
      blocked?: boolean;
      role?: 'user' | 'admin';
      maxProjects?: number | null;
      storageQuotaBytes?: number | null;
      aiDailyLimit?: number | null;
    },
  ) => request<{ user: AdminUserDTO }>('PATCH', `/api/admin/users/${encodeURIComponent(userId)}`, patch).then((r) => r.user),
  adminStats: () => request<{ stats: AdminStatsDTO }>('GET', '/api/admin/stats').then((r) => r.stats),
  designs: () => request<{ designs: DesignDTO[] }>('GET', '/api/designs').then((r) => r.designs),
  designPreviewUrl: (d: Pick<DesignDTO, 'id' | 'hash'>) => `/api/designs/${encodeURIComponent(d.id)}/preview.png?v=${d.hash}`,
  designPdfUrl: (d: Pick<DesignDTO, 'id' | 'hash'>) => `/api/designs/${encodeURIComponent(d.id)}/showcase.pdf?v=${d.hash}`,
  previewDesignSpec: (spec: DesignSpec) =>
    request<{ hash: string }>('POST', '/api/designs/preview', { spec }).then((r) => r.hash),
  previewByHashUrl: (hash: string, kind: 'png' | 'pdf') => `/api/designs/previews/${hash}.${kind}`,
  createDesign: (name: string, spec: DesignSpec) =>
    request<{ design: DesignDTO }>('POST', '/api/designs', { name, spec }).then((r) => r.design),
  updateDesign: (id: string, patch: { name?: string; spec?: DesignSpec }) =>
    request<{ design: DesignDTO }>('PATCH', `/api/designs/${encodeURIComponent(id)}`, patch).then((r) => r.design),
  deleteDesign: (id: string) => request<void>('DELETE', `/api/designs/${encodeURIComponent(id)}`),
  applyDesign: (projectId: string, designId: string, lang?: DesignLanguage) =>
    request<{ file: FileDTO; mainChanged: boolean; project: ProjectDTO }>('POST', `${p(projectId)}/design`, { designId, lang }),
  designFromBook: (files: File[], wishes: string, lang: AiLanguage) => {
    const form = new FormData();
    for (const f of files) form.append('file', f, f.name);
    return request<{ result: AiDesignDTO }>(
      'POST',
      `/api/ai/design-from-book?${new URLSearchParams({ wishes, lang })}`,
      form,
    ).then((r) => r.result);
  },
  aiStatus: () => request<{ status: AiStatusDTO }>('GET', '/api/ai/status').then((r) => r.status),
  aiExplain: (id: string, jobId: string, entry: number, lang: AiLanguage) =>
    request<{ result: AiExplainDTO }>('POST', `${p(id)}/ai/explain`, { jobId, entry, lang }).then((r) => r.result),
  aiFix: (id: string, jobId: string, entry: number, lang: AiLanguage) =>
    request<{ result: AiFixDTO }>('POST', `${p(id)}/ai/fix`, { jobId, entry, lang }).then((r) => r.result),
  aiExercises: (id: string, input: { topic: string; count: number; level: ExerciseLevel; lang: AiLanguage }) =>
    request<{ result: AiSnippetDTO }>('POST', `${p(id)}/ai/exercises`, input).then((r) => r.result),
  aiTikz: (id: string, input: { description: string; lang: AiLanguage }) =>
    request<{ result: AiSnippetDTO }>('POST', `${p(id)}/ai/tikz`, input).then((r) => r.result),
  synctexForward: (id: string, jobId: string, file: string, line: number) =>
    request<{ position: SyncTexPositionDTO }>(
      'GET',
      `${p(id)}/compile/${encodeURIComponent(jobId)}/synctex/code?${new URLSearchParams({ file, line: String(line) })}`,
    ).then((r) => r.position),
  synctexReverse: (id: string, jobId: string, page: number, x: number, y: number) =>
    request<{ source: SyncTexSourceDTO }>(
      'GET',
      `${p(id)}/compile/${encodeURIComponent(jobId)}/synctex/pdf?${new URLSearchParams({
        page: String(page),
        x: x.toFixed(2),
        y: y.toFixed(2),
      })}`,
    ).then((r) => r.source),
  logUrl: (id: string, jobId: string) => withShare(`${p(id)}/compile/${encodeURIComponent(jobId)}/output.log`),
};
