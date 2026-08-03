import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type ToastTone = 'info' | 'success' | 'error';

interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  pushToast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback((message: string, tone: ToastTone = 'info') => {
    const trimmed = message.trim();
    if (!trimmed) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setItems((prev) => {
      if (tone === 'error') {
        // One error dialog at a time — replace prior error.
        return [...prev.filter((item) => item.tone !== 'error'), { id, message: trimmed, tone }];
      }
      return [...prev, { id, message: trimmed, tone }];
    });
    if (tone !== 'error') {
      window.setTimeout(() => {
        setItems((prev) => prev.filter((item) => item.id !== id));
      }, 4200);
    }
  }, []);

  const value = useMemo(() => ({ pushToast }), [pushToast]);
  const errorItem = items.find((item) => item.tone === 'error') ?? null;
  const toastItems = items.filter((item) => item.tone !== 'error');

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" aria-live="polite">
        {toastItems.map((item) => (
          <div key={item.id} className={`toast toast-${item.tone}`}>
            <span>{item.message}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ color: 'inherit' }}
              onClick={() => dismiss(item.id)}
            >
              Dismiss
            </button>
          </div>
        ))}
      </div>

      {errorItem ? (
        <div
          className="error-popup-backdrop"
          role="presentation"
          onClick={() => dismiss(errorItem.id)}
        >
          <div
            className="error-popup"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`error-popup-title-${errorItem.id}`}
            aria-describedby={`error-popup-body-${errorItem.id}`}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="error-popup-close"
              aria-label="Close error"
              onClick={() => dismiss(errorItem.id)}
            >
              <span aria-hidden>✕</span>
            </button>
            <div className="error-popup-icon" aria-hidden>
              !
            </div>
            <h2 id={`error-popup-title-${errorItem.id}`}>Something went wrong</h2>
            <p id={`error-popup-body-${errorItem.id}`}>{errorItem.message}</p>
            <button type="button" className="btn btn-primary" onClick={() => dismiss(errorItem.id)}>
              OK
            </button>
          </div>
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
