import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  COMPILERS,
  checkProjectPath,
  joinProjectPath,
  type CompileJobDTO,
  type Compiler,
  type FileDTO,
  type LogEntry,
  type ProjectDetailDTO,
  type ShareRole,
} from '@oversells/shared';
import { api, ApiError } from '../api/client';
import { errorMessage } from '../i18n';
import { useDialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { UserMenu } from '../components/UserMenu';
import { ShareDialog } from '../components/ShareDialog';
import { useAuth } from '../auth/AuthContext';
import { FileTree } from '../components/FileTree';
import { CodeEditor, type CodeEditorHandle } from '../components/CodeEditor';
import { PdfViewer } from '../components/PdfViewer';
import { LogPanel } from '../components/LogPanel';

type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

const AUTOSAVE_DELAY_MS = 1000;
const POLL_INTERVAL_MS = 700;
const COMPILER_LABELS: Record<Compiler, string> = { pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface EditorPageProps {
  /** Set when opened through a share link (/s/:token); otherwise from the URL. */
  projectId?: string;
  share?: { token: string; linkRole: ShareRole };
}

export function EditorPage({ projectId, share }: EditorPageProps = {}) {
  const params = useParams();
  const id = projectId ?? params.id ?? '';
  const { user } = useAuth();
  const { t } = useTranslation();
  const dialog = useDialog();
  const toast = useToast();

  const [project, setProject] = useState<ProjectDetailDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [extraFolders, setExtraFolders] = useState<string[]>([]);
  const [openFile, setOpenFile] = useState<{ file: FileDTO; content: string | null } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [job, setJob] = useState<CompileJobDTO | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [sharing, setSharing] = useState(false);

  const editor = useRef<CodeEditorHandle>(null);
  /** Latest known content of every opened text file. */
  const contents = useRef(new Map<string, string>());
  /** Edits not yet sent to the server. */
  const pending = useRef(new Map<string, string>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const pendingJump = useRef<{ fileId: string; line: number } | null>(null);

  const files = project?.files ?? [];
  const role = project?.access ?? 'viewer';
  const canEdit = role !== 'viewer';
  const isOwner = role === 'owner';
  const readOnlyRef = useRef(true);
  readOnlyRef.current = !canEdit;

  // --- loading -------------------------------------------------------------

  const reloadProject = useCallback(async () => {
    const p = await api.getProject(id);
    setProject(p);
    return p;
  }, [id]);

  const open = useCallback(
    async (file: FileDTO) => {
      if (file.kind !== 'text') {
        setOpenFile({ file, content: null });
        return;
      }
      let content = contents.current.get(file.id);
      if (content === undefined) {
        try {
          content = await api.readText(id, file.id);
        } catch (err) {
          toast(errorMessage(err));
          return;
        }
        contents.current.set(file.id, content);
      }
      setOpenFile({ file, content });
    },
    [id, toast],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await reloadProject();
        if (cancelled) return;
        const main = p.files.find((f) => f.path === p.mainFile) ?? p.files.find((f) => f.kind === 'text');
        if (main) await open(main);
        const latest = await api.latestJob(id);
        if (!cancelled) setJob(latest);
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, reloadProject, open]);

  // --- auto-save -----------------------------------------------------------

  const flush = useCallback(async (): Promise<void> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (saving.current) await saving.current;
    if (pending.current.size === 0) return;
    const batch = [...pending.current.entries()];
    pending.current.clear();
    setSaveState('saving');
    saving.current = (async () => {
      try {
        for (const [fileId, content] of batch) await api.saveFile(id, fileId, content);
        setSaveState(pending.current.size ? 'unsaved' : 'saved');
      } catch (err) {
        // Put the edits back so the next attempt retries them.
        for (const [fileId, content] of batch) if (!pending.current.has(fileId)) pending.current.set(fileId, content);
        setSaveState('error');
        toast(errorMessage(err));
        throw err;
      } finally {
        saving.current = null;
      }
    })();
    await saving.current;
  }, [id, toast]);

  const onChange = useCallback(
    (fileId: string, content: string) => {
      if (readOnlyRef.current) return;
      contents.current.set(fileId, content);
      pending.current.set(fileId, content);
      setSaveState('unsaved');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flush().catch(() => undefined), AUTOSAVE_DELAY_MS);
    },
    [flush],
  );

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current.size > 0 || saving.current) {
        void flush().catch(() => undefined);
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      void flush().catch(() => undefined); // leaving the page inside the SPA
    };
  }, [flush]);

  // --- compile -------------------------------------------------------------

  const compilingRef = useRef(false);
  const compile = useCallback(async () => {
    if (compilingRef.current) return;
    compilingRef.current = true;
    setCompiling(true);
    try {
      await flush();
      let current = await api.compile(id);
      setJob(current);
      while (current.status === 'queued' || current.status === 'running') {
        await sleep(POLL_INTERVAL_MS);
        current = await api.getJob(id, current.id);
        setJob(current);
      }
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      compilingRef.current = false;
      setCompiling(false);
    }
  }, [flush, id, toast]);

  // Ctrl/Cmd+Enter compiles and Ctrl/Cmd+S saves from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The code editor handles its own shortcuts and marks them as handled.
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        void compile();
      } else if (e.key === 's') {
        e.preventDefault();
        void flush().catch(() => undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compile, flush]);

  const jumpTo = useCallback(
    async (entry: LogEntry) => {
      const file = files.find((f) => f.path === entry.file);
      if (!file) return;
      const line = entry.line ?? 1;
      if (openFile?.file.id === file.id) {
        editor.current?.gotoLine(line);
      } else {
        pendingJump.current = { fileId: file.id, line };
        await open(file);
      }
    },
    [files, open, openFile],
  );

  useEffect(() => {
    const jump = pendingJump.current;
    if (jump && openFile?.file.id === jump.fileId) {
      pendingJump.current = null;
      // Wait one frame so the editor has swapped documents.
      requestAnimationFrame(() => editor.current?.gotoLine(jump.line));
    }
  }, [openFile]);

  // --- project settings ----------------------------------------------------

  const updateProject = async (patch: { name?: string; compiler?: Compiler; mainFile?: string }) => {
    try {
      const updated = await api.updateProject(id, patch);
      setProject((p) => (p ? { ...p, ...updated } : p));
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  const renameProject = async () => {
    if (!project) return;
    const name = await dialog.prompt(t('projects.renamePrompt'), project.name);
    if (name && name !== project.name) await updateProject({ name });
  };

  // --- file operations -----------------------------------------------------

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  const newFile = (folder: string) =>
    run(async () => {
      const name = await dialog.prompt(t('files.newFilePrompt'), '', t('files.allowedHint'));
      if (!name) return;
      const path = joinProjectPath(folder, name.includes('.') ? name : `${name}.tex`);
      const file = await api.createFile(id, path);
      setExtraFolders((f) => f.filter((x) => !path.startsWith(`${x}/`)));
      await reloadProject();
      contents.current.set(file.id, '');
      setOpenFile({ file, content: '' });
    });

  const newFolder = (folder: string) =>
    run(async () => {
      const name = await dialog.prompt(t('files.newFolderPrompt'), '', t('files.allowedHint'));
      if (!name) return;
      const path = joinProjectPath(folder, name);
      if (!checkProjectPath(path, false).ok) throw new ApiError(400, 'invalid_path', 'Invalid folder name');
      setExtraFolders((f) => (f.includes(path) ? f : [...f, path]));
    });

  const upload = (folder: string, selected: File[]) =>
    run(async () => {
      for (const f of selected) {
        let uploaded: FileDTO[];
        try {
          uploaded = await api.upload(id, folder, [f]);
        } catch (err) {
          if (!(err instanceof ApiError && err.code === 'file_exists')) throw err;
          if (!(await dialog.confirm(t('files.overwrite', { name: f.name })))) continue;
          uploaded = await api.upload(id, folder, [f], true);
          for (const u of uploaded) {
            contents.current.delete(u.id);
            editor.current?.forget(u.id);
            if (openFile?.file.id === u.id) await open(u);
          }
        }
      }
      setExtraFolders((x) => x.filter((p) => p !== folder));
      await reloadProject();
    });

  const renameFile = (file: FileDTO) =>
    run(async () => {
      const path = await dialog.prompt(t('files.renamePrompt'), file.path, t('files.allowedHint'));
      if (!path || path === file.path) return;
      await flush();
      const updated = await api.moveFile(id, file.id, path);
      const p = await reloadProject();
      if (openFile?.file.id === file.id) setOpenFile((o) => (o ? { ...o, file: updated } : o));
      setProject(p);
    });

  const deleteFile = (file: FileDTO) =>
    run(async () => {
      if (!(await dialog.confirm(t('files.confirmDelete', { path: file.path })))) return;
      pending.current.delete(file.id);
      await api.deleteFile(id, file.id);
      contents.current.delete(file.id);
      editor.current?.forget(file.id);
      if (openFile?.file.id === file.id) setOpenFile(null);
      await reloadProject();
    });

  const renameFolder = (path: string) =>
    run(async () => {
      const to = await dialog.prompt(t('files.renamePrompt'), path, t('files.allowedHint'));
      if (!to || to === path) return;
      if (!checkProjectPath(to, false).ok) throw new ApiError(400, 'invalid_path', 'Invalid folder name');
      const hasFiles = files.some((f) => f.path.startsWith(`${path}/`));
      if (hasFiles) {
        await flush();
        await api.renameFolder(id, path, to);
        const p = await reloadProject();
        if (openFile) {
          const moved = p.files.find((f) => f.id === openFile.file.id);
          if (moved) setOpenFile((o) => (o ? { ...o, file: moved } : o));
        }
      }
      setExtraFolders((f) => f.map((x) => (x === path || x.startsWith(`${path}/`) ? to + x.slice(path.length) : x)));
    });

  const deleteFolder = (path: string) =>
    run(async () => {
      if (!(await dialog.confirm(t('files.confirmDeleteFolder', { path })))) return;
      if (files.some((f) => f.path.startsWith(`${path}/`))) {
        await api.deleteFolder(id, path);
        if (openFile?.file.path.startsWith(`${path}/`)) setOpenFile(null);
        await reloadProject();
      }
      setExtraFolders((f) => f.filter((x) => x !== path && !x.startsWith(`${path}/`)));
    });

  // --- render --------------------------------------------------------------

  if (loadError) {
    return (
      <div className="page">
        <p className="empty">
          {loadError} — <Link to="/">{t('editor.back')}</Link>
        </p>
      </div>
    );
  }
  if (!project) return <div className="page loading" />;

  const pdfUrl = job?.hasPdf ? api.pdfUrl(id, job.id) : null;
  const saveLabel: Record<SaveState, string> = {
    saved: t('editor.saved'),
    saving: t('editor.saving'),
    unsaved: t('editor.unsaved'),
    error: t('editor.saveError'),
  };
  const texFiles = files.filter((f) => f.path.endsWith('.tex'));
  const isImage = openFile && /^image\//.test(openFile.file.mimeType);

  return (
    <div className="editor-page">
      <header className="topbar editor-topbar">
        {user && (
          <Link to="/" className="back-link">
            ← {t('editor.back')}
          </Link>
        )}
        <button
          className="project-name"
          onClick={() => void renameProject()}
          disabled={!isOwner}
          title={isOwner ? t('projects.rename') : undefined}
        >
          {project.name}
        </button>
        {canEdit ? (
          <span className={`save-state save-${saveState}`} data-testid="save-state">
            {saveLabel[saveState]}
          </span>
        ) : (
          <span className="read-only-badge" data-testid="read-only-badge">
            {t('share.readOnly')}
          </span>
        )}
        {!canEdit && share?.linkRole === 'editor' && !user && (
          <Link className="muted" to={`/login?next=${encodeURIComponent(`/s/${share.token}`)}`}>
            {t('share.loginToEdit')}
          </Link>
        )}
        <div className="spacer" />
        <label className="inline-field">
          {t('editor.compiler')}
          <select
            disabled={!canEdit}
            value={project.compiler}
            onChange={(e) => void updateProject({ compiler: e.target.value as Compiler })}
          >
            {COMPILERS.map((c) => (
              <option key={c} value={c}>
                {COMPILER_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          {t('editor.mainFile')}
          <select disabled={!canEdit} value={project.mainFile} onChange={(e) => void updateProject({ mainFile: e.target.value })}>
            {!texFiles.some((f) => f.path === project.mainFile) && <option value={project.mainFile}>{project.mainFile}</option>}
            {texFiles.map((f) => (
              <option key={f.id} value={f.path}>
                {f.path}
              </option>
            ))}
          </select>
        </label>
        <button
          className="primary compile-button"
          onClick={() => void compile()}
          disabled={compiling}
          title={t('editor.shortcutHint')}
        >
          {compiling ? t('editor.compiling') : `▶ ${t('editor.compile')}`}
        </button>
        {pdfUrl && (
          <a className="button" href={api.pdfUrl(id, job!.id, true)} download>
            ⬇ {t('editor.downloadPdf')}
          </a>
        )}
        <a className="button" href={api.zipUrl(id)} download>
          ⬇ {t('editor.downloadZip')}
        </a>
        {isOwner && (
          <button onClick={() => setSharing(true)} data-testid="share-button">
            {t('share.button')}
          </button>
        )}
        <LanguageSwitcher />
        <UserMenu />
      </header>
      {sharing && <ShareDialog projectId={id} onClose={() => setSharing(false)} />}

      <div className="editor-layout">
        <FileTree
          files={files}
          extraFolders={extraFolders}
          selectedId={openFile?.file.id ?? null}
          mainFile={project.mainFile}
          readOnly={!canEdit}
          onOpen={(f) => void open(f)}
          onNewFile={(folder) => void newFile(folder)}
          onNewFolder={(folder) => void newFolder(folder)}
          onUpload={(folder, list) => void upload(folder, list)}
          onRename={(f) => void renameFile(f)}
          onDelete={(f) => void deleteFile(f)}
          onSetMain={(f) => void updateProject({ mainFile: f.path })}
          onRenameFolder={(p) => void renameFolder(p)}
          onDeleteFolder={(p) => void deleteFolder(p)}
        />

        <section className="editor-pane">
          {openFile && <div className="pane-title">{openFile.file.path}</div>}
          {openFile?.content != null ? (
            <CodeEditor
              ref={editor}
              docKey={openFile.file.id}
              initialDoc={openFile.content}
              readOnly={!canEdit}
              onChange={(doc) => onChange(openFile.file.id, doc)}
              onSave={() => void flush().catch(() => undefined)}
              onCompile={() => void compile()}
            />
          ) : openFile ? (
            <div className="binary-preview">
              {isImage ? (
                <img src={api.fileUrl(id, openFile.file.id)} alt={openFile.file.path} />
              ) : (
                <p className="muted">{t('editor.binaryFile')}</p>
              )}
            </div>
          ) : (
            <p className="empty">{t('editor.noFile')}</p>
          )}
        </section>

        <section className="output-pane">
          <PdfViewer url={pdfUrl} />
          <LogPanel job={job} logUrl={job ? api.logUrl(id, job.id) : null} onJump={(e) => void jumpTo(e)} />
        </section>
      </div>
    </div>
  );
}
