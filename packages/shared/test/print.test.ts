import { describe, expect, it } from 'vitest';
import { bosmaSty, ean13Modules, ean13Tikz, isbnDigits, PRINT_FORMATS } from '../src/print.js';

describe('print settings', () => {
  it('checks ISBN-13 numbers', () => {
    expect(isbnDigits('978-0-306-40615-7')).toBe('9780306406157');
    expect(isbnDigits('978-9943-01-234-9')).toBe('9789943012349');
    expect(isbnDigits('978-9943-01-234-0')).toBeNull(); // wrong check digit
    expect(isbnDigits('0-306-40615-2')).toBeNull(); // ISBN-10
  });

  it('encodes EAN-13 like the standard', () => {
    // 4006381333931: the standard's own example.
    const bits = ean13Modules('4006381333931');
    expect(bits).toHaveLength(95);
    expect(bits.slice(0, 3)).toBe('101');
    expect(bits.slice(45, 50)).toBe('01010');
    expect(bits.slice(92)).toBe('101');
    // First digit 4 -> parity LGLLGG: second digit 0 in L, third 0 in G.
    expect(bits.slice(3, 10)).toBe('0001101');
    expect(bits.slice(10, 17)).toBe('0100111');
    // Right half: the 12th digit 3 and the check digit 1 in R code.
    expect(bits.slice(78, 85)).toBe('1000010');
    expect(bits.slice(85, 92)).toBe('1100110');
    expect(() => ean13Tikz('978-1')).toThrow();
    expect(ean13Tikz('978-9943-01-234-9')).toContain('ISBN 978-9943-01-234-9');
  });

  it('writes the package for a format, with optional marks, CMYK and barcode', () => {
    const sty = bosmaSty({ format: '70x100-16', marks: true, cmyk: true, isbn: '978-9943-01-234-9' });
    expect(sty).toContain('\\PassOptionsToPackage{paperwidth=170mm,paperheight=240mm}{geometry}');
    expect(sty).toContain('\\RequirePackage[cam,center,width=200mm,height=270mm]{crop}');
    expect(sty).toContain('\\PassOptionsToPackage{cmyk}{xcolor}');
    expect(sty).toContain('\\newcommand\\bosmabichimi{70×100 1/16}');
    expect(sty).toContain('/16*1.3,1)');
    expect(sty).toContain('\\fill (');
    const plain = bosmaSty({ format: 'a4', marks: false, cmyk: false });
    expect(plain).not.toContain('{crop}');
    expect(plain).not.toContain('cmyk');
    expect(plain).toContain('\\newcommand\\isbnshtrixkod{}');
    expect(PRINT_FORMATS.map((f) => f.id)).toContain('60x84-16');
  });
});
