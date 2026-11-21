/** An answer in AI_PAGE_DESIGN_SCHEMA, as the model gives it (with a few things to clean up). */
export const AI_PAGE_DESIGN_ANSWER = {
  name: 'Iliq bolalar kitobi',
  notes: 'Katta shrift va keng hoshiyalar kichik oʻquvchilar uchun.',
  title: 'Quyoshcha',
  paragraphStyles: [
    { id: 'Asosiy matn', name: 'Asosiy matn', heading: null, size: 14, leading: 20, align: 'left', italic: false, bold: false, color: null, indent: 0, leftIndent: null, spaceBefore: null, spaceAfter: 6, dropCap: 3 },
    { id: 'sarlavha', name: 'Sarlavha', heading: 1, size: 28, leading: null, align: 'center', italic: false, bold: true, color: '#c0392b', indent: null, leftIndent: null, spaceBefore: 0, spaceAfter: 18, dropCap: 4 },
    { id: 'sarlavha', name: 'Kichik sarlavha', heading: 2, size: 500, leading: null, align: 'nonsense', italic: false, bold: true, color: 'red', indent: null, leftIndent: null, spaceBefore: null, spaceAfter: null, dropCap: null },
  ],
  characterStyles: [{ id: '1urgu', name: 'Urgʻu', italic: true, bold: false, smallCaps: false, color: '2E86C1' }],
  margins: { inner: 20, outer: 18, top: 2, bottom: 22 },
  runningHeads: 'titleAndChapter',
  chapterOpensRight: true,
  chapterHeadOrnament: 'fleuron',
  chapterEndOrnament: 'none',
  microtype: true,
};
