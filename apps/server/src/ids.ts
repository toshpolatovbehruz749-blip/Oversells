import { randomBytes } from 'node:crypto';

/** URL-safe random identifier (lower-case, 24 chars, ~120 bits). */
export function newId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(24);
  let id = 'f';
  for (let i = 1; i < 24; i++) id += alphabet[bytes[i]! % alphabet.length];
  return id;
}
