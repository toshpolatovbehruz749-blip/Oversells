import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * Icons of the layout programs a book goes to. Our own drawings (not the programs' logos), in
 * colours people know them by: a page layout for InDesign, a vector curve for CorelDRAW.
 */
export function InDesignIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="app-icon">
      <defs>
        <linearGradient id="ovs-id-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff5c8a" />
          <stop offset="1" stopColor="#c2185b" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="22" height="22" rx="5.5" fill="url(#ovs-id-bg)" />
      {/* A page with a picture frame and two columns of text. */}
      <rect x="6" y="4.5" width="12" height="15" rx="1.4" fill="#fff" />
      <rect x="7.6" y="6.2" width="8.8" height="4.2" rx="0.6" fill="#ffc2d4" />
      <path d="M8.3 9.4l2-2 1.6 1.5 1.3-1 2.5 2.1" fill="none" stroke="#c2185b" strokeWidth="0.9" strokeLinejoin="round" />
      <g stroke="#c2185b" strokeWidth="0.95" strokeLinecap="round">
        <path d="M7.7 12.3h3.6M7.7 14.1h3.6M7.7 15.9h3.6M7.7 17.7h2.4" />
        <path d="M12.7 12.3h3.6M12.7 14.1h3.6M12.7 15.9h3.6M12.7 17.7h2.8" />
      </g>
    </svg>
  );
}

export function CorelDrawIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="app-icon">
      <defs>
        <linearGradient id="ovs-cd-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5ed37a" />
          <stop offset="1" stopColor="#1b8a3f" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="22" height="22" rx="5.5" fill="url(#ovs-cd-bg)" />
      {/* A Bézier curve with its two handles and nodes. */}
      <path d="M5.5 17.5C8 7 16 17 18.5 6.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <path d="M5.5 17.5L9.5 9.5M18.5 6.5L14.5 14.5" stroke="#d6f5df" strokeWidth="0.9" strokeDasharray="1.4 1.1" />
      <circle cx="9.5" cy="9.5" r="1.3" fill="#d6f5df" />
      <circle cx="14.5" cy="14.5" r="1.3" fill="#d6f5df" />
      <rect x="3.9" y="15.9" width="3.2" height="3.2" rx="0.6" fill="#fff" />
      <rect x="16.9" y="4.9" width="3.2" height="3.2" rx="0.6" fill="#fff" />
    </svg>
  );
}

export interface AppExportAction {
  label: string;
  hint?: string;
  onClick(): void;
  testId: string;
  icon?: ReactNode;
}

/**
 * One button per layout program (its icon and name) with a small menu of what can be done:
 * download the package, open it in the program on this Mac. Closes on a click outside or Esc.
 */
export function AppExportMenu({
  icon,
  label,
  title,
  actions,
  disabled,
  testId,
}: {
  icon: ReactNode;
  label: string;
  title: string;
  actions: AppExportAction[];
  disabled?: boolean;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="app-export" ref={box}>
      <button
        className={`app-export-button${open ? ' active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={title}
        data-testid={testId}
      >
        {icon}
        <span>{label}</span>
        <span className="app-export-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="app-export-menu" role="menu" id={menuId}>
          {actions.map((a) => (
            <button
              key={a.testId}
              role="menuitem"
              title={a.hint}
              data-testid={a.testId}
              onClick={() => {
                setOpen(false);
                a.onClick();
              }}
            >
              <span className="app-export-item-icon" aria-hidden="true">
                {a.icon}
              </span>
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
