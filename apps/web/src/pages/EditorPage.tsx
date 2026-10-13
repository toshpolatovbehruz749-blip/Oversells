import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import * as Y from 'yjs';
import {
  COMPILERS,
  checkProjectPath,
  joinProjectPath,
  type CommentThreadDTO,
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
import { HistoryDialog } from '../components/HistoryDialog';
import { CommentsPanel } from '../components/CommentsPanel';
import { PresenceList } from '../components/PresenceList';
import { useAuth } from '../auth/AuthContext';
import { FileTree } from '../components/FileTree';
import { CodeEditor, type CodeEditorHandle, type CommentRange } from '../components/CodeEditor';
import { PdfViewer } from '../components/PdfViewer';
import { LogPanel } from '../components/LogPanel';
import { CollabSession, userColor, type ConnectionStatus, type FileSession } from '../collab/session';

const POLL_INTERVAL_MS = 700;
const COMMENTS_REFRESH_MS = 5000;
const COMPILER_LABELS: Record<Compiler, string> = { pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Current range of a comment in the client's copy of the document. */
function resolveRange(session: FileSession, c: CommentThreadDTO): { from: number; to: number } | null {
  if (!c.anchorStart || !c.anchorEnd) return null;
  try {
    const a = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(fromB64(c.anchorStart)), session.doc);
    const b = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(fromB64(c.anchorEnd)), session.doc);
    if (!a || !b || a.type !== session.text || b.type !== session.text || b.index < a.index) return null;
    if (a.index === b.index && c.quote) return null; // its text was deleted
    return { from: a.index, to: b.index };
  } catch {
    return null;
  }
}

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
  const [openFile, setOpenFile] = useState<FileDTO | null>(null);
  /** Id of the text file whose document finished its first sync. */
  const [readyFileId, setReadyFileId] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [job, setJob] = useState<CompileJobDTO | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sidePanel, setSidePanel] = useState<'pdf' | 'comments'>('pdf');
  const [threads, setThreads] = useState<CommentThreadDTO[]>([]);
  const [activeComment, setActiveComment] = useState<string | null>(null);

  const editor = useRef<CodeEditorHandle>(null);
  const pendingJump = useRef<{ fileId: string; line?: number; range?: { from: number; to: number } } | null>(null);

  const files = useMemo(() => project?.files ?? [], [project]);
  const role = project?.access ?? 'viewer';
  const canEdit = role !== 'viewer';
  const isOwner = role === 'owner';

  // --- real-time session ---------------------------------------------------

  const session = useMemo(() => {
    if (user === undefined) return null;
    const name = user?.name ?? t('collab.guest');
    return new CollabSession(id, share?.token ?? null, { name, ...userColor(user?.id ?? `${name}-${Math.random()}`) });
    // A new session only for another project or user; the language does not matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, share?.token, user?.id]);

  useEffect(() => {
    if (!session) return;
    setStatus(session.status());
    const off = session.onStatus(setStatus);
    const tick = setInterval(() => session.refresh(), 1000);
    return () => {
      off();
      clearInterval(tick);
      session.destroy();
    };
  }, [session]);

  // --- loading -------------------------------------------------------------

  const reloadProject = useCallback(async () => {
    const p = await api.getProject(id);
    setProject(p);
    return p;
  }, [id]);

  const reloadComments = useCallback(async () => {
    try {
      setThreads(await api.listComments(id));
    } catch {
      // Shown again on the next refresh.
    }
  }, [id]);

  const open = useCallback(
    async (file: FileDTO) => {
      setOpenFile(file);
      if (file.kind !== 'text' || !session) return;
      const s = session.get(file.id);
      await s.synced;
      setReadyFileId(file.id);
    },
    [session],
  );

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await reloadProject();
        if (cancelled) return;
        const main = p.files.find((f) => f.path === p.mainFile) ?? p.files.find((f) => f.kind === 'text');
        if (main) void open(main);
        const latest = await api.latestJob(id);
        if (!cancelled) setJob(latest);
        await reloadComments();
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, session, reloadProject, reloadComments, open]);

  // Comments of other people appear within a few seconds.
  useEffect(() => {
    const timer = setInterval(() => void reloadComments(), COMMENTS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [reloadComments]);

  const fileSession = openFile && readyFileId === openFile.id && session ? session.get(openFile.id) : null;

  const fileThreads = useMemo(() => threads.filter((c) => c.fileId === openFile?.id), [threads, openFile]);
  const commentRanges = useMemo<CommentRange[]>(() => {
    if (!fileSession) return [];
    return fileThreads
      .filter((c) => !c.resolved)
      .flatMap((c) => {
        const r = resolveRange(fileSession, c);
        return r ? [{ id: c.id, ...r, active: c.id === activeComment }] : [];
      });
  }, [fileSession, fileThreads, activeComment]);

  // --- compile -------------------------------------------------------------

  const compilingRef = useRef(false);
  const compile = useCallback(async () => {
    if (compilingRef.current) return;
    compilingRef.current = true;
    setCompiling(true);
    try {
      // Make sure our last keystrokes left the browser; the server flushes the rest.
      await session?.waitForUpload();
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
  }, [session, id, toast]);

  // Ctrl/Cmd+Enter compiles from anywhere; Ctrl/Cmd+S is a no-op (saving is continuous).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The code editor handles its own shortcuts and marks them as handled.
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        void compile();
      } else if (e.key === 's') {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compile]);

  /** Opens a file (if needed) and moves to a line or range once its editor is ready. */
  const goTo = useCallback(
    async (file: FileDTO, target: { line?: number; range?: { from: number; to: number } }) => {
      if (readyFileId === file.id && openFile?.id === file.id) {
        if (target.range) editor.current?.showRange(target.range.from, target.range.to);
        else editor.current?.gotoLine(target.line ?? 1);
        return;
      }
      pendingJump.current = { fileId: file.id, ...target };
      await open(file);
    },
    [open, openFile, readyFileId],
  );

  useEffect(() => {
    const jump = pendingJump.current;
    if (!jump || readyFileId !== jump.fileId || openFile?.id !== jump.fileId) return;
    pendingJump.current = null;
    // Wait one frame so the editor for the file is mounted.
    requestAnimationFrame(() => {
      if (jump.range) editor.current?.showRange(jump.range.from, jump.range.to);
      else editor.current?.gotoLine(jump.line ?? 1);
    });
  }, [openFile, readyFileId]);

  const jumpToLog = (entry: LogEntry) => {
    const file = files.find((f) => f.path === entry.file);
    if (file) void goTo(file, { line: entry.line ?? 1 });
  };

  const selectComment = (c: CommentThreadDTO) => {
    setActiveComment(c.id);
    const file = files.find((f) => f.id === c.fileId);
    if (!file || !session) return;
    const r = resolveRange(session.get(file.id), c);
    void goTo(file, r ? { range: r } : { line: 1 });
  };

  // --- comments --------------------------------------------------------------

  const addComment = async () => {
    if (!fileSession || !openFile) return;
    const { from, to } = editor.current?.selection() ?? { from: 0, to: 0 };
    if (from === to) {
      toast(t('comments.selectFirst'));
      return;
    }
    const body = await dialog.prompt(t('comments.prompt'));
    if (!body) return;
    try {
      const start = Y.createRelativePositionFromTypeIndex(fileSession.text, from, 0);
      const end = Y.createRelativePositionFromTypeIndex(fileSession.text, to, -1);
      await session?.waitForUpload();
      const created = await api.createComment(id, {
        fileId: openFile.id,
        anchorStart: b64(Y.encodeRelativePosition(start)),
        anchorEnd: b64(Y.encodeRelativePosition(end)),
        body,
      });
      setThreads((ts) => [...ts, created]);
      setActiveComment(created.id);
      setSidePanel('comments');
    } catch (err) {
      toast(errorMessage(err));
    }
  };

  const updateThread = (updated: CommentThreadDTO) => setThreads((ts) => ts.map((c) => (c.id === updated.id ? updated : c)));

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
      await open(file);
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
        try {
          await api.upload(id, folder, [f]);
        } catch (err) {
          if (!(err instanceof ApiError && err.code === 'file_exists')) throw err;
          if (!(await dialog.confirm(t('files.overwrite', { name: f.name })))) continue;
          // Text files are replaced as a live edit, so open editors update by themselves.
          await api.upload(id, folder, [f], true);
        }
      }
      setExtraFolders((x) => x.filter((p) => p !== folder));
      await reloadProject();
    });

  const renameFile = (file: FileDTO) =>
    run(async () => {
      const path = await dialog.prompt(t('files.renamePrompt'), file.path, t('files.allowedHint'));
      if (!path || path === file.path) return;
      const updated = await api.moveFile(id, file.id, path);
      await reloadProject();
      if (openFile?.id === file.id) setOpenFile(updated);
    });

  const deleteFile = (file: FileDTO) =>
    run(async () => {
      if (!(await dialog.confirm(t('files.confirmDelete', { path: file.path })))) return;
      await api.deleteFile(id, file.id);
      session?.forget(file.id);
      if (openFile?.id === file.id) setOpenFile(null);
      await reloadProject();
    });

  const renameFolder = (path: string) =>
    run(async () => {
      const to = await dialog.prompt(t('files.renamePrompt'), path, t('files.allowedHint'));
      if (!to || to === path) return;
      if (!checkProjectPath(to, false).ok) throw new ApiError(400, 'invalid_path', 'Invalid folder name');
      if (files.some((f) => f.path.startsWith(`${path}/`))) {
        await api.renameFolder(id, path, to);
        const p = await reloadProject();
        const moved = openFile && p.files.find((f) => f.id === openFile.id);
        if (moved) setOpenFile(moved);
      }
      setExtraFolders((f) => f.map((x) => (x === path || x.startsWith(`${path}/`) ? to + x.slice(path.length) : x)));
    });

  const deleteFolder = (path: string) =>
    run(async () => {
      if (!(await dialog.confirm(t('files.confirmDeleteFolder', { path })))) return;
      const inside = files.filter((f) => f.path.startsWith(`${path}/`));
      if (inside.length) {
        await api.deleteFolder(id, path);
        for (const f of inside) session?.forget(f.id);
        if (openFile?.path.startsWith(`${path}/`)) setOpenFile(null);
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
  if (!project || !session) return <div className="page loading" />;

  const pdfUrl = job?.hasPdf ? api.pdfUrl(id, job.id) : null;
  const statusLabel: Record<ConnectionStatus, string> = {
    connected: t('editor.saved'),
    connecting: t('collab.connecting'),
    offline: t('collab.offline'),
  };
  const texFiles = files.filter((f) => f.path.endsWith('.tex'));
  const isImage = openFile && /^image\//.test(openFile.mimeType);
  const openComments = threads.filter((c) => !c.resolved).length;

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
          <span className={`save-state save-${status}`} data-testid="save-state" title={t('collab.liveHint')}>
            {statusLabel[status]}
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
        <button onClick={() => setHistoryOpen(true)} data-testid="history-button">
          {t('history.button')}
        </button>
        {isOwner && (
          <button onClick={() => setSharing(true)} data-testid="share-button">
            {t('share.button')}
          </button>
        )}
        <LanguageSwitcher />
        <UserMenu />
      </header>
      {sharing && <ShareDialog projectId={id} onClose={() => setSharing(false)} />}
      {historyOpen && (
        <HistoryDialog
          projectId={id}
          canWrite={canEdit}
          onClose={() => setHistoryOpen(false)}
          onRestored={() => {
            void reloadProject();
            void reloadComments();
          }}
        />
      )}

      <div className="editor-layout">
        <FileTree
          files={files}
          extraFolders={extraFolders}
          selectedId={openFile?.id ?? null}
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
          {openFile && (
            <div className="pane-title">
              <span data-testid="open-file-path">{openFile.path}</span>
              {fileSession && <PresenceList session={fileSession} />}
              {fileSession && canEdit && (
                <button className="small" onClick={() => void addComment()} data-testid="add-comment">
                  💬 {t('comments.add')}
                </button>
              )}
            </div>
          )}
          {openFile?.kind === 'text' ? (
            fileSession ? (
              <CodeEditor
                key={openFile.id}
                ref={editor}
                session={fileSession}
                readOnly={!canEdit}
                comments={commentRanges}
                onCommentClick={(cid) => {
                  setActiveComment(cid);
                  setSidePanel('comments');
                }}
                onCompile={() => void compile()}
              />
            ) : (
              <p className="empty">{t('collab.connecting')}</p>
            )
          ) : openFile ? (
            <div className="binary-preview">
              {isImage ? (
                <img src={api.fileUrl(id, openFile.id)} alt={openFile.path} />
              ) : (
                <p className="muted">{t('editor.binaryFile')}</p>
              )}
            </div>
          ) : (
            <p className="empty">{t('editor.noFile')}</p>
          )}
        </section>

        <section className="output-pane">
          <div className="side-tabs" role="tablist">
            <button role="tab" aria-selected={sidePanel === 'pdf'} className={sidePanel === 'pdf' ? 'active' : ''} onClick={() => setSidePanel('pdf')}>
              PDF
            </button>
            <button
              role="tab"
              aria-selected={sidePanel === 'comments'}
              className={sidePanel === 'comments' ? 'active' : ''}
              onClick={() => setSidePanel('comments')}
              data-testid="comments-tab"
            >
              {t('comments.title')} {openComments > 0 && <span className="count-badge">{openComments}</span>}
            </button>
          </div>
          {sidePanel === 'pdf' ? (
            <>
              <PdfViewer url={pdfUrl} />
              <LogPanel job={job} logUrl={job ? api.logUrl(id, job.id) : null} onJump={jumpToLog} />
            </>
          ) : (
            <CommentsPanel
              threads={fileThreads}
              activeId={activeComment}
              canWrite={canEdit}
              currentUserId={user?.id ?? null}
              isOwner={isOwner}
              onSelect={selectComment}
              onReply={async (c, body) => {
                try {
                  updateThread(await api.replyComment(id, c.id, body));
                } catch (err) {
                  toast(errorMessage(err));
                }
              }}
              onResolve={async (c, resolved) => {
                try {
                  updateThread(await api.resolveComment(id, c.id, resolved));
                } catch (err) {
                  toast(errorMessage(err));
                }
              }}
              onDelete={async (c, replyId) => {
                if (!(await dialog.confirm(t('comments.confirmDelete')))) return;
                try {
                  await api.deleteComment(id, replyId ?? c.id);
                  await reloadComments();
                } catch (err) {
                  toast(errorMessage(err));
                }
              }}
            />
          )}
        </section>
      </div>
    </div>
  );
}
