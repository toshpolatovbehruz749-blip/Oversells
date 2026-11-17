import { ApiError } from './client';

/**
 * Downloads a file of ours by fetching it first, so the page can say that it is
 * being prepared (Word and EPUB take a while), show a readable error when the
 * server refuses, and say where it went (an app window shows no download bar).
 */

/** The file name of a Content-Disposition header (RFC 6266: filename* wins over filename). */
export function fileNameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[2]!.trim().replace(/^"|"$/g, ''));
    } catch {
      // a broken encoding: try the plain name
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  const name = (plain?.[2] ?? plain?.[1] ?? '').trim();
  return name || fallback;
}

/** Fetches `url` and saves it; returns the file name. Throws ApiError with the server's code. */
export async function downloadFile(url: string, fallbackName: string): Promise<string> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(res.status, body?.error?.code ?? 'internal', body?.error?.message ?? res.statusText);
  }
  const name = fileNameFromDisposition(res.headers.get('content-disposition'), fallbackName);
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // The browser has taken the file by then; keep the memory a minute for slow saves.
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
  return name;
}
