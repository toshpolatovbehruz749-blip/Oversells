import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { babelForScript, transliterateLatex } from '@oversells/shared';

const dir = path.resolve(__dirname, '../../templates');

/** Every picture a template names, after a change of script, must still be a file of the template. */
describe('templates in Cyrillic and in the new letters', () => {
  for (const name of readdirSync(dir)) {
    const main = path.join(dir, name, 'main.tex');
    if (!existsSync(main)) continue;
    for (const to of ['cyrl', 'yangi'] as const) {
      it(`${name} → ${to}: file names stay`, () => {
        const source = readFileSync(main, 'utf8');
        const tex = babelForScript(transliterateLatex(source, to), to);
        const files = [...source.matchAll(/[\p{L}\p{N}_./-]+\.(?:png|jpe?g|pdf)(?![\p{L}\p{N}])/gu)].map((m) => m[0]);
        for (const f of files) {
          expect(existsSync(path.join(dir, name, f)), `${name}: ${f}`).toBe(true);
          expect(tex, `${name}: ${f} after the change`).toContain(f);
        }
      });
    }
  }
});
