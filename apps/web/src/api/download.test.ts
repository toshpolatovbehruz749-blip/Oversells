import { describe, expect, it } from 'vitest';
import { fileNameFromDisposition } from './download';

describe('file name of a download', () => {
  it('prefers the UTF-8 name (Uzbek letters), then the plain one', () => {
    expect(fileNameFromDisposition(`attachment; filename="O_quv.pdf"; filename*=UTF-8''O%CA%BBquv%20qo%CA%BBllanma.pdf`, 'x.pdf')).toBe('Oʻquv qoʻllanma.pdf');
    expect(fileNameFromDisposition('attachment; filename="Kitob.zip"', 'x.zip')).toBe('Kitob.zip');
    expect(fileNameFromDisposition('attachment; filename=Kitob.epub', 'x.epub')).toBe('Kitob.epub');
    expect(fileNameFromDisposition(null, 'Loyiha.docx')).toBe('Loyiha.docx');
    expect(fileNameFromDisposition(`attachment; filename*=UTF-8''%E0%A4%A`, 'x.pdf')).toBe('x.pdf');
  });
});
