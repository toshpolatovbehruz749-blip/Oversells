import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TEST_SPACES, type FileDTO, type TestSpace } from '@oversells/shared';

export interface TestRequest {
  bank: string;
  title: string;
  variants: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  answerSheet: boolean;
  answerKey: boolean;
  /** Empty space for the working after each question. */
  space: TestSpace;
  /** Link for a QR code on the answer sheet (empty: none). */
  qrUrl: string;
}

interface Props {
  files: FileDTO[];
  projectName: string;
  busy: boolean;
  onCreate(req: TestRequest): void;
  onClose(): void;
}

/** "Test": variants, answer sheet and key from a question bank (\begin{savol} ... \end{savol}). */
export function TestDialog({ files, projectName, busy, onCreate, onClose }: Props) {
  const { t } = useTranslation();
  const banks = files.filter((f) => f.kind === 'text' && /\.tex$/i.test(f.path) && f.path !== 'test.tex');
  const [req, setReq] = useState<TestRequest>({
    bank: banks.find((f) => /savol/i.test(f.path))?.path ?? banks[0]?.path ?? '',
    title: projectName,
    variants: 4,
    shuffleQuestions: true,
    shuffleOptions: true,
    answerSheet: true,
    answerKey: true,
    space: 'none',
    qrUrl: '',
  });
  const set = <K extends keyof TestRequest>(k: K, v: TestRequest[K]) => setReq((r) => ({ ...r, [k]: v }));
  const check = (k: 'shuffleQuestions' | 'shuffleOptions' | 'answerSheet' | 'answerKey') => (
    <label className="check-row">
      <input type="checkbox" checked={req[k]} onChange={(e) => set(k, e.target.checked)} data-testid={`test-${k}`} />
      {t(`test.${k}`)}
    </label>
  );

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal test-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="test-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        data-testid="test-dialog"
      >
        <h2 id="test-title">{t('test.title')}</h2>
        <p className="muted">{t('test.intro')}</p>
        <label className="field">
          {t('test.bank')}
          <select value={req.bank} onChange={(e) => set('bank', e.target.value)} data-testid="test-bank">
            {banks.map((f) => (
              <option key={f.id} value={f.path}>
                {f.path}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t('test.name')}
          <input value={req.title} onChange={(e) => set('title', e.target.value)} maxLength={200} data-testid="test-name" />
        </label>
        <label className="field">
          {t('test.variants')}
          <select value={req.variants} onChange={(e) => set('variants', Number(e.target.value))} data-testid="test-variants">
            {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n} ({'ABCDEFGHIJ'.slice(0, n).split('').join(', ')})
              </option>
            ))}
          </select>
        </label>
        {check('shuffleQuestions')}
        {check('shuffleOptions')}
        {check('answerSheet')}
        {check('answerKey')}
        <label className="field">
          {t('test.space')}
          <select value={req.space} onChange={(e) => set('space', e.target.value as TestSpace)} data-testid="test-space">
            {TEST_SPACES.map((sp) => (
              <option key={sp} value={sp}>
                {t(`test.spaces.${sp}`)}
              </option>
            ))}
          </select>
        </label>
        {req.answerSheet && (
          <label className="field">
            {t('test.qr')}
            <input
              value={req.qrUrl}
              onChange={(e) => set('qrUrl', e.target.value)}
              placeholder="https://t.me/kanal/12"
              maxLength={500}
              data-testid="test-qr"
            />
          </label>
        )}
        <pre className="test-example">{String.raw`\begin{savol}
  $2+3\cdot 4$ ni hisoblang.
  \togri{$14$}
  \variant{$20$}
  \variant{$24$}
\end{savol}`}</pre>
        <div className="modal-actions">
          <button onClick={onClose}>{t('dialog.cancel')}</button>
          <button className="primary" disabled={busy || !req.bank || (req.qrUrl.trim() !== '' && !/^(https?:\/\/|tg:\/\/)\S+$/.test(req.qrUrl.trim()))} onClick={() => onCreate({ ...req, qrUrl: req.qrUrl.trim() })} data-testid="test-create">
            {busy ? t('test.creating') : t('test.create')}
          </button>
        </div>
      </div>
    </div>
  );
}
