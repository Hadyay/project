"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** Feedback after an action.
 *
 *  Before this, a successful save said nothing at all and a failure went into
 *  a box above the fold that you had to scroll back up to find. A voided
 *  receipt looked exactly like a click that missed. */
type Tone = "ok" | "err";

interface Toast {
  id: number;
  tone: Tone;
  text: string;
}

interface ToastApi {
  ok: (text: string) => void;
  err: (text: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const LIFETIME_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef<number[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone: Tone, text: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone, text }]);
      // Errors stay until dismissed: they usually carry a message the user
      // needs to read twice, and often to copy.
      if (tone === "ok") {
        timers.current.push(window.setTimeout(() => dismiss(id), LIFETIME_MS));
      }
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(window.clearTimeout);
  }, []);

  const api = useRef<ToastApi>({
    ok: (text: string) => push("ok", text),
    err: (text: string) => push("err", text),
  });
  api.current = {
    ok: (text: string) => push("ok", text),
    err: (text: string) => push("err", text),
  };

  return (
    <ToastContext.Provider value={api.current}>
      {children}
      <div className="toasts no-print" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`}>
            <span className="ic">{toast.tone === "ok" ? "✓" : "⚠"}</span>
            <span style={{ flex: 1 }}>{toast.text}</span>
            <button className="x" onClick={() => dismiss(toast.id)} aria-label="إغلاق">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Never throws: a screen rendered outside the provider (a test, a print view)
 *  should still work, just silently. */
export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  return context ?? { ok: () => {}, err: () => {} };
}
