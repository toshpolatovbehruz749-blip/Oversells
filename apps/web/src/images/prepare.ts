/**
 * Pictures dropped or pasted into the editor, prepared for LaTeX:
 * - formats LaTeX cannot include (WebP, GIF, BMP, ...) become PNG;
 * - photos larger than MAX_SIDE pixels are scaled down (a phone photo of
 *   4000 px and 5 MB still prints at 300 dpi over 25 cm with 3000 px, and the
 *   book compiles faster);
 * - small pictures are reported with the dpi they would print at.
 */

export const MAX_SIDE = 3000;
/** Width of an inserted picture: 0.8\linewidth of an A4 text block (about 16 cm), in cm. */
export const INSERT_WIDTH_CM = 12.8;
/** Below this the print looks soft. */
export const MIN_PRINT_DPI = 150;

const LATEX_TYPES = new Set(['image/png', 'image/jpeg']);

export interface PreparedImage {
  file: File;
  width: number;
  height: number;
  /** The original size when it was scaled down. */
  scaledFrom?: { width: number; height: number };
  converted: boolean;
}

export function isPicture(file: File): boolean {
  return file.type.startsWith('image/') && file.type !== 'image/svg+xml';
}

/** The dpi a picture prints at when it is `cm` wide. */
export function printDpi(widthPx: number, cm = INSERT_WIDTH_CM): number {
  return Math.round(widthPx / (cm / 2.54));
}

/** A file name LaTeX is happy with: latin letters, digits, - and _, not taken yet. */
export function pictureName(original: string, ext: string, taken: (name: string) => boolean): string {
  const base =
    original
      .replace(/\.[^.]+$/, '')
      .normalize('NFKD')
      .replace(/[^\x00-\x7f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'rasm';
  // Pasted screenshots are all called image.png.
  const stem = base === 'image' ? 'rasm' : base;
  for (let n = 1; ; n++) {
    const name = `${stem}${n === 1 ? '' : `-${n}`}.${ext}`;
    if (!taken(name)) return name;
  }
}

/** Decodes, converts and scales a picture as described above. */
export async function preparePicture(file: File, taken: (name: string) => boolean, keepName = false): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const convert = !LATEX_TYPES.has(file.type);
  const ext = file.type === 'image/jpeg' ? 'jpg' : 'png';
  // Uploads keep the name the user gave, unless the format changes.
  const name = keepName && !convert ? file.name : pictureName(file.name, ext, taken);
  if (scale === 1 && !convert) {
    bitmap.close();
    return { file: name === file.name ? file : new File([file], name, { type: file.type }), width, height, converted: false };
  }
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const type = ext === 'jpg' ? 'image/jpeg' : 'image/png';
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Cannot encode the picture'))), type, 0.9),
  );
  return {
    file: new File([blob], name, { type }),
    width: w,
    height: h,
    ...(scale < 1 ? { scaledFrom: { width, height } } : {}),
    converted: convert,
  };
}

/** The LaTeX inserted for a picture at `path` (relative to the main file). */
export function pictureSnippet(path: string): string {
  return `\\begin{center}\n  \\includegraphics[width=0.8\\linewidth]{${path}}\n\\end{center}\n`;
}
