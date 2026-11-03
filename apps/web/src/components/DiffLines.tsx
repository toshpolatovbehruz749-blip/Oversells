
export type DiffPart = { value: string; added?: boolean; removed?: boolean };
type Row = { kind: 'add' | 'del' | 'ctx' | 'gap'; text: string };

/** Rows of a line diff: changed lines plus a little context around them. */
export function diffRows(parts: DiffPart[]): Row[] {
  const rows: Row[] = [];
  parts.forEach((part, i) => {
    const lines = part.value.replace(/\n$/, '').split('\n');
    if (part.added || part.removed) {
      for (const text of lines) rows.push({ kind: part.added ? 'add' : 'del', text });
      return;
    }
    const first = i === 0;
    const last = i === parts.length - 1;
    if (lines.length <= 6) {
      for (const text of lines) rows.push({ kind: 'ctx', text });
    } else {
      if (!first) for (const text of lines.slice(0, 3)) rows.push({ kind: 'ctx', text });
      rows.push({ kind: 'gap', text: '⋯' });
      if (!last) for (const text of lines.slice(-3)) rows.push({ kind: 'ctx', text });
    }
  });
  return rows;
}

export function DiffLines({ parts }: { parts: DiffPart[] }) {
  return (
    <pre className="diff-lines">
      {diffRows(parts).map((l, i) => (
        <div key={i} className={`diff-line diff-${l.kind}`}>
          <span className="diff-sign">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
          {l.text || ' '}
        </div>
      ))}
    </pre>
  );
}
