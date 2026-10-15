import { describe, expect, it } from 'vitest';
import { pictureName, pictureSnippet, printDpi } from './prepare';

describe('pictures', () => {
  it('gives LaTeX-friendly file names that are not taken', () => {
    const taken = new Set(['rasm.png', 'rasm-2.png']);
    expect(pictureName('image.png', 'png', (n) => taken.has(n))).toBe('rasm-3.png');
    expect(pictureName('Uchburchak chizma (1).PNG', 'png', () => false)).toBe('uchburchak-chizma-1.png');
    expect(pictureName('Oʻzbekiston xaritasi.jpeg', 'jpg', () => false)).toBe('ozbekiston-xaritasi.jpg');
    expect(pictureName('Фото.webp', 'png', () => false)).toBe('rasm.png');
  });

  it('estimates the print resolution and writes the LaTeX', () => {
    expect(printDpi(3000)).toBe(595);
    expect(printDpi(500)).toBe(99);
    expect(pictureSnippet('rasmlar/a.png')).toBe('\\begin{center}\n  \\includegraphics[width=0.8\\linewidth]{rasmlar/a.png}\n\\end{center}\n');
  });
});
