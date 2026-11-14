import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

type DialogRequest =
  | { kind: 'prompt'; message: string; value: string; hint?: string; resolve: (v: string | null) => void }
  | { kind: 'confirm'; message: string; resolve: (v: boolean) => void };

interface DialogApi {
  prompt(message: string, value?: string, hint?: string): Promise<string | null>;
  confirm(message: string): Promise<boolean>;
}

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const api = useContext(DialogContext);
  if (!api) throw new Error('useDialog must be used inside <DialogProvider>');
  return api;
}

/** Promise based replacement for window.prompt/confirm, translated and styled. */
export function DialogProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  const prompt = useCallback(
    (message: string, initial = '', hint?: string) =>
      new Promise<string | null>((resolve) => {
        setValue(initial);
        setRequest({ kind: 'prompt', message, value: initial, hint, resolve });
      }),
    [],
  );
  const confirm = useCallback(
    (message: string) => new Promise<boolean>((resolve) => setRequest({ kind: 'confirm', message, resolve })),
    [],
  );

  useEffect(() => {
    if (request?.kind === 'prompt') {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (request) {
      okRef.current?.focus();
    }
  }, [request]);

  const close = (ok: boolean) => {
    if (!request) return;
    if (request.kind === 'prompt') request.resolve(ok ? value.trim() || null : null);
    else request.resolve(ok);
    setRequest(null);
  };

  return (
    <DialogContext.Provider value={{ prompt, confirm }}>
      {children}
      {request && (
        <div className="modal-backdrop" onMouseDown={() => close(false)}>
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              close(true);
            }}
            onKeyDown={(e) => e.key === 'Escape' && close(false)}
          >
            <label className="modal-message" htmlFor="dialog-input">
              {request.message}
            </label>
            {request.kind === 'prompt' && (
              <>
                <input id="dialog-input" ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} />
                {request.hint && <p className="hint">{request.hint}</p>}
              </>
            )}
            <div className="modal-actions">
              <button type="button" onClick={() => close(false)}>
                {t('dialog.cancel')}
              </button>
              <button type="submit" className="primary" ref={okRef}>
                {t('dialog.ok')}
              </button>
            </div>
          </form>
        </div>
      )}
    </DialogContext.Provider>
  );
}
