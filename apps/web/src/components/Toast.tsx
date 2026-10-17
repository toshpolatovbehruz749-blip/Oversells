import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

const ToastContext = createContext<(message: string) => void>(() => undefined);

export const useToast = () => useContext(ToastContext);

/** Shows short error/info messages at the bottom of the screen. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Array<{ id: number; text: string }>>([]);
  const show = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setMessages((m) => [...m, { id, text }]);
    setTimeout(() => setMessages((m) => m.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className="toast">
            {m.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
