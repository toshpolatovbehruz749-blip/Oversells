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
import { baseLanguage, errorMessage, uiText } from '../i18n';
import { useDialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { UserMenu } from '../components/UserMenu';
import { ShareDialog } from '../components/ShareDialog';
import { HistoryDialog } from '../components/HistoryDialog';
import { CommentsPanel } from '../components/CommentsPanel';
import { PresenceList } from '../components/PresenceList';
import { useAuth } from '../auth/AuthContext';
import { FileTree, PICTURE_DRAG_TYPE } from '../components/FileTree';
import { CodeEditor, type CodeEditorHandle, type CommentRange } from '../components/CodeEditor';
import { PdfViewer, type PdfHighlight, type PdfTextSelection } from '../components/PdfViewer';
import { LogPanel } from '../components/LogPanel';
import { SpellClient } from '../spell/client';
import type { SpellMenuRequest } from '../spell/extension';
import { SpellMenu } from '../components/SpellMenu';
import { AI_LANGUAGES, SPELL_LANGUAGES, PageDesignError, type PageLayout, type CharacterStyle, applyCharacterStyle, applyParagraphStyle, findSelectionInSource, type AiFixDTO, type AiLanguage, type AiStatusDTO, type SpellLanguage } from '@oversells/shared';
import { AiDialog } from '../components/AiDialog';
import { DesignDialog } from '../components/DesignDialog';
import { SnippetMenu } from '../components/SnippetMenu';
import { FixDialog } from '../components/FixDialog';
import { TestDialog, type TestRequest } from '../components/TestDialog';
import { PrintDialog } from '../components/PrintDialog';
import { PageDesignDialog } from '../components/PageDesignDialog';
import { ImageFormulaDialog } from '../components/ImageFormulaDialog';
import { DrawDialog } from '../components/DrawDialog';
import { isPicture, MIN_PRINT_DPI, pictureSnippet, preparePicture, printDpi } from '../images/prepare';
import type { PrintSpec } from '@oversells/shared';
import type { DesignLanguage } from '@oversells/shared';
import {
  compilerFits,
  detectCompiler,
  findDrawing,
  fixFonts,
  fontProblem,
  replaceInLine,
  replaceFontCommand,
  type CompilerHint,
  type Drawing,
  type QuickFix,
} from '@oversells/shared';
import { AiFixDialog } from '../components/AiFixDialog';
import type { LogPanelAi } from '../components/LogPanel';
import { locateExcerpt, minimalEdit, preambleInsertion, type TextEdit } from '../ai/apply';
import { CollabSession, userColor, type ConnectionStatus, type FileSession } from '../collab/session';
import { droppedFrameCode, type DropPoint } from '../components/page-overlay';
import { dragSplit, dragTree, loadLayout, saveLayout, DEFAULT_LAYOUT, type PaneLayout } from '../components/pane-layout';

const POLL_INTERVAL_MS = 700;
/** Pause after the last keystroke before an automatic compile. */
const AUTO_COMPILE_DELAY_MS = 1000;
const AUTO_COMPILE_KEY = 'oversells.autoCompile';

function readAutoCompile(): boolean {
  try {
    return localStorage.getItem(AUTO_COMPILE_KEY) !== '0';
  } catch {
    return true;
  }
}
const COMMENTS_REFRESH_MS = 5000;
const TERMINAL_STATUSES = new Set(['success', 'failed', 'timeout', 'error']);
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
  const { t, i18n } = useTranslation();
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
  /** The one pane a phone shows at a time (wide screens show all three). */
  const [mobilePane, setMobilePane] = useState<'files' | 'editor' | 'pdf'>('pdf');
  // Pane sizes (drag the borders), folded file tree and tool buttons; kept per browser.
  const [layout, setLayoutState] = useState<PaneLayout>(() => loadLayout());
  const setLayout = (change: (l: PaneLayout) => PaneLayout) =>
    setLayoutState((l) => {
      const next = change(l);
      saveLayout(next);
      return next;
    });
  const layoutRef = useRef<HTMLDivElement>(null);
  /** Pointer drag on a border: 0 = files | code, 1 = code | PDF. */
  const startResize = (which: 0 | 1, e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const panes = layoutRef.current;
    const code = panes?.querySelector<HTMLElement>(':scope > .editor-pane')?.getBoundingClientRect().width ?? 0;
    const pdf = panes?.querySelector<HTMLElement>(':scope > .output-pane')?.getBoundingClientRect().width ?? 0;
    const tree0 = layout.tree;
    document.body.classList.add('pane-resizing');
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      setLayoutState((l) => (which === 0 ? { ...l, tree: dragTree(tree0, dx) } : { ...l, code: dragSplit(code, pdf, dx) }));
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      document.body.classList.remove('pane-resizing');
      setLayoutState((l) => {
        saveLayout(l);
        return l;
      });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const [threads, setThreads] = useState<CommentThreadDTO[]>([]);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [pdfHighlight, setPdfHighlight] = useState<PdfHighlight | null>(null);
  const [spellMenu, setSpellMenu] = useState<SpellMenuRequest | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatusDTO | null>(null);
  const [aiFix, setAiFix] = useState<AiFixDTO | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [designOpen, setDesignOpen] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  /** Text the "Tuzatish" dialog was opened with. */
  const [fixText, setFixText] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  // «Sahifa dizayni»: only when the server turns the feature on.
  const [pageDesignOn, setPageDesignOn] = useState(false);
  const [pageDesignOpen, setPageDesignOpen] = useState(false);
  // Visual mode: the text block and fixed frames drawn over the PDF, dragged with the mouse.
  const [visualMode, setVisualMode] = useState(false);
  const [baselineGrid, setBaselineGrid] = useState(false);
  const [pageLayout, setPageLayout] = useState<PageLayout | null>(null);
  const [imageOpen, setImageOpen] = useState(false);
  /** The drawing dialog: open with the drawing around the cursor (to edit) or none. */
  const [draw, setDraw] = useState<{ edit: { from: number; to: number; drawing: Drawing; source: string } | null } | null>(null);
  const [printBusy, setPrintBusy] = useState(false);

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

  // --- spell checking --------------------------------------------------------

  const spellClient = useMemo(() => new SpellClient(), []);
  useEffect(() => () => spellClient.destroy(), [spellClient]);
  useEffect(() => {
    if (user) api.dictionary().then((w) => spellClient.setUserWords(w), () => undefined);
  }, [user, spellClient]);

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

  // Who else has which file open (dots in the file tree): refreshed with the comments.
  const [presence, setPresence] = useState<Map<string, Array<{ name: string; color: string }>>>(new Map());
  useEffect(() => {
    if (!project) return;
    let live = true;
    const refresh = () =>
      api.presence(id).then(
        (list) => {
          if (!live) return;
          const m = new Map<string, Array<{ name: string; color: string }>>();
          for (const f of list) {
            const others = f.users.filter((u) => !user || u.userId !== user.id);
            if (others.length) m.set(f.fileId, others);
          }
          setPresence(m);
        },
        () => undefined,
      );
    void refresh();
    const timer = setInterval(() => void refresh(), COMMENTS_REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [id, !!project, user]);

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
  // Local edits counted, and how many a started compile includes: a pending auto-compile
  // for edits that a compile (started by hand) already took is not run again.
  const editsRef = useRef(0);
  const compiledEditsRef = useRef(0);
  // "Faqat shu bob": compile only the chapter around the cursor (remembered per project).
  const chapterKey = `oversells.chapterOnly.${id}`;
  const [chapterOnly, setChapterOnly] = useState(() => {
    try {
      return localStorage.getItem(chapterKey) === '1';
    } catch {
      return false;
    }
  });
  const chapterOnlyRef = useRef(chapterOnly);
  chapterOnlyRef.current = chapterOnly;
  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;
  // Visual mode: the layout of the latest successful compile (what sahifa.sty wrote into the log).
  const layoutJob = visualMode && job?.status === 'success' ? job.id : null;
  useEffect(() => {
    if (!layoutJob) {
      setPageLayout(null);
      return;
    }
    let live = true;
    api.pageLayout(id).then(
      (r) => {
        if (!live) return;
        setPageLayout(r.layout);
        if (!r.layout) toast(t('pageDesign.visualNoLayout'));
      },
      () => live && setPageLayout(null),
    );
    return () => {
      live = false;
    };
  }, [id, layoutJob, toast, t]);

  // «InDesignʼda ochish»: the desktop app on a Mac with InDesign, opened on that Mac itself (the
  // helper app there takes the oversells-indesign:// link; a phone on the Wi-Fi has none).
  const [inDesign, setInDesign] = useState<string | null>(null);
  const onThisMac = /Mac/i.test(navigator.platform || navigator.userAgent) && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  const openInInDesign = async () => {
    setIdmlBusy(true);
    try {
      const { url } = await api.idmlTicket(id);
      window.location.href = url;
      toast(t('idml.opening', { app: inDesign }));
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setIdmlBusy(false);
    }
  };

  // InDesign (IDML) export: downloaded through fetch so what did not go over can be said.
  const [idmlBusy, setIdmlBusy] = useState(false);
  const exportIdml = async () => {
    setIdmlBusy(true);
    try {
      const { blob, fileName, warnings } = await api.idml(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      const notes = warnings.map((w) =>
        w.kind === 'missingPicture' ? t('idml.missingPicture', { name: w.name }) : t(`idml.${w.kind}`, { count: w.count }),
      );
      toast([t(fileName.endsWith('.zip') ? 'idml.doneZip' : 'idml.done'), ...notes].join(' '));
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setIdmlBusy(false);
    }
  };

  const pageOverlay = {
    onMargin: async (edge: 'inner' | 'outer' | 'top' | 'bottom', mm: number) => {
      try {
        const { design, version } = await api.getPageDesign(id);
        await api.savePageDesign(id, { ...design, page: { ...design.page, [edge]: mm } }, false, version);
        toast(t('pageDesign.marginSet', { edge: t(`pageDesign.margin.${edge}`), mm }));
        await compile();
      } catch (err) {
        toast(errorMessage(err));
      }
    },
    /**
     * A picture dropped on a PDF page: uploaded if it comes from the computer, then a fixed frame
     * at that point, written after the source line SyncTeX gives for it (so it lands on that page).
     */
    onDrop: async (at: DropPoint, data: DataTransfer) => {
      try {
        if (!job?.hasSynctex) throw new Error(t('pageDesign.dropNeedsCompile'));
        const main = files.find((f) => f.path === project?.mainFile);
        const base = main?.path.includes('/') ? main.path.slice(0, main.path.lastIndexOf('/') + 1) : '';
        let path = data.getData(PICTURE_DRAG_TYPE);
        const dropped = [...data.files].find((f) => /^image\//.test(f.type) || /\.(png|jpe?g)$/i.test(f.name));
        if (!path && dropped) {
          const taken = new Set(files.map((f) => f.path));
          const pic = await preparePicture(dropped, (name) => taken.has(`${base}rasmlar/${name}`));
          await api.upload(id, `${base}rasmlar`, [pic.file]);
          path = `${base}rasmlar/${pic.file.name}`;
        }
        if (!path) return;
        const relative = base && path.startsWith(base) ? path.slice(base.length) : path;
        const src = await api.synctexReverse(id, job.id, at.page, at.x, at.y);
        const file = files.find((f) => f.id === src.fileId) ?? files.find((f) => f.path === src.file);
        if (!file) throw new Error(t('synctex.notFound'));
        const code = droppedFrameCode(relative, at);
        await editFile(file.id, (text) => {
          let end = 0;
          for (let n = 1; n <= src.line && end !== -1; n++) end = text.indexOf('\n', n === 1 ? 0 : end + 1);
          const atPos = end === -1 ? text.length : end;
          return { at: atPos, remove: 0, insert: `\n${code}` };
        });
        await reloadProject();
        void goTo(file, { line: src.line + 1 });
        toast(t('pageDesign.dropped', { x: at.xMm, y: at.yMm }));
        await compile();
      } catch (err) {
        toast(errorMessage(err));
      }
    },
    onFrame: async (frame: { file: string; line: number }, change: { x?: number; y?: number; w?: number }) => {
      try {
        await api.moveFrame(id, { file: frame.file, line: frame.line, ...change });
        await compile();
      } catch (err) {
        toast(errorMessage(err));
      }
    },
  };

  // --- character styles applied on the PDF (visual mode) ---------------------------------------
  const [pdfSel, setPdfSel] = useState<PdfTextSelection | null>(null);
  const [charStyles, setCharStyles] = useState<CharacterStyle[]>([]);
  const [pdfStyle, setPdfStyle] = useState('');
  useEffect(() => {
    if (!visualMode || !pageDesignOn) return setPdfSel(null);
    let live = true;
    api.getPageDesign(id).then(
      (r) => {
        if (!live) return;
        setCharStyles(r.design.characterStyles);
        setPdfStyle((s) => (r.design.characterStyles.some((c) => c.id === s) ? s : r.design.characterStyles[0]?.id ?? ''));
      },
      () => live && setCharStyles([]),
    );
    return () => {
      live = false;
    };
  }, [id, visualMode, pageDesignOn, job?.id]);

  /** The text selected on the PDF, found through SyncTeX in its source, into \matnuslubi{style}{…}. */
  const applyPdfStyle = async (sel: PdfTextSelection, styleId: string) => {
    if (!job?.hasSynctex || !session) return toast(t('pageDesign.pdfStyle.needsCompile'));
    try {
      const src = await api.synctexReverse(id, job.id, sel.page, sel.x, sel.y);
      const file = files.find((f) => f.id === src.fileId) ?? files.find((f) => f.path === src.file);
      if (!file) return toast(t('synctex.notFound'));
      const s = session.get(file.id);
      await s.synced;
      const text = s.text.toString();
      const at = findSelectionInSource(text, src.line, sel.text);
      if (!at) return toast(t('pageDesign.pdfStyle.notFound'));
      const edits = applyCharacterStyle(text, at.from, at.to, styleId);
      s.doc.transact(() => {
        for (const e of [...edits].sort((a, b) => b.from - a.from)) {
          if (e.to > e.from) s.text.delete(e.from, e.to - e.from);
          if (e.insert) s.text.insert(e.from, e.insert);
        }
      });
      window.getSelection()?.removeAllRanges();
      setPdfSel(null);
      toast(t('pageDesign.pdfStyle.applied', { file: file.path }));
      await compile();
    } catch (err) {
      toast(err instanceof PageDesignError ? t(`pageDesign.applyError.${err.code}`) : errorMessage(err));
    }
  };

  /** «Sahifa dizayni»: the code editor's selection into a paragraph or character style; an error key or null. */
  const applyStyle = (kind: 'paragraph' | 'character', styleId: string): string | null => {
    const ed = editor.current;
    if (!ed) return 'noEditor';
    const text = ed.text();
    const { from, to } = ed.selection();
    try {
      const edits = kind === 'paragraph' ? applyParagraphStyle(text, from, to, styleId) : applyCharacterStyle(text, from, to, styleId);
      return ed.applyEdits(edits, text) ? null : 'changed';
    } catch (err) {
      return err instanceof PageDesignError ? err.code : 'invalid';
    }
  };

  const compile = useCallback(async (opts: { whole?: boolean } = {}) => {
    if (compilingRef.current) return;
    compilingRef.current = true;
    compiledEditsRef.current = editsRef.current;
    setCompiling(true);
    try {
      // Make sure our last keystrokes left the browser; the server flushes the rest.
      await session?.waitForUpload();
      const file = openFileRef.current;
      const preview =
        chapterOnlyRef.current && !opts.whole && file && /\.(tex|ltx)$/i.test(file.path)
          ? { file: file.path, line: editor.current?.cursorLine() ?? 1 }
          : undefined;
      let current = await api.compile(id, preview);
      setJob(current);
      while (current.status === 'queued' || current.status === 'running') {
        // Long polling: the server answers the moment the status changes.
        const known = current.status;
        current = await api.waitJob(id, current.id, known).catch(async (err) => {
          await sleep(POLL_INTERVAL_MS);
          if (err instanceof ApiError && err.status < 500) throw err;
          return current;
        });
        setJob(current);
      }
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      compilingRef.current = false;
      setCompiling(false);
    }
  }, [session, id, toast]);

  const makeTest = async (req: TestRequest) => {
    setTestBusy(true);
    try {
      await session?.waitForUpload();
      const res = await api.makeTest(id, req);
      setTestOpen(false);
      toast(
        res.problems.length
          ? t('test.doneWithProblems', { count: res.questions, lines: res.problems.map((p) => p.line).join(', ') })
          : t('test.done', { count: res.questions }),
      );
      await reloadProject();
      await compile();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setTestBusy(false);
    }
  };

  const changePrint = async (spec: PrintSpec | null) => {
    setPrintBusy(true);
    try {
      await session?.waitForUpload();
      if (spec) await api.setPrint(id, spec);
      else await api.removePrint(id);
      setPrintOpen(false);
      toast(spec ? t('print.applied') : t('print.removed'));
      await reloadProject();
      await compile();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setPrintBusy(false);
    }
  };

  const [scriptBusy, setScriptBusy] = useState(false);
  const toCyrillic = project?.spellLanguage !== 'uz-cyrl';
  const inNewLetters = project?.spellLanguage === 'uz-yangi';
  const changeScript = async (to: 'latn' | 'cyrl' | 'yangi') => {
    const confirm = { cyrl: 'script.confirmCyrl', latn: 'script.confirmLatn', yangi: 'script.confirmYangi' } as const;
    if (!(await dialog.confirm(t(confirm[to])))) return;
    setScriptBusy(true);
    try {
      await session?.waitForUpload();
      const res = await api.transliterate(id, to);
      toast(t('script.done', { count: res.changed }));
      await reloadProject();
      await compile();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setScriptBusy(false);
    }
  };

  // Auto-compile: shortly after the last local edit (and again after a running compile).
  const [autoCompile, setAutoCompile] = useState(() => readAutoCompile());
  useEffect(() => {
    if (!session || !canEdit || !autoCompile) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const run = async () => {
      if (stopped) return;
      if (compilingRef.current) {
        timer = setTimeout(() => void run(), AUTO_COMPILE_DELAY_MS);
        return;
      }
      // Already compiled (e.g. by Ctrl+Enter) since the last edit.
      if (compiledEditsRef.current >= editsRef.current) return;
      await compile();
    };
    const off = session.onEdit(() => {
      editsRef.current++;
      clearTimeout(timer);
      timer = setTimeout(() => void run(), AUTO_COMPILE_DELAY_MS);
    });
    return () => {
      stopped = true;
      off();
      clearTimeout(timer);
    };
  }, [session, canEdit, autoCompile, compile]);
  const toggleChapterOnly = (on: boolean) => {
    setChapterOnly(on);
    chapterOnlyRef.current = on;
    try {
      localStorage.setItem(chapterKey, on ? '1' : '0');
    } catch {
      // Only a preference.
    }
    void compile();
  };
  const toggleAutoCompile = (on: boolean) => {
    setAutoCompile(on);
    try {
      localStorage.setItem(AUTO_COMPILE_KEY, on ? '1' : '0');
    } catch {
      // Only a preference.
    }
  };

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
      setMobilePane('editor');
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

  // --- SyncTeX ---------------------------------------------------------------

  /** Editor -> PDF: show where the cursor line ends up in the PDF. */
  const showInPdf = async () => {
    if (!job?.hasSynctex || !openFile) {
      toast(t('synctex.compileFirst'));
      return;
    }
    try {
      const line = editor.current?.cursorLine() ?? 1;
      const pos = await api.synctexForward(id, job.id, openFile.path, line);
      setSidePanel('pdf');
      setMobilePane('pdf');
      setPdfHighlight({ page: pos.page, boxes: pos.boxes, nonce: Date.now() });
    } catch (err) {
      toast(err instanceof ApiError && err.status === 404 ? t('synctex.notFound') : errorMessage(err));
    }
  };

  /** PDF -> editor: double-click in the PDF opens the source line. */
  const syncFromPdf = async (page: number, x: number, y: number) => {
    if (!job?.hasSynctex) return;
    try {
      const src = await api.synctexReverse(id, job.id, page, x, y);
      const file = files.find((f) => f.id === src.fileId) ?? files.find((f) => f.path === src.file);
      if (file) void goTo(file, { line: src.line });
      else toast(t('synctex.notFound'));
    } catch (err) {
      toast(err instanceof ApiError && err.status === 404 ? t('synctex.notFound') : errorMessage(err));
    }
  };

  // --- AI assistance -----------------------------------------------------------

  const refreshAi = useCallback(() => {
    api.aiStatus().then(setAiStatus, () => setAiStatus(null));
    api.features().then(
      (f) => {
        setPageDesignOn(f.pageDesign);
        setInDesign(f.indesign ?? null);
      },
      () => setPageDesignOn(false),
    );
  }, []);
  useEffect(() => {
    if (user) refreshAi();
  }, [user, refreshAi]);

  const aiLang: AiLanguage = baseLanguage();

  /** Applies an edit to a file's shared text (live for everyone, undoable). */
  const editFile = async (fileId: string, edit: (text: string) => TextEdit | null): Promise<boolean> => {
    if (!session) return false;
    const s = session.get(fileId);
    await s.synced;
    const change = edit(s.text.toString());
    if (!change) return false;
    s.doc.transact(() => {
      if (change.remove) s.text.delete(change.at, change.remove);
      if (change.insert) s.text.insert(change.at, change.insert);
    });
    return true;
  };

  // --- letters the fonts lack (Cyrillic, ʻ in Latin Modern; pdfLaTeX) -----------

  // --- the engine the main file was written for (pdfLaTeX books from Overleaf) ------------

  const [compilerHint, setCompilerHint] = useState<CompilerHint | null>(null);
  const mainFileId = files.find((f) => f.path === project?.mainFile && f.kind === 'text')?.id;
  useEffect(() => {
    if (!session || !mainFileId) return;
    const s = session.get(mainFileId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let live = true;
    const read = () => live && setCompilerHint(detectCompiler(s.text.toString()));
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(read, 800);
    };
    void s.synced.then(read);
    s.text.observe(later);
    return () => {
      live = false;
      clearTimeout(timer);
      s.text.unobserve(later);
    };
  }, [session, mainFileId]);
  const hintKey = `oversells.compilerHint.${id}`;
  const [hintDismissed, setHintDismissed] = useState<string | null>(() => {
    try {
      return localStorage.getItem(hintKey);
    } catch {
      return null;
    }
  });
  const wrongCompiler =
    project && compilerHint && !compilerFits(project.compiler, compilerHint) && hintDismissed !== compilerHint.compiler ? compilerHint : null;
  const switchCompiler = async (hint: CompilerHint) => {
    await updateProject({ compiler: hint.compiler });
    toast(t('compilerHint.switched', { compiler: COMPILER_LABELS[hint.compiler] }));
    await compile();
  };
  const dismissHint = (hint: CompilerHint) => {
    setHintDismissed(hint.compiler);
    try {
      localStorage.setItem(hintKey, hint.compiler);
    } catch {
      // only a convenience
    }
  };

  const glyphs = useMemo(() => (job ? fontProblem(job.entries) : null), [job]);
  const glyphsMathOnly = !!glyphs && !glyphs.pdflatex && glyphs.fonts.every((f) => f.role === 'math');
  const fixGlyphs = async () => {
    const main = files.find((f) => f.path === project?.mainFile && f.kind === 'text');
    if (!glyphs || !project || !main) return;
    let result: ReturnType<typeof fixFonts> | null = null;
    await editFile(main.id, (text) => {
      result = fixFonts(text, glyphs, project.compiler);
      return result.text ? minimalEdit(text, result.text) : null;
    });
    const r = result as ReturnType<typeof fixFonts> | null;
    if (!r || (!r.text && !r.compiler)) {
      toast(t('glyphs.cannot'));
      return;
    }
    if (r.compiler) await updateProject({ compiler: r.compiler });
    toast(t('glyphs.fixed'));
    await compile();
  };

  // --- one-click fixes from the error help (explainError) -------------------------------

  const quickFix = async (entry: LogEntry, fix: QuickFix) => {
    const main = files.find((f) => f.path === project?.mainFile && f.kind === 'text');
    let ok = false;
    if (fix.kind === 'package' || fix.kind === 'preamble') {
      if (!main) return;
      const lines = fix.kind === 'package' ? [`\\usepackage{${fix.pkg}}`] : fix.line.includes('\\operatorname') ? ['\\usepackage{amsmath}', fix.line] : [fix.line];
      ok = await editFile(main.id, (text) => {
        // amsmath may already be loaded with others (\usepackage{amsmath,amssymb}).
        const missing = lines.filter((l) => !(l === '\\usepackage{amsmath}' && /\\usepackage(\[[^\]]*\])?\{[^}]*\bamsmath\b/.test(text)));
        return preambleInsertion(text, missing);
      });
    } else if (fix.kind === 'font') {
      // The font command is usually in the main file, sometimes in a .sty or an \input preamble.
      const texts = files.filter((f) => f.kind === 'text' && /\.(tex|sty|cls)$/.test(f.path));
      for (const f of [...texts.filter((f) => f.id === main?.id), ...texts.filter((f) => f.id !== main?.id)]) {
        if ((ok = await editFile(f.id, (text) => replaceFontCommand(text, fix.font, fix.replacement)))) break;
      }
    } else if (fix.kind === 'endDocument') {
      if (!main) return;
      ok = await editFile(main.id, (text) =>
        /\\end\s*\{document\}/.test(text) ? null : { at: text.length, remove: 0, insert: `${text.endsWith('\n') ? '' : '\n'}\\end{document}\n` },
      );
    } else {
      const file = files.find((f) => f.path === entry.file && f.kind === 'text');
      if (!file || entry.line === null) return;
      ok = await editFile(file.id, (text) => {
        const lines = text.split('\n');
        const old = lines[entry.line! - 1];
        const fixed = old === undefined ? null : replaceInLine(old, fix.find, fix.replace);
        if (fixed === null || old === undefined) return null;
        const at = lines.slice(0, entry.line! - 1).reduce((n, l) => n + l.length + 1, 0);
        return { at, remove: old.length, insert: fixed };
      });
    }
    if (!ok) {
      toast(t('help.notFound'));
      return;
    }
    toast(t('help.fixed'));
    await compile();
  };

  const logAi: LogPanelAi | undefined =
    aiStatus?.enabled && user && job
      ? {
          canFix: canEdit,
          explain: async (index) => {
            try {
              return uiText((await api.aiExplain(id, job.id, index, aiLang)).explanation);
            } finally {
              refreshAi();
            }
          },
          fix: async (index) => {
            try {
              setAiFix(await api.aiFix(id, job.id, index, aiLang));
            } finally {
              refreshAi();
            }
          },
        }
      : undefined;

  const acceptFix = async (fix: AiFixDTO) => {
    setAiFix(null);
    const applied = await editFile(fix.fileId, (text) => {
      const at = locateExcerpt(text, fix.startLine, fix.original);
      if (at === null) return null;
      const e = minimalEdit(fix.original, fix.suggestion);
      return { ...e, at: at + e.at };
    });
    if (!applied) {
      toast(t('ai.changed'));
      return;
    }
    toast(t('ai.applied'));
    const file = files.find((f) => f.id === fix.fileId);
    if (file) void goTo(file, { line: fix.startLine + Math.floor((fix.endLine - fix.startLine) / 2) });
  };

  const insertSnippet = async (latex: string, preamble: string[]) => {
    setAiOpen(false);
    editor.current?.insertAtCursor(`${latex}\n`);
    const main = files.find((f) => f.path === project?.mainFile && f.kind === 'text');
    if (main && preamble.length) await editFile(main.id, (text) => preambleInsertion(text, preamble));
    toast(t('ai.inserted'));
  };

  const openDraw = () => {
    const text = editor.current?.text() ?? '';
    const found = findDrawing(text, editor.current?.selection().from ?? 0);
    setDraw({ edit: found ? { ...found, source: text.slice(found.from, found.to) } : null });
  };

  const insertDrawing = async (source: string) => {
    const edit = draw?.edit;
    setDraw(null);
    if (edit) {
      if (!editor.current?.replaceRange(edit.from, edit.to, source, edit.source)) toast(t('ai.changed'));
      return;
    }
    editor.current?.insertAtCursor(`\\begin{center}\n${source}\n\\end{center}\n`);
    const main = files.find((f) => f.path === project?.mainFile && f.kind === 'text');
    if (main) await editFile(main.id, (text) => preambleInsertion(text, ['\\usepackage{tikz}']));
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

  const updateProject = async (patch: { name?: string; compiler?: Compiler; mainFile?: string; spellLanguage?: string }) => {
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
      for (const chosen of selected) {
        // Big photos are scaled down (the name stays); formats LaTeX cannot read become PNG.
        let f = chosen;
        if (isPicture(chosen)) {
          const taken = new Set(files.map((x) => x.path));
          const pic = await preparePicture(chosen, (name) => taken.has(folder ? `${folder}/${name}` : name), true).catch(() => null);
          if (pic) {
            f = pic.file;
            if (pic.scaledFrom) toast(t('pictures.scaled', { from: pic.scaledFrom.width, to: pic.width }));
          }
        }
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

  // --- pictures dropped or pasted into the text --------------------------------------------

  const insertPictures = async (selected: File[], pos: number) => {
    const main = files.find((f) => f.path === project?.mainFile && f.kind === 'text');
    if (!main) return;
    // Paths in \includegraphics are relative to the main file's folder.
    const base = main.path.includes('/') ? main.path.slice(0, main.path.lastIndexOf('/') + 1) : '';
    const folder = `${base}rasmlar`;
    const taken = new Set(files.map((f) => f.path));
    let at = pos;
    for (const original of selected) {
      try {
        const pic = await preparePicture(original, (name) => taken.has(`${folder}/${name}`));
        taken.add(`${folder}/${pic.file.name}`);
        await api.upload(id, folder, [pic.file]);
        const text = editor.current?.text() ?? '';
        const lineStart = at === 0 || text[at - 1] === '\n';
        const snippet = `${lineStart ? '' : '\n'}${pictureSnippet(`rasmlar/${pic.file.name}`)}`;
        editor.current?.replaceRange(at, at, snippet);
        at += snippet.length;
        if (pic.scaledFrom) toast(t('pictures.scaled', { from: pic.scaledFrom.width, to: pic.width }));
        const dpi = printDpi(pic.width);
        if (dpi < MIN_PRINT_DPI) toast(t('pictures.small', { name: pic.file.name, px: pic.width, dpi }));
      } catch (err) {
        toast(t('pictures.failed', { name: original.name, error: errorMessage(err) }));
      }
    }
    // \includegraphics needs graphicx (TikZ and the designs load it too).
    await editFile(main.id, (text) => (/graphicx|tikz|pgfplots|\{dizayn\}|mathpro/.test(text) ? null : preambleInsertion(text, ['\\usepackage{graphicx}'])));
    await reloadProject();
  };

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
        <label className="inline-field">
          {t('spell.label')}
          <select
            disabled={!canEdit}
            value={project.spellLanguage}
            onChange={(e) => void updateProject({ spellLanguage: e.target.value })}
            data-testid="spell-language"
          >
            {SPELL_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {t(`spell.lang.${l}`)}
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
        {canEdit && (
          <label className="inline-field auto-compile" title={t('editor.chapterOnlyHint')}>
            <input type="checkbox" checked={chapterOnly} onChange={(e) => toggleChapterOnly(e.target.checked)} data-testid="chapter-only" />
            📖 {t('editor.chapterOnly')}
          </label>
        )}
        {canEdit && (
          <label className="inline-field auto-compile" title={t('editor.autoCompileHint')}>
            <input
              type="checkbox"
              checked={autoCompile}
              onChange={(e) => toggleAutoCompile(e.target.checked)}
              data-testid="auto-compile"
            />
            {t('editor.autoCompile')}
          </label>
        )}
        {pdfUrl && (
          <a className="button download-pdf" href={api.pdfUrl(id, job!.id, true)} download data-testid="download-pdf">
            ⬇ {t('editor.downloadPdf')}
          </a>
        )}
        <a className="button" href={api.exportUrl(id, 'docx')} download data-testid="export-docx" title={t('editor.exportHint')}>
          ⬇ Word
        </a>
        <a className="button" href={api.exportUrl(id, 'epub')} download data-testid="export-epub" title={t('editor.exportHint')}>
          ⬇ EPUB
        </a>
        {pageDesignOn && (
          <button onClick={() => void exportIdml()} disabled={idmlBusy} data-testid="export-idml" title={t('idml.hint')}>
            ⬇ InDesign
          </button>
        )}
        {pageDesignOn && inDesign && onThisMac && (
          <button onClick={() => void openInInDesign()} disabled={idmlBusy} data-testid="open-in-indesign" title={t('idml.openHint', { app: inDesign })}>
            {t('idml.open')}
          </button>
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
      {spellMenu && (
        <SpellMenu
          request={spellMenu}
          client={spellClient}
          canAddWord={!!user}
          onClose={() => setSpellMenu(null)}
          onReplace={(text) => {
            if (!editor.current?.replaceRange(spellMenu.from, spellMenu.to, text, spellMenu.word)) toast(t('spell.changed'));
            setSpellMenu(null);
          }}
          onIgnore={() => {
            spellClient.ignore(spellMenu.word);
            setSpellMenu(null);
          }}
          onAddWord={() => {
            const word = spellMenu.word;
            setSpellMenu(null);
            api
              .addWord(word)
              .then(() => api.dictionary())
              .then((w) => spellClient.setUserWords(w))
              .catch((err) => toast(errorMessage(err)));
          }}
        />
      )}
      {aiFix && <AiFixDialog fix={aiFix} onAccept={() => void acceptFix(aiFix)} onClose={() => setAiFix(null)} />}
      {aiOpen && (
        <AiDialog
          projectId={id}
          lang={aiLang}
          remaining={aiStatus?.remaining ?? null}
          onInsert={(latex, preamble) => void insertSnippet(latex, preamble)}
          onUsed={refreshAi}
          onClose={() => setAiOpen(false)}
        />
      )}
      {imageOpen && (
        <ImageFormulaDialog
          lang={aiLang}
          onInsert={(latex) => {
            editor.current?.insertAtCursor(latex);
            setImageOpen(false);
          }}
          onUsed={refreshAi}
          onClose={() => setImageOpen(false)}
        />
      )}
      {draw && <DrawDialog initial={draw.edit?.drawing ?? null} onInsert={(src) => void insertDrawing(src)} onClose={() => setDraw(null)} />}
      {pageDesignOpen && project && (
        <PageDesignDialog
          projectId={id}
          canEdit={canEdit}
          onApplyStyle={applyStyle}
          onSaved={() => void reloadProject().then(() => compile())}
          onFilesChanged={() => void reloadProject()}
          pictures={files.filter((f) => /\.(png|jpe?g|pdf|eps)$/i.test(f.path)).map((f) => f.path)}
          onInsert={(code) => editor.current?.insertAtCursor(code)}
          onJump={(path, line) => {
            const file = files.find((f) => f.path === path);
            if (file) void goTo(file, { line });
          }}
          onClose={() => setPageDesignOpen(false)}
        />
      )}
      {printOpen && project && (
        <PrintDialog
          busy={printBusy}
          active={files.some((f) => f.path === 'bosma.sty')}
          onApply={(spec) => void changePrint(spec)}
          onRemove={() => void changePrint(null)}
          onClose={() => setPrintOpen(false)}
        />
      )}
      {testOpen && project && (
        <TestDialog
          files={files}
          projectName={project.name}
          busy={testBusy}
          onCreate={(req: TestRequest) => void makeTest(req)}
          onClose={() => setTestOpen(false)}
        />
      )}
      {fixText !== null && openFile && (
        <FixDialog
          text={fixText}
          path={openFile.path}
          onApply={(fixes) => {
            const ok = editor.current?.applyEdits(fixes, fixText) ?? false;
            if (ok) toast(t('fix.done', { count: fixes.length }));
            return ok;
          }}
          onClose={() => setFixText(null)}
          spell={spellClient}
        />
      )}
      {designOpen && project && (
        <DesignDialog
          projectId={id}
          currentDesignId={project.designId}
          defaultLang={(['uz-cyrl', 'ru', 'en'].includes(project.spellLanguage) ? project.spellLanguage : 'uz-latn') as DesignLanguage}
          aiEnabled={!!aiStatus?.enabled && !!user}
          aiLang={aiLang}
          onApplied={() => {
            setDesignOpen(false);
            toast(t('designs.applied'));
            void reloadProject().then(() => compile());
          }}
          onClose={() => setDesignOpen(false)}
        />
      )}
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

      <div
        className={`editor-layout${layout.treeHidden ? ' tree-hidden' : ''}`}
        data-mobile-pane={mobilePane}
        ref={layoutRef}
        style={
          {
            '--pane-cols': `${layout.treeHidden ? 0 : layout.tree}px 12px minmax(0, ${layout.code}fr) 12px minmax(0, ${Math.round((1 - layout.code) * 1000) / 1000}fr)`,
          } as React.CSSProperties
        }
      >
        <FileTree
          files={files}
          extraFolders={extraFolders}
          selectedId={openFile?.id ?? null}
          mainFile={project.mainFile}
          readOnly={!canEdit}
          onOpen={(f) => {
            setMobilePane('editor');
            void open(f);
          }}
          onNewFile={(folder) => void newFile(folder)}
          onNewFolder={(folder) => void newFolder(folder)}
          onUpload={(folder, list) => void upload(folder, list)}
          presence={presence}
          onRename={(f) => void renameFile(f)}
          onDelete={(f) => void deleteFile(f)}
          onSetMain={(f) => void updateProject({ mainFile: f.path })}
          onRenameFolder={(p) => void renameFolder(p)}
          onDeleteFolder={(p) => void deleteFolder(p)}
        />

        <div
          className="pane-resizer"
          role="separator"
          aria-orientation="vertical"
          title={t('editor.resizeHint')}
          onPointerDown={(e) => startResize(0, e)}
          onDoubleClick={() => setLayout((l) => ({ ...l, tree: DEFAULT_LAYOUT.tree }))}
          data-testid="resize-tree"
        >
          <button
            className="pane-fold"
            onClick={() => setLayout((l) => ({ ...l, treeHidden: !l.treeHidden }))}
            title={t(layout.treeHidden ? 'editor.showFiles' : 'editor.hideFiles')}
            aria-label={t(layout.treeHidden ? 'editor.showFiles' : 'editor.hideFiles')}
            data-testid="toggle-tree"
          >
            {layout.treeHidden ? '›' : '‹'}
          </button>
        </div>

        <section className="editor-pane">
          {openFile && (
            <div className="pane-title">
              <span data-testid="open-file-path">{openFile.path}</span>
              {fileSession && <PresenceList session={fileSession} />}
              <button
                className={`small tools-toggle${layout.tools ? ' active' : ''}`}
                onClick={() => setLayout((l) => ({ ...l, tools: !l.tools }))}
                aria-expanded={layout.tools}
                title={t(layout.tools ? 'editor.hideTools' : 'editor.showTools')}
                data-testid="tools-toggle"
              >
                🧰 {t('editor.tools')} {layout.tools ? '▴' : '▾'}
              </button>
              <div className={`pane-tools${layout.tools ? '' : ' collapsed'}`} data-testid="pane-tools">
              {fileSession && (
                <button
                  className="small"
                  onClick={() => void showInPdf()}
                  title={t('synctex.showInPdfHint')}
                  data-testid="show-in-pdf"
                >
                  <span className="tool-icon" aria-hidden="true">⇥</span>
                  <span className="tool-label">{t('synctex.showInPdf')}</span>
                </button>
              )}
              {canEdit && user && (
                <button className="small" onClick={() => setDesignOpen(true)} data-testid="design-button" title={t('designs.buttonHint')}>
                  <span className="tool-icon" aria-hidden="true">🎨</span>
                  <span className="tool-label">{t('designs.button')}</span>
                </button>
              )}
              {fileSession && canEdit && (
                <span className="snippet-anchor">
                  <button className="small" onClick={() => setSnippetsOpen((o) => !o)} data-testid="snippets-button" title={t('snippets.button')}>
                    <span className="tool-icon" aria-hidden="true">📐</span>
                    <span className="tool-label">{t('snippets.button')}</span>
                  </button>
                  {snippetsOpen && (
                    <SnippetMenu
                      hasDesign={!!project.designId || files.some((f) => f.path === 'dizayn.sty')}
                      onInsert={(code) => editor.current?.insertAtCursor(code)}
                      onChooseDesign={() => {
                        setSnippetsOpen(false);
                        setDesignOpen(true);
                      }}
                      onClose={() => setSnippetsOpen(false)}
                    />
                  )}
                </span>
              )}
              {canEdit && user && (
                <button
                  className="small"
                  onClick={() => void changeScript(toCyrillic ? 'cyrl' : 'latn')}
                  disabled={scriptBusy}
                  data-testid="script-button"
                  title={t('script.hint')}
                >
                  🔤 {toCyrillic ? 'Кирилл' : 'Lotin'}
                </button>
              )}
              {canEdit && user && (
                <button
                  className="small"
                  onClick={() => void changeScript(inNewLetters ? 'latn' : 'yangi')}
                  disabled={scriptBusy}
                  data-testid="letters-button"
                  title={t(inNewLetters ? 'script.fromYangiHint' : 'script.yangiHint')}
                >
                  {inNewLetters ? 'Oʻ Gʻ Sh Ch' : 'Ö Ğ Ş Ç'}
                </button>
              )}
              {pageDesignOn && canEdit && (
                <button
                  className={`small${visualMode ? ' active' : ''}`}
                  aria-pressed={visualMode}
                  onClick={() => setVisualMode((v) => !v)}
                  data-testid="visual-mode-button"
                  title={t('pageDesign.visualHint')}
                >
                  <span className="tool-icon" aria-hidden="true">👁</span>
                  <span className="tool-label">{t('pageDesign.visual')}</span>
                </button>
              )}
              {pageDesignOn && canEdit && visualMode && (
                <button
                  className={`small${baselineGrid ? ' active' : ''}`}
                  aria-pressed={baselineGrid}
                  onClick={() => setBaselineGrid((v) => !v)}
                  data-testid="baseline-grid-button"
                  title={t('pageDesign.gridHint')}
                >
                  <span className="tool-icon" aria-hidden="true">▤</span>
                  <span className="tool-label">{t('pageDesign.grid')}</span>
                </button>
              )}
              {pageDesignOn && (
                <button className="small" onClick={() => setPageDesignOpen(true)} data-testid="page-design-button" title={t('pageDesign.buttonHint')}>
                  <span className="tool-icon" aria-hidden="true">📰</span>
                  <span className="tool-label">{t('pageDesign.button')}</span>
                </button>
              )}
              {canEdit && (
                <button className="small" onClick={() => setPrintOpen(true)} data-testid="print-button" title={t('print.buttonHint')}>
                  <span className="tool-icon" aria-hidden="true">🖨</span>
                  <span className="tool-label">{t('print.button')}</span>
                </button>
              )}
              {canEdit && (
                <button className="small" onClick={() => setTestOpen(true)} data-testid="test-button" title={t('test.buttonHint')}>
                  <span className="tool-icon" aria-hidden="true">📝</span>
                  <span className="tool-label">{t('test.button')}</span>
                </button>
              )}
              {fileSession && canEdit && /\.(tex|ltx)$/i.test(openFile?.path ?? '') && (
                <button
                  className="small"
                  onClick={() => setFixText(editor.current?.text() ?? '')}
                  data-testid="fix-button"
                  title={t('fix.buttonHint')}
                >
                  <span className="tool-icon" aria-hidden="true">🩹</span>
                  <span className="tool-label">{t('fix.button')}</span>
                </button>
              )}
              {fileSession && canEdit && /\.(tex|ltx)$/i.test(openFile?.path ?? '') && (
                <button className="small" onClick={openDraw} data-testid="draw-button" title={t('draw.hint')}>
                  <span className="tool-icon" aria-hidden="true">✏️</span>
                  <span className="tool-label">{t('draw.button')}</span>
                </button>
              )}
              {fileSession && canEdit && user && aiStatus?.enabled && (
                <button className="small" onClick={() => setImageOpen(true)} data-testid="image-formula-button" title={t('imageFormula.hint')}>
                  <span className="tool-icon" aria-hidden="true">📷</span>
                  <span className="tool-label">{t('imageFormula.button')}</span>
                </button>
              )}
              {fileSession && canEdit && user && aiStatus?.enabled && (
                <button className="small" onClick={() => setAiOpen(true)} data-testid="ai-button" title={t('ai.button')}>
                  <span className="tool-icon" aria-hidden="true">✨</span>
                  <span className="tool-label">{t('ai.button')}</span>
                </button>
              )}
              {fileSession && canEdit && (
                <button className="small" onClick={() => void addComment()} data-testid="add-comment" title={t('comments.add')}>
                  <span className="tool-icon" aria-hidden="true">💬</span>
                  <span className="tool-label">{t('comments.add')}</span>
                </button>
              )}
              </div>
            </div>
          )}
          {openFile?.kind === 'text' ? (
            fileSession ? (
              <CodeEditor
                key={`${openFile.id}:${project.spellLanguage}`}
                ref={editor}
                session={fileSession}
                readOnly={!canEdit}
                comments={commentRanges}
                spell={{ client: spellClient, language: project.spellLanguage as SpellLanguage, onMenu: setSpellMenu }}
                onCommentClick={(cid) => {
                  setActiveComment(cid);
                  setSidePanel('comments');
                }}
                onCompile={() => void compile()}
                onPictures={canEdit ? (list, pos) => void insertPictures(list, pos) : undefined}
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

        <div
          className="pane-resizer"
          role="separator"
          aria-orientation="vertical"
          title={t('editor.resizeHint')}
          onPointerDown={(e) => startResize(1, e)}
          onDoubleClick={() => setLayout((l) => ({ ...l, code: DEFAULT_LAYOUT.code }))}
          data-testid="resize-split"
        />

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
              {job?.preview && (
                <div className="chapter-bar" data-testid="chapter-bar">
                  <span>
                    📖 {t('editor.chapterShown', { label: job.preview.label || t('editor.frontMatter') })}
                  </span>
                  <button className="small" onClick={() => void compile({ whole: true })} disabled={compiling} data-testid="whole-book">
                    {t('editor.wholeBook')}
                  </button>
                </div>
              )}
              {chapterOnly && job && !job.preview && TERMINAL_STATUSES.has(job.status) && (
                <div className="chapter-bar muted" data-testid="chapter-none">
                  {t('editor.chapterNone')}
                </div>
              )}
              {wrongCompiler && canEdit && (
                <div className="glyph-banner" role="alert" data-testid="compiler-hint">
                  <span>
                    {t(`compilerHint.${wrongCompiler.need}`, {
                      reason: wrongCompiler.reason,
                      compiler: COMPILER_LABELS[wrongCompiler.compiler],
                      current: project ? COMPILER_LABELS[project.compiler] : '',
                    })}
                  </span>
                  <button className="small primary" onClick={() => void switchCompiler(wrongCompiler)} disabled={compiling} data-testid="compiler-hint-switch">
                    {t('compilerHint.switch', { compiler: COMPILER_LABELS[wrongCompiler.compiler] })}
                  </button>
                  <button className="small" onClick={() => dismissHint(wrongCompiler)} title={t('compilerHint.keepHint')}>
                    {t('compilerHint.keep')}
                  </button>
                </div>
              )}
              {glyphs && !wrongCompiler && (
                <div className="glyph-banner" role="alert" data-testid="glyph-banner">
                  <span>
                    {t(glyphsMathOnly ? 'glyphs.math' : glyphs.pdflatex ? 'glyphs.pdflatex' : 'glyphs.missing', {
                      chars: glyphs.chars.slice(0, 10).join(' '),
                    })}
                  </span>
                  {canEdit && !glyphsMathOnly && (
                    <button className="small primary" onClick={() => void fixGlyphs()} disabled={compiling} data-testid="glyph-fix">
                      🩹 {t('glyphs.fix')}
                    </button>
                  )}
                </div>
              )}
              <PdfViewer
                url={pdfUrl}
                highlight={pdfHighlight}
                onSyncClick={(pg, x, y) => void syncFromPdf(pg, x, y)}
                layout={visualMode && canEdit ? pageLayout : null}
                overlay={{ onMargin: (e, mm) => void pageOverlay.onMargin(e, mm), onFrame: (f, c) => void pageOverlay.onFrame(f, c), onDrop: (a, d) => void pageOverlay.onDrop(a, d), grid: baselineGrid }}
                onTextSelect={visualMode && canEdit && pageDesignOn ? setPdfSel : undefined}
              />
              {pdfSel && visualMode && (
                <div
                  className="pd-pdf-style"
                  style={{ left: Math.max(8, Math.min(pdfSel.rect.left, window.innerWidth - 360)), top: Math.min(pdfSel.rect.bottom + 6, window.innerHeight - 60) }}
                  data-testid="pd-pdf-style"
                  onMouseUp={(e) => e.stopPropagation()}
                >
                  {charStyles.length ? (
                    <>
                      <select value={pdfStyle} onChange={(e) => setPdfStyle(e.target.value)} aria-label={t('pageDesign.pdfStyle.style')} data-testid="pd-pdf-style-select">
                        {charStyles.map((c) => (
                          <option key={c.id} value={c.id}>
                            {uiText(c.name)}
                          </option>
                        ))}
                      </select>
                      <button className="small primary" disabled={!pdfStyle} onClick={() => void applyPdfStyle(pdfSel, pdfStyle)} data-testid="pd-pdf-style-apply">
                        {t('pageDesign.apply')}
                      </button>
                    </>
                  ) : (
                    <span className="muted small-print">{t('pageDesign.pdfStyle.noStyles')}</span>
                  )}
                  <button className="small" onClick={() => setPdfSel(null)} aria-label={t('dialog.cancel')}>
                    ✕
                  </button>
                </div>
              )}
              <LogPanel
                job={job}
                logUrl={job ? api.logUrl(id, job.id) : null}
                onJump={jumpToLog}
                ai={logAi}
                onQuickFix={canEdit ? (e, f) => void quickFix(e, f) : undefined}
              />
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
      <nav className="mobile-tabs" aria-label={t('mobile.panes')}>
        {(['files', 'editor', 'pdf'] as const).map((pane) => (
          <button
            key={pane}
            className={mobilePane === pane ? 'active' : ''}
            aria-pressed={mobilePane === pane}
            onClick={() => setMobilePane(pane)}
            data-testid={`mobile-${pane}`}
          >
            {t(`mobile.${pane}`)}
          </button>
        ))}
        <button
          className="primary"
          onClick={() => {
            setMobilePane('pdf');
            setSidePanel('pdf');
            void compile();
          }}
          disabled={compiling}
          data-testid="mobile-compile"
        >
          {compiling ? '…' : '▶'}
        </button>
      </nav>
    </div>
  );
}
