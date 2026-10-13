import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileDTO } from '@oversells/shared';

interface FolderNode {
  name: string;
  path: string;
  folders: FolderNode[];
  files: FileDTO[];
}

function buildTree(files: FileDTO[], extraFolders: string[]): FolderNode {
  const root: FolderNode = { name: '', path: '', folders: [], files: [] };
  const folderAt = (path: string): FolderNode => {
    let node = root;
    if (!path) return node;
    let acc = '';
    for (const part of path.split('/')) {
      acc = acc ? `${acc}/${part}` : part;
      let next = node.folders.find((f) => f.name === part);
      if (!next) {
        next = { name: part, path: acc, folders: [], files: [] };
        node.folders.push(next);
      }
      node = next;
    }
    return node;
  };
  for (const folder of extraFolders) folderAt(folder);
  for (const file of files) {
    const slash = file.path.lastIndexOf('/');
    folderAt(slash === -1 ? '' : file.path.slice(0, slash)).files.push(file);
  }
  const sort = (n: FolderNode) => {
    n.folders.sort((a, b) => a.name.localeCompare(b.name));
    n.files.sort((a, b) => a.path.localeCompare(b.path));
    n.folders.forEach(sort);
  };
  sort(root);
  return root;
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

interface Props {
  files: FileDTO[];
  extraFolders: string[];
  selectedId: string | null;
  mainFile: string;
  /** Hides all modifying actions (viewers). */
  readOnly?: boolean;
  onOpen(file: FileDTO): void;
  onNewFile(folder: string): void;
  onNewFolder(folder: string): void;
  onUpload(folder: string, files: File[]): void;
  onRename(file: FileDTO): void;
  onDelete(file: FileDTO): void;
  onSetMain(file: FileDTO): void;
  onRenameFolder(path: string): void;
  onDeleteFolder(path: string): void;
}

/** Project file tree with folder selection and per-item actions. */
export function FileTree(props: Props) {
  const { t } = useTranslation();
  const tree = useMemo(() => buildTree(props.files, props.extraFolders), [props.files, props.extraFolders]);
  const [activeFolder, setActiveFolder] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const uploadInput = useRef<HTMLInputElement>(null);

  const toggle = (path: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderFolder = (node: FolderNode, depth: number) => (
    <ul className="tree-list" role={depth === 0 ? 'tree' : 'group'}>
      {node.folders.map((f) => (
        <li key={`d:${f.path}`} role="treeitem" aria-expanded={!collapsed.has(f.path)}>
          <div
            className={`tree-row folder ${activeFolder === f.path ? 'active' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => {
              setActiveFolder(f.path);
              toggle(f.path);
            }}
          >
            <span className="tree-icon">{collapsed.has(f.path) ? '▸' : '▾'}</span>
            <span className="tree-name">{f.name}</span>
            {!props.readOnly && <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
              <button title={t('files.rename')} aria-label={`${t('files.rename')} ${f.path}`} onClick={() => props.onRenameFolder(f.path)}>
                ✎
              </button>
              <button title={t('files.delete')} aria-label={`${t('files.delete')} ${f.path}`} onClick={() => props.onDeleteFolder(f.path)}>
                ✕
              </button>
            </span>}
          </div>
          {!collapsed.has(f.path) &&
            (f.files.length || f.folders.length ? (
              renderFolder(f, depth + 1)
            ) : (
              <div className="tree-row muted" style={{ paddingLeft: 22 + (depth + 1) * 14 }}>
                {t('files.emptyFolder')}
              </div>
            ))}
        </li>
      ))}
      {node.files.map((file) => {
        const isMain = file.path === props.mainFile;
        return (
          <li key={file.id} role="treeitem" aria-selected={props.selectedId === file.id}>
            <div
              className={`tree-row file ${props.selectedId === file.id ? 'selected' : ''}`}
              style={{ paddingLeft: 22 + depth * 14 }}
              onClick={() => {
                props.onOpen(file);
                setActiveFolder(node.path);
              }}
              data-path={file.path}
            >
              <span className="tree-name">{baseName(file.path)}</span>
              {isMain && <span className="badge">{t('files.main')}</span>}
              {!props.readOnly && <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
                {!isMain && file.path.endsWith('.tex') && (
                  <button title={t('files.setMain')} aria-label={`${t('files.setMain')} ${file.path}`} onClick={() => props.onSetMain(file)}>
                    ★
                  </button>
                )}
                <button title={t('files.rename')} aria-label={`${t('files.rename')} ${file.path}`} onClick={() => props.onRename(file)}>
                  ✎
                </button>
                <button title={t('files.delete')} aria-label={`${t('files.delete')} ${file.path}`} onClick={() => props.onDelete(file)}>
                  ✕
                </button>
              </span>}
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <nav className="file-tree" aria-label={t('files.title')}>
      <div className="file-tree-toolbar">
        <strong onClick={() => setActiveFolder('')} className="tree-root" title="/">
          {t('files.title')}
          {activeFolder && <span className="muted"> / {activeFolder}</span>}
        </strong>
        {!props.readOnly && <div className="toolbar-buttons">
          <button onClick={() => props.onNewFile(activeFolder)}>{t('files.newFile')}</button>
          <button onClick={() => props.onNewFolder(activeFolder)}>{t('files.newFolder')}</button>
          <button onClick={() => uploadInput.current?.click()}>{t('files.upload')}</button>
        </div>}
        <input
          ref={uploadInput}
          type="file"
          multiple
          hidden
          data-testid="upload-input"
          accept=".tex,.ltx,.bib,.bst,.bbx,.cbx,.lbx,.cls,.sty,.clo,.cfg,.def,.dtx,.ins,.ist,.tikz,.txt,.md,.csv,.tsv,.dat,.png,.jpg,.jpeg,.pdf,.eps,.ttf,.otf"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) props.onUpload(activeFolder, files);
          }}
        />
      </div>
      <div className="tree-scroll">{renderFolder(tree, 0)}</div>
    </nav>
  );
}
