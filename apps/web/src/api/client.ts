import type {
  ApiErrorBody,
  CompileJobDTO,
  Compiler,
  FileDTO,
  ProjectDetailDTO,
  ProjectDTO,
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

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
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
  listProjects: () => request<{ projects: ProjectDTO[] }>('GET', '/api/projects').then((r) => r.projects),
  createProject: (name: string) =>
    request<{ project: ProjectDTO }>('POST', '/api/projects', { name }).then((r) => r.project),
  getProject: (id: string) => request<{ project: ProjectDetailDTO }>('GET', p(id)).then((r) => r.project),
  updateProject: (id: string, patch: { name?: string; compiler?: Compiler; mainFile?: string }) =>
    request<{ project: ProjectDTO }>('PATCH', p(id), patch).then((r) => r.project),
  deleteProject: (id: string) => request<void>('DELETE', p(id)),
  zipUrl: (id: string) => `${p(id)}/download.zip`,

  fileUrl: (id: string, fileId: string) => `${p(id)}/files/${encodeURIComponent(fileId)}`,
  readText: async (id: string, fileId: string) => {
    const res = await fetch(`${p(id)}/files/${encodeURIComponent(fileId)}`);
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
  latestJob: (id: string) =>
    request<{ job: CompileJobDTO | null }>('GET', `${p(id)}/compile/latest`).then((r) => r.job),
  pdfUrl: (id: string, jobId: string, download = false) =>
    `${p(id)}/compile/${encodeURIComponent(jobId)}/output.pdf${download ? '?download=1' : ''}`,
  logUrl: (id: string, jobId: string) => `${p(id)}/compile/${encodeURIComponent(jobId)}/output.log`,
};
