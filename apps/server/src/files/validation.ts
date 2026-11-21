import { checkProjectPath, type PathErrorCode } from '@oversells/shared';
import { badRequest } from '../errors.js';

const MESSAGES: { [K in PathErrorCode]: string } = {
  empty: 'Path is empty',
  too_long: 'Path is too long',
  too_deep: 'Path is nested too deeply',
  absolute: 'Absolute paths are not allowed',
  backslash: 'Use "/" as the path separator',
  control_char: 'Path contains control characters',
  traversal: 'Path must not contain "." or ".." segments',
  empty_segment: 'Path contains an empty segment',
  invalid_segment: 'Names may only contain letters A-Z, digits, ".", "_" and "-"',
  reserved: 'This file name is reserved',
  extension: 'This file type is not allowed',
};

/** Validates a project file path; throws a 400 AppError (code `invalid_path:<reason>`). */
export function requireFilePath(input: unknown): string {
  const res = checkProjectPath(input);
  if (!res.ok) throw badRequest(`invalid_path:${res.code}`, MESSAGES[res.code]);
  return res.path;
}

/** Validates a folder path (no extension requirement). */
export function requireFolderPath(input: unknown): string {
  const res = checkProjectPath(input, false);
  if (!res.ok) throw badRequest(`invalid_path:${res.code}`, MESSAGES[res.code]);
  return res.path;
}

/** Decodes UTF-8 strictly, stripping a BOM. Returns null if the bytes are not valid UTF-8. */
export function decodeUtf8(data: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(data);
  } catch {
    return null;
  }
}
