import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  Align,
  CharacterStyle,
  HeaderLine,
  MasterPage,
  PageDesignSpec,
  PageNumbering,
  ParagraphStyle,
  Slot,
  SlotKind,
} from '@oversells/shared';
import { api, ApiError } from '../api/client';
import { errorMessage, uiText } from '../i18n';
import { FrameForm } from './FrameForm';
import { PreflightPanel } from './PreflightPanel';

type Tab = 'styles' | 'masters' | 'book' | 'frames' | 'preflight';
type Selected = { kind: 'paragraph' | 'character'; id: string } | null;

interface Props {
  projectId: string;
  canEdit: boolean;
  /** Puts the selection of the code editor into a style; returns an error key or null. */
  onApplyStyle(kind: 'paragraph' | 'character', id: string): string | null;
  /** After a save: compile again. */
  onSaved(): void;
  /** Pictures of the project, for frames. */
  pictures: string[];
  /** Puts code at the cursor of the code editor. */
  onInsert(code: string): void;
  /** Opens a project file at a line. */
  onJump(path: string, line: number): void;
  onClose(): void;
}

const SLOT_KINDS: SlotKind[] = ['empty', 'page', 'chapter', 'section', 'title', 'text'];
const ALIGNS: Align[] = ['justify', 'left', 'center', 'right'];
const NUMBERINGS: (PageNumbering | '')[] = ['', 'arabic', 'roman', 'Roman'];
const EMPTY_LINE: HeaderLine = { left: { kind: 'empty' }, center: { kind: 'empty' }, right: { kind: 'empty' } };

/** A free id for a new style or master: base, base2, base3... */
function freeId(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base}${i}`)) return `${base}${i}`;
}

/** Number field that keeps "empty" as undefined. */
function NumberField(props: {
  label: string;
  value: number | undefined;
  step?: number;
  onChange(v: number | undefined): void;
  testid?: string;
}) {
  return (
    <label className="field">
      {props.label}
      <input
        type="number"
        step={props.step ?? 0.5}
        value={props.value ?? ''}
        onChange={(e) => props.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        data-testid={props.testid}
      />
    </label>
  );
}

function Check(props: { label: string; value: boolean | undefined; onChange(v: boolean): void; testid?: string }) {
  return (
    <label className="check-row">
      <input type="checkbox" checked={!!props.value} onChange={(e) => props.onChange(e.target.checked)} data-testid={props.testid} />
      {props.label}
    </label>
  );
}

function ColorField(props: { label: string; value: string | undefined; onChange(v: string | undefined): void }) {
  const { t } = useTranslation();
  return (
    <label className="field">
      {props.label}
      <span className="pd-color">
        <input type="color" value={`#${props.value ?? '000000'}`} onChange={(e) => props.onChange(e.target.value.slice(1).toUpperCase())} />
        {props.value && (
          <button type="button" className="small" onClick={() => props.onChange(undefined)}>
            {t('pageDesign.clear')}
          </button>
        )}
      </span>
    </label>
  );
}

/**
 * «Sahifa dizayni» (behind the PAGE_DESIGN_ENABLED flag): paragraph and
 * character styles, master pages and book-wide page rules, saved as sahifa.sty.
 */
