import { describe, expect, it } from 'vitest';
import { DOCX_STYLES_SCRIPT, generatePageDesignPackage, pageDesignFromWordStyles } from '../src/index.js';

describe('Word styles import', () => {
  it('turns the styles the filter listed into paragraph and character styles', () => {
    const spec = pageDesignFromWordStyles('p\tiqtibos\tIqtibos\nc\tatama\tAtama\nx\tbad\tNo\np\t1bad\tNo\np\tiqtibos\tDuplicate\n', 'Kitob');
    expect(spec.paragraphStyles.map((s) => s.id)).toContain('iqtibos');
    expect(spec.paragraphStyles.filter((s) => s.id === 'iqtibos')).toHaveLength(1);
    expect(spec.characterStyles.find((s) => s.id === 'atama')?.name).toBe('Atama');
    expect(spec.paragraphStyles.some((s) => s.id === 'bad' || s.id === '1bad')).toBe(false);
    const sty = generatePageDesignPackage(spec);
    expect(sty).toContain('iqtibos');
    expect(sty).toContain('atama');
  });

  it('writes its helper files without letting the shell read them', () => {
    // Every line written by printf is one single-quoted argument.
    expect(DOCX_STYLES_SCRIPT).toContain("--lua-filter=/tmp/styles.lua");
    expect(DOCX_STYLES_SCRIPT).not.toMatch(/<<\s*'?EOF/);
  });
});
