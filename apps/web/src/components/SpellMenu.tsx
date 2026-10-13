import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SpellMenuRequest } from '../spell/extension';
import type { SpellClient } from '../spell/client';

interface Props {
  request: SpellMenuRequest;
  client: SpellClient;
  /** Adding to the personal dictionary needs an account. */
  canAddWord: boolean;
  onReplace(text: string): void;
  onAddWord(): void;
  onIgnore(): void;
  onClose(): void;
}

/** Right-click menu on a misspelled word: suggestions, add to dictionary, ignore. */
export function SpellMenu({ request, client, canAddWord, onReplace, onAddWord, onIgnore, onClose }: Props) {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    client.suggest(request.word, request.dict).then(
      (s) => !cancelled && setSuggestions(s),
      () => !cancelled && setSuggestions([]),
    );
    return () => {
      cancelled = true;
    };
  }, [client, request]);

  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      data-testid="spell-menu"
      style={{ left: Math.min(request.x, window.innerWidth - 240), top: Math.min(request.y, window.innerHeight - 260) }}
    >
      <div className="context-menu-title">«{request.word}»</div>
      {suggestions === null && <div className="muted context-menu-note">{t('spell.loading')}</div>}
      {suggestions?.length === 0 && <div className="muted context-menu-note">{t('spell.noSuggestions')}</div>}
      {suggestions?.map((s) => (
        <button key={s} role="menuitem" className="suggestion" onClick={() => onReplace(s)}>
          {s}
        </button>
      ))}
      <hr />
      {canAddWord && (
        <button role="menuitem" onClick={onAddWord}>
          {t('spell.addToDictionary')}
        </button>
      )}
      <button role="menuitem" onClick={onIgnore}>
        {t('spell.ignore')}
      </button>
    </div>
  );
}
