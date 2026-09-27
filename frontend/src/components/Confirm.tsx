"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

import { Modal } from "@/components/ui";

/** A confirmation that looks like the rest of the app.
 *
 *  `window.confirm` showed a Latin-chrome browser box, left-aligned, with
 *  "OK / Cancel" in the browser's language — jarring in an Arabic RTL screen,
 *  and it gave no room to spell out what voiding a document actually does.
 *
 *  Promise-based so call sites stay flat:
 *      if (!(await confirm({ title: …, danger: true }))) return;
 */
export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type Ask = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

interface Pending extends ConfirmOptions {
  resolve: (answer: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const ask = useCallback<Ask>(
    (options) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );

  function settle(answer: boolean) {
    pending?.resolve(answer);
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending ? (
        <Modal
          title={pending.title}
          onClose={() => settle(false)}
          footer={
            <>
              <button
                className={`btn ${pending.danger ? "danger" : "primary"}`}
                onClick={() => settle(true)}
                autoFocus
              >
                {pending.confirmLabel ?? "تأكيد"}
              </button>
              <button className="btn" onClick={() => settle(false)}>
                {pending.cancelLabel ?? "إلغاء"}
              </button>
            </>
          }
        >
          {pending.body ?? null}
        </Modal>
      ) : null}
    </ConfirmContext.Provider>
  );
}

/** Outside the provider, fall back to the browser's box rather than silently
 *  confirming — a destructive action must never proceed unasked. */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  return ask ?? (async (options) => window.confirm(options.title));
}
