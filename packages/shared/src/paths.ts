/**
 * Project file path rules, shared by the server (authoritative) and the web
 * client (early feedback).
 *
 * A project path is a relative, forward-slash separated path such as
 * `chapters/ch1.tex`. Segments are restricted to a TeX-friendly ASCII subset;
 * dot-files are rejected (this also blocks `.latexmkrc`).
 */
import type { FileKind } from './types.js';

export const MAX_PATH_LENGTH = 255;
export const MAX_SEGMENT_LENGTH = 100;
export const MAX_PATH_DEPTH = 8;

const SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/** Files that would change how the compiler behaves; never allowed. */
const RESERVED_NAMES = new Set(['latexmkrc', '.latexmkrc', 'texmf.cnf']);

export const TEXT_EXTENSIONS = [
  'tex', 'ltx', 'bib', 'bst', 'bbx', 'cbx', 'lbx', 'cls', 'sty', 'clo', 'cfg', 'def',
  'dtx', 'ins', 'ist', 'tikz', 'txt', 'md', 'csv', 'tsv', 'dat',
] as const;

export const BINARY_EXTENSIONS = ['png', 'jpg', 'jpeg', 'pdf', 'eps', 'ttf', 'otf'] as const;

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  pdf: 'application/pdf',
  eps: 'application/postscript',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

export type PathErrorCode =
  | 'empty'
  | 'too_long'
  | 'too_deep'
  | 'absolute'
  | 'backslash'
  | 'control_char'
  | 'traversal'
  | 'empty_segment'
  | 'invalid_segment'
  | 'reserved'
  | 'extension';

export type PathCheck = { ok: true; path: string } | { ok: false; code: PathErrorCode };

/** Lower-case extension without the dot, or '' if none. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function fileKindOf(path: string): FileKind | null {
  const ext = extensionOf(path);
  if ((TEXT_EXTENSIONS as readonly string[]).includes(ext)) return 'text';
  if ((BINARY_EXTENSIONS as readonly string[]).includes(ext)) return 'binary';
  return null;
}

export function mimeTypeOf(path: string): string {
  return MIME_TYPES[extensionOf(path)] ?? 'text/plain; charset=utf-8';
}

/**
 * Validates a project-relative path. Never normalises `..` away: anything that
 * looks like traversal is rejected outright.
 *
 * @param requireAllowedExtension reject files whose type is not whitelisted
 *   (set to false when validating folder paths).
 */
export function checkProjectPath(input: unknown, requireAllowedExtension = true): PathCheck {
  if (typeof input !== 'string' || input.length === 0) return { ok: false, code: 'empty' };
  const path = input.normalize('NFC');
  if (path.length > MAX_PATH_LENGTH) return { ok: false, code: 'too_long' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return { ok: false, code: 'control_char' };
  if (path.includes('\\')) return { ok: false, code: 'backslash' };
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return { ok: false, code: 'absolute' };

  const segments = path.split('/');
  if (segments.length > MAX_PATH_DEPTH) return { ok: false, code: 'too_deep' };
  for (const segment of segments) {
    if (segment === '') return { ok: false, code: 'empty_segment' };
    if (segment === '.' || segment === '..') return { ok: false, code: 'traversal' };
    if (RESERVED_NAMES.has(segment.toLowerCase())) return { ok: false, code: 'reserved' };
    if (segment.length > MAX_SEGMENT_LENGTH || !SEGMENT_RE.test(segment)) {
      return { ok: false, code: 'invalid_segment' };
    }
  }
  if (requireAllowedExtension && fileKindOf(path) === null) return { ok: false, code: 'extension' };
  return { ok: true, path };
}

export function isValidProjectPath(input: unknown): input is string {
  return checkProjectPath(input).ok;
}

// Uzbek and Russian Cyrillic -> TeX friendly ASCII.
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '',
  э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};

function transliterate(input: string): string {
  let out = '';
  for (const ch of input) {
    const lower = ch.toLowerCase();
    const mapped = CYRILLIC_TO_LATIN[lower];
    if (mapped === undefined) {
      out += ch;
    } else if (ch !== lower && mapped.length > 0) {
      out += mapped[0]!.toUpperCase() + mapped.slice(1);
    } else {
      out += mapped;
    }
  }
  return out;
}

/**
 * Turns an arbitrary user supplied file name (e.g. from an upload) into a safe
 * single path segment: strips directories, transliterates Cyrillic, removes
 * diacritics and unsupported characters, and lower-cases the extension.
 */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? '';
  let name = transliterate(base.normalize('NFC'))
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritics
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .replace(/_+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+/, '');

  const dot = name.lastIndexOf('.');
  let stem = dot > 0 ? name.slice(0, dot) : name;
  let ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  stem = stem.replace(/[._-]+$/, '');
  if (stem === '') stem = 'file';
  const maxStem = MAX_SEGMENT_LENGTH - (ext ? ext.length + 1 : 0);
  stem = stem.slice(0, Math.max(1, maxStem));
  name = ext ? `${stem}.${ext}` : stem;
  if (RESERVED_NAMES.has(name.toLowerCase())) name = `file_${name}`;
  return name;
}

/** Joins a folder path (may be '') and a file name. */
export function joinProjectPath(folder: string, name: string): string {
  const trimmed = folder.replace(/^\/+|\/+$/g, '');
  return trimmed ? `${trimmed}/${name}` : name;
}
