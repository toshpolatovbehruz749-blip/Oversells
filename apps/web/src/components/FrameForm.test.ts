import { describe, expect, it } from 'vitest';
import { frameCode, textBoxCode } from './FrameForm';

const base = {
  file: 'rasmlar/tog.png',
  mode: 'oqim' as const,
  width: '',
  side: 'ong' as const,
  x: '20',
  y: '30',
  bleed: '3',
  crop: ['', '', '', ''] as [string, string, string, string],
  caption: '',
};

describe('frame code', () => {
  it('writes only the keys of the chosen mode, on a line of its own', () => {
    expect(frameCode(base)).toBe('\n\\rasmramka[joy=oqim]{rasmlar/tog.png}{}\n');
    expect(frameCode({ ...base, mode: 'oralash', width: '45', side: 'chap', caption: 'Togʻ' })).toBe(
      '\n\\rasmramka[joy=oralash,en=45mm,tomon=chap]{rasmlar/tog.png}{Togʻ}\n',
    );
    expect(frameCode({ ...base, mode: 'sahifa', width: '40' })).toBe('\n\\rasmramka[joy=sahifa,en=40mm,x=20mm,y=30mm]{rasmlar/tog.png}{}\n');
    expect(frameCode({ ...base, mode: 'tola', width: '99', bleed: '5', caption: 'yoʻq' })).toBe('\n\\rasmramka[joy=tola,bleed=5mm]{rasmlar/tog.png}{}\n');
  });

  it('crops by the four edges and escapes the caption', () => {
    expect(frameCode({ ...base, crop: ['10', '', '10', '0'], caption: '50% & {x}' })).toBe(
      '\n\\rasmramka[joy=oqim,kesish=10mm 0mm 10mm 0mm]{rasmlar/tog.png}{50\\% \\& \\{x\\}}\n',
    );
  });
});

describe('page backgrounds and text boxes', () => {
  it('a background takes only the bleed', () => {
    expect(frameCode({ ...base, mode: 'fon', width: '50', bleed: '3', caption: 'yoʻq' })).toBe('\n\\rasmramka[joy=fon,bleed=3mm]{rasmlar/tog.png}{}\n');
  });

  it('a text box with its fill and transparency', () => {
    expect(textBoxCode({ x: '20', y: '140', width: '160', fill: '#fff6e0', transparency: '0.1' })).toBe(
      '\n\\begin{matnquti}[x=20mm,y=140mm,en=160mm,fon=FFF6E0,shaffof=0.1]\nMatn\n\\end{matnquti}\n',
    );
    expect(textBoxCode({ x: '', y: '', width: '', fill: 'red', transparency: '' })).toBe(
      '\n\\begin{matnquti}[x=20mm,y=20mm,en=80mm]\nMatn\n\\end{matnquti}\n',
    );
  });
});
