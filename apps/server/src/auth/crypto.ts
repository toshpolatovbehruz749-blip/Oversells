import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/** @node-rs/argon2's Algorithm.Argon2id (a const enum, which isolated modules cannot import). */
const ARGON2ID = 2;
import { badRequest } from '../errors.js';

/** Random URL-safe token (default 32 bytes = 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

export function validatePassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest('weak_password', `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) throw badRequest('weak_password', 'Password is too long');
  return password;
}

/** argon2id with the OWASP-recommended baseline (19 MiB, t=2, p=1). */
export function hashPassword(password: string): Promise<string> {
  return hash(password, { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
}

/** Marker for accounts that cannot log in with a password. */
export const NO_PASSWORD = '!';

let dummyHash: Promise<string> | null = null;

/** Verifies a password; spends the same time when there is no usable hash. */
export async function verifyPassword(passwordHash: string | null, password: string): Promise<boolean> {
  if (!passwordHash || passwordHash === NO_PASSWORD) {
    dummyHash ??= hashPassword('timing-equaliser-password');
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

const EMAIL_RE = /^[^\s@"<>()[\]\\,;:]+@[^\s@"<>()[\]\\,;:]+\.[^\s@"<>()[\]\\,;:]+$/;

export function normalizeEmail(email: unknown): string {
  if (typeof email !== 'string') throw badRequest('invalid_email', 'E-mail is required');
  const normalized = email.normalize('NFC').trim().toLowerCase();
  if (normalized.length > 254 || !EMAIL_RE.test(normalized)) {
    throw badRequest('invalid_email', 'E-mail address is not valid');
  }
  return normalized;
}