export function PageDesignDialog({ projectId, canEdit, onApplyStyle, onSaved, pictures, onInsert, onJump, onClose }: Props) {
  const { t } = useTranslation();
  const [design, setDesign] = useState<PageDesignSpec | null>(null);
  const [readable, setReadable] = useState(true);
  const [replace, setReplace] = useState(false);
  const [tab, setTab] = useState<Tab>('styles');
  const [selected, setSelected] = useState<Selected>(null);
  const [masterId, setMasterId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getPageDesign(projectId).then(
      (r) => {
        setDesign(r.design);
        setReadable(r.readable);
        setSelected(r.design.paragraphStyles[0] ? { kind: 'paragraph', id: r.design.paragraphStyles[0].id } : null);
        setMasterId(r.design.masters[0]?.id ?? null);
      },
      (err) => setError(errorMessage(err)),
    );
  }, [projectId]);

  if (!design) {
    return (
      <div className="modal page-design-dialog" role="dialog" aria-modal="false" data-testid="page-design-dialog">
        <p>{error ?? t('pageDesign.loading')}</p>
        <div className="modal-actions">
          <button onClick={onClose}>{t('dialog.cancel')}</button>
        </div>
      </div>
    );
  }

  const update = (change: (d: PageDesignSpec) => PageDesignSpec) => setDesign((d) => (d ? change(d) : d));
  const para = selected?.kind === 'paragraph' ? design.paragraphStyles.find((s) => s.id === selected.id) : undefined;
  const char = selected?.kind === 'character' ? design.characterStyles.find((s) => s.id === selected.id) : undefined;
  const master = design.masters.find((m) => m.id === masterId);

  const setPara = (patch: Partial<ParagraphStyle>) =>
    update((d) => ({ ...d, paragraphStyles: d.paragraphStyles.map((s) => (s.id === para?.id ? { ...s, ...patch } : s)) }));
  const setChar = (patch: Partial<CharacterStyle>) =>
    update((d) => ({ ...d, characterStyles: d.characterStyles.map((s) => (s.id === char?.id ? { ...s, ...patch } : s)) }));
  const setMaster = (patch: Partial<MasterPage>) =>
    update((d) => ({ ...d, masters: d.masters.map((m) => (m.id === master?.id ? { ...m, ...patch } : m)) }));

  const addStyle = (kind: 'paragraph' | 'character') => {
    const taken = [...design.paragraphStyles, ...design.characterStyles].map((s) => s.id);
    const id = freeId(kind === 'paragraph' ? 'uslub' : 'belgi', taken);
    const name = t(kind === 'paragraph' ? 'pageDesign.newParagraph' : 'pageDesign.newCharacter');
    if (kind === 'paragraph') update((d) => ({ ...d, paragraphStyles: [...d.paragraphStyles, { id, name }] }));
    else update((d) => ({ ...d, characterStyles: [...d.characterStyles, { id, name }] }));
    setSelected({ kind, id });
  };
  const removeSelected = () => {
    if (!selected) return;
    update((d) =>
      selected.kind === 'paragraph'
        ? {
            ...d,
            paragraphStyles: d.paragraphStyles
              .filter((s) => s.id !== selected.id)
              .map((s) => (s.basedOn === selected.id ? { ...s, basedOn: undefined } : s)),
          }
        : { ...d, characterStyles: d.characterStyles.filter((s) => s.id !== selected.id) },
    );
    setSelected(null);
  };
  const addMaster = () => {
    const id = freeId(
      'usta',
      design.masters.map((m) => m.id),
    );
    const side = { head: EMPTY_LINE, foot: { ...EMPTY_LINE, center: { kind: 'page' as const } } };
    update((d) => ({
      ...d,
      masters: [...d.masters, { id, name: t('pageDesign.newMaster'), odd: side, even: side, headRule: false, numbering: null }],
    }));
    setMasterId(id);
  };
  const removeMaster = () => {
    if (!master || design.masters.length < 2) return;
    update((d) => {
      const masters = d.masters.filter((m) => m.id !== master.id);
      return {
        ...d,
        masters,
        defaultMaster: d.defaultMaster === master.id ? masters[0]!.id : d.defaultMaster,
        chapterMaster: d.chapterMaster === master.id ? null : d.chapterMaster,
      };
    });
    setMasterId(design.masters.find((m) => m.id !== master.id)?.id ?? null);
  };

  const apply = (kind: 'paragraph' | 'character', id: string) => {
    const problem = onApplyStyle(kind, id);
    setNotice(problem ? t(`pageDesign.applyError.${problem}`) : t('pageDesign.applied'));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.savePageDesign(projectId, design, !readable && replace);
      setDesign(r.design);
      setReadable(true);
      setNotice(t('pageDesign.saved'));
      onSaved();
    } catch (err) {
      // The server says which field is wrong (in English); keep it next to the translated message.
      setError(err instanceof ApiError && err.code === 'invalid_page_design' ? `${errorMessage(err)}: ${err.message}` : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const slotEditor = (line: HeaderLine, onChange: (l: HeaderLine) => void, where: string) => (
    <div className="pd-slots">
      {(['left', 'center', 'right'] as const).map((pos) => {
        const s: Slot = line[pos];
        return (
          <span key={pos} className="pd-slot">
            <select
              aria-label={`${where} ${t(`pageDesign.pos.${pos}`)}`}
              value={s.kind}
              onChange={(e) =>
                onChange({ ...line, [pos]: { kind: e.target.value as SlotKind, ...(e.target.value === 'text' ? { text: '' } : {}) } })
              }
              data-testid={`pd-slot-${where}-${pos}`}
            >
              {SLOT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`pageDesign.slot.${k}`)}
                </option>
              ))}
            </select>
            {s.kind === 'text' && (
              <input
                value={s.text ?? ''}
                maxLength={120}
                onChange={(e) => onChange({ ...line, [pos]: { kind: 'text', text: e.target.value } })}
              />
            )}
          </span>
        );
      })}
    </div>
  );

  return (
    // A side panel, not a modal: the code stays usable, so text can be selected and a style applied to it.
    <div
      className="modal page-design-dialog"
      role="dialog"
      aria-modal="false"
      aria-labelledby="pd-title"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      data-testid="page-design-dialog"
    >
      <h2 id="pd-title">{t('pageDesign.title')}</h2>
      <div className="side-tabs" role="tablist">
        {(['styles', 'masters', 'book', 'frames', 'preflight'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? 'active' : ''}
            onClick={() => setTab(k)}
            data-testid={`pd-tab-${k}`}
          >
            {t(`pageDesign.tab.${k}`)}
          </button>
        ))}
      </div>
      {!readable && (
        <div className="error-message" role="alert">
          {t('pageDesign.unreadable')}
          <Check label={t('pageDesign.replace')} value={replace} onChange={setReplace} />
        </div>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="muted" data-testid="pd-notice">
          {notice}
        </p>
      )}

      {tab === 'styles' && (
        <div className="pd-columns">
          <div className="pd-list">
            {(['paragraph', 'character'] as const).map((kind) => (
              <div key={kind}>
                <h3>{t(`pageDesign.${kind}Styles`)}</h3>
                <ul>
                  {(kind === 'paragraph' ? design.paragraphStyles : design.characterStyles).map((s) => (
                    <li key={s.id} className={selected?.kind === kind && selected.id === s.id ? 'active' : ''}>
                      <button className="link" onClick={() => setSelected({ kind, id: s.id })} data-testid={`pd-style-${s.id}`}>
                        {uiText(s.name)} <span className="muted">{s.id}</span>
                      </button>
                      {canEdit && (
                        <button
                          className="small"
                          onClick={() => apply(kind, s.id)}
                          title={t('pageDesign.applyHint')}
                          data-testid={`pd-apply-${s.id}`}
                        >
                          {t('pageDesign.apply')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {canEdit && (
                  <button className="small" onClick={() => addStyle(kind)} data-testid={`pd-add-${kind}`}>
                    + {t('pageDesign.add')}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="pd-form">
            {para && (
              <>
                <label className="field">
                  {t('pageDesign.name')}
                  <input value={para.name} maxLength={60} onChange={(e) => setPara({ name: e.target.value })} data-testid="pd-name" />
                </label>
                <label className="field">
                  {t('pageDesign.basedOn')}
                  <select value={para.basedOn ?? ''} onChange={(e) => setPara({ basedOn: e.target.value || undefined })}>
                    <option value="">—</option>
                    {design.paragraphStyles
                      .filter((s) => s.id !== para.id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {uiText(s.name)}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  {t('pageDesign.heading')}
                  <select
                    value={para.heading ?? ''}
                    onChange={(e) => setPara({ heading: e.target.value ? (Number(e.target.value) as 1 | 2 | 3) : undefined })}
                  >
                    <option value="">{t('pageDesign.notHeading')}</option>
                    {[1, 2, 3].map((h) => (
                      <option key={h} value={h}>
                        {t('pageDesign.headingLevel', { level: h })}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  {t('pageDesign.font')}
                  <input
                    value={para.font ?? ''}
                    placeholder="Noto Serif, fonts/Kitob.otf"
                    onChange={(e) => setPara({ font: e.target.value || undefined })}
                  />
                </label>
                <div className="pd-row">
                  <NumberField label={t('pageDesign.size')} value={para.size} onChange={(v) => setPara({ size: v })} testid="pd-size" />
                  <NumberField label={t('pageDesign.leading')} value={para.leading} onChange={(v) => setPara({ leading: v })} />
                  <NumberField
                    label={t('pageDesign.tracking')}
                    value={para.tracking}
                    step={10}
                    onChange={(v) => setPara({ tracking: v })}
                  />
                </div>
                <div className="pd-row">
                  <label className="field">
                    {t('pageDesign.align')}
                    <select
                      value={para.align ?? ''}
                      onChange={(e) => setPara({ align: (e.target.value || undefined) as Align | undefined })}
                    >
                      <option value="">—</option>
                      {ALIGNS.map((a) => (
                        <option key={a} value={a}>
                          {t(`pageDesign.alignTo.${a}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <NumberField label={t('pageDesign.indent')} value={para.indent} onChange={(v) => setPara({ indent: v })} />
                  <NumberField label={t('pageDesign.leftIndent')} value={para.leftIndent} onChange={(v) => setPara({ leftIndent: v })} />
                </div>
                <div className="pd-row">
                  <NumberField label={t('pageDesign.spaceBefore')} value={para.spaceBefore} onChange={(v) => setPara({ spaceBefore: v })} />
                  <NumberField label={t('pageDesign.spaceAfter')} value={para.spaceAfter} onChange={(v) => setPara({ spaceAfter: v })} />
                  <NumberField label={t('pageDesign.parSkip')} value={para.parSkip} onChange={(v) => setPara({ parSkip: v })} />
                  <ColorField label={t('pageDesign.color')} value={para.color} onChange={(v) => setPara({ color: v })} />
                </div>
                <div className="pd-row">
                  <Check
                    label={t('pageDesign.italic')}
                    value={para.italic}
                    onChange={(v) => setPara({ italic: v || undefined })}
                    testid="pd-italic"
                  />
                  <Check label={t('pageDesign.bold')} value={para.bold} onChange={(v) => setPara({ bold: v || undefined })} />
                  <Check
                    label={t('pageDesign.noHyphens')}
                    value={para.hyphenate === false}
                    onChange={(v) => setPara({ hyphenate: v ? false : undefined })}
                  />
                  <Check
                    label={t('pageDesign.keepWithNext')}
                    value={para.keepWithNext}
                    onChange={(v) => setPara({ keepWithNext: v || undefined })}
                  />
                </div>
                <label className="field">
                  {t('pageDesign.dropCap')}
                  <select
                    value={para.dropCap ?? ''}
                    onChange={(e) => setPara({ dropCap: e.target.value ? (Number(e.target.value) as 2 | 3 | 4) : undefined })}
                    data-testid="pd-dropcap"
                  >
                    <option value="">—</option>
                    {[2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {t('pageDesign.dropCapLines', { count: n })}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {char && (
              <>
                <label className="field">
                  {t('pageDesign.name')}
                  <input value={char.name} maxLength={60} onChange={(e) => setChar({ name: e.target.value })} />
                </label>
                <label className="field">
                  {t('pageDesign.font')}
                  <input value={char.font ?? ''} onChange={(e) => setChar({ font: e.target.value || undefined })} />
                </label>
                <div className="pd-row">
                  <NumberField
                    label={t('pageDesign.tracking')}
                    value={char.tracking}
                    step={10}
                    onChange={(v) => setChar({ tracking: v })}
                  />
                  <ColorField label={t('pageDesign.color')} value={char.color} onChange={(v) => setChar({ color: v })} />
                </div>
                <div className="pd-row">
                  <Check label={t('pageDesign.italic')} value={char.italic} onChange={(v) => setChar({ italic: v || undefined })} />
                  <Check label={t('pageDesign.bold')} value={char.bold} onChange={(v) => setChar({ bold: v || undefined })} />
                  <Check
                    label={t('pageDesign.smallCaps')}
                    value={char.smallCaps}
                    onChange={(v) => setChar({ smallCaps: v || undefined })}
                  />
                </div>
              </>
            )}
            {selected && canEdit && (
              <button className="small" onClick={removeSelected}>
                {t('pageDesign.remove')}
              </button>
            )}
            <p className="muted small-print">{t('pageDesign.stylesHint')}</p>
          </div>
        </div>
      )}

      {tab === 'masters' && (
        <div className="pd-columns">
          <div className="pd-list">
            <ul>
              {design.masters.map((m) => (
                <li key={m.id} className={m.id === masterId ? 'active' : ''}>
                  <button className="link" onClick={() => setMasterId(m.id)} data-testid={`pd-master-${m.id}`}>
                    {uiText(m.name)} <span className="muted">{m.id}</span>
                  </button>
                </li>
              ))}
            </ul>
            {canEdit && (
              <button className="small" onClick={addMaster} data-testid="pd-add-master">
                + {t('pageDesign.add')}
              </button>
            )}
          </div>
          {master && (
            <div className="pd-form">
              <label className="field">
                {t('pageDesign.name')}
                <input value={master.name} maxLength={60} onChange={(e) => setMaster({ name: e.target.value })} />
              </label>
              {(['odd', 'even'] as const).map((sideKey) => (
                <fieldset key={sideKey} className="pd-side">
                  <legend>{t(`pageDesign.side.${sideKey}`)}</legend>
                  <span className="muted">{t('pageDesign.head')}</span>
                  {slotEditor(master[sideKey].head, (l) => setMaster({ [sideKey]: { ...master[sideKey], head: l } }), `${sideKey}-head`)}
                  <span className="muted">{t('pageDesign.foot')}</span>
                  {slotEditor(master[sideKey].foot, (l) => setMaster({ [sideKey]: { ...master[sideKey], foot: l } }), `${sideKey}-foot`)}
                </fieldset>
              ))}
              <div className="pd-row">
                <Check label={t('pageDesign.headRule')} value={master.headRule} onChange={(v) => setMaster({ headRule: v })} />
                <label className="field">
                  {t('pageDesign.numbering')}
                  <select
                    value={master.numbering ?? ''}
                    onChange={(e) => setMaster({ numbering: (e.target.value || null) as PageNumbering | null })}
                  >
                    {NUMBERINGS.map((n) => (
                      <option key={n} value={n}>
                        {t(`pageDesign.numberingAs.${n || 'keep'}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {design.masters.length > 1 && canEdit && (
                <button className="small" onClick={removeMaster}>
                  {t('pageDesign.remove')}
                </button>
              )}
              <p className="muted small-print">{t('pageDesign.mastersHint', { cmd: `\\sahifausta{${master.id}}` })}</p>
            </div>
          )}
        </div>
      )}

      {tab === 'book' && (
        <div className="pd-form">
          <label className="field">
            {t('pageDesign.bookTitle')}
            <input
              value={design.title}
              maxLength={120}
              onChange={(e) => update((d) => ({ ...d, title: e.target.value }))}
              data-testid="pd-book-title"
            />
          </label>
          <label className="field">
            {t('pageDesign.defaultMaster')}
            <select value={design.defaultMaster} onChange={(e) => update((d) => ({ ...d, defaultMaster: e.target.value }))}>
              {design.masters.map((m) => (
                <option key={m.id} value={m.id}>
                  {uiText(m.name)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t('pageDesign.chapterMaster')}
            <select value={design.chapterMaster ?? ''} onChange={(e) => update((d) => ({ ...d, chapterMaster: e.target.value || null }))}>
              <option value="">{t('pageDesign.classDefault')}</option>
              {design.masters.map((m) => (
                <option key={m.id} value={m.id}>
                  {uiText(m.name)}
                </option>
              ))}
            </select>
          </label>
          <Check
            label={t('pageDesign.chapterOpensRight')}
            value={design.chapterOpensRight}
            onChange={(v) => update((d) => ({ ...d, chapterOpensRight: v }))}
          />
          <Check
            label={t('pageDesign.blankPagesEmpty')}
            value={design.blankPagesEmpty}
            onChange={(v) => update((d) => ({ ...d, blankPagesEmpty: v }))}
          />
          <Check
            label={t('pageDesign.widowControl')}
            value={design.widowControl}
            onChange={(v) => update((d) => ({ ...d, widowControl: v }))}
          />
          <fieldset className="pd-side">
            <legend>{t('pageDesign.margins')}</legend>
            <div className="pd-row">
              {(['inner', 'outer', 'top', 'bottom', 'columnGap'] as const).map((k) => (
                <NumberField
                  key={k}
                  label={t(`pageDesign.margin.${k}`)}
                  value={design.page?.[k]}
                  step={1}
                  testid={`pd-margin-${k}`}
                  onChange={(v) => update((d) => ({ ...d, page: { ...d.page, [k]: v } }))}
                />
              ))}
            </div>
            <p className="muted small-print">{t('pageDesign.marginsHint')}</p>
          </fieldset>
          <Check
            label={t('pageDesign.microtype')}
            value={design.microtype}
            onChange={(v) => update((d) => ({ ...d, microtype: v || undefined }))}
          />
        </div>
      )}

      {tab === 'frames' && <FrameForm pictures={pictures} canEdit={canEdit} onInsert={onInsert} />}

      {tab === 'preflight' && <PreflightPanel projectId={projectId} canEdit={canEdit} onJump={onJump} onChanged={onSaved} />}

      <div className="modal-actions">
        <button onClick={onClose}>{t('dialog.cancel')}</button>
        {canEdit && (
          <button className="primary" disabled={busy || (!readable && !replace)} onClick={() => void save()} data-testid="pd-save">
            {t('pageDesign.save')}
          </button>
        )}
      </div>
    </div>
  );
}
