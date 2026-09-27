"use client";

import { useEffect, type ReactNode } from "react";

import { count, money } from "@/lib/format";
import { ALL_ROWS, PAGE_SIZES } from "@/lib/paging";

/* ---------------------------------------------------------------- page head */

export function Head({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="head">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className="spacer" />
      {actions}
    </div>
  );
}

/* -------------------------------------------------------------------- cards */

export function Card({
  title,
  actions,
  children,
  footer,
  padded = false,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  padded?: boolean;
}) {
  return (
    <div className="card">
      {title || actions ? (
        <div className="card-h">
          {title ? <h3>{title}</h3> : null}
          <div className="spacer" />
          {actions}
        </div>
      ) : null}
      {padded ? <div className="card-b">{children}</div> : children}
      {footer ? (
        <div className="card-h" style={{ borderTop: "1px solid var(--line-soft)", borderBottom: 0 }}>
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export function Tile({
  label,
  value,
  sub,
  tone = "a",
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "a" | "b" | "c" | "d";
  trend?: "up" | "down";
}) {
  return (
    <div className={`tile ${tone}`}>
      <div className="t-lbl">{label}</div>
      <div className="t-val">{value}</div>
      {sub ? <div className={`t-sub${trend ? ` ${trend}` : ""}`}>{sub}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------- atoms */

export function Pill({ tone = "gray", children }: { tone?: string; children: ReactNode }) {
  return (
    <span className={`pill ${tone}`}>
      <i className="dot" />
      {children}
    </span>
  );
}

export function Doc({ children }: { children: ReactNode }) {
  return <span className="doc">{children}</span>;
}

/** The design's signature two-line figure: base amount over its context line. */
export function Amount({
  value,
  tone,
  sub,
  decimals = 2,
}: {
  value: string | number | null | undefined;
  tone?: "dr" | "cr";
  sub?: string;
  decimals?: number;
}) {
  return (
    <span className={`amt${tone ? ` ${tone}` : ""}`}>
      <b>{money(value, decimals)}</b>
      {sub ? <small>{sub}</small> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ states */

export function Loading({ label = "جارٍ التحميل…" }: { label?: string }) {
  return <div className="loading">{label}</div>;
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="alert err">
      <span>⚠</span>
      <span>{message}</span>
    </div>
  );
}

export function Empty({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h4>{title}</h4>
      {hint ? <p>{hint}</p> : null}
      {action}
    </div>
  );
}

/** Wraps the three states every list screen goes through, so screens stay flat. */
export function Async<T>({
  state,
  empty,
  children,
}: {
  state: { data: T | null; error: string | null; loading: boolean };
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (state.error) return <ErrorNote message={state.error} />;
  if (state.loading && state.data === null) return <Loading />;
  if (state.data === null) return empty ? <>{empty}</> : null;
  return <>{children(state.data)}</>;
}

/* -------------------------------------------------------------------- forms */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <div className="hint">{hint}</div> : null}
      {error ? <div className="err-msg">{error}</div> : null}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  // Escape closes, the way every other dialog on the machine does.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-back"
      onMouseDown={(event) => {
        // Only a click on the backdrop itself closes — not one that started
        // inside the dialog and drifted out while selecting text.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-h">
          <h3>{title}</h3>
          <div className="spacer" />
          <button className="x" onClick={onClose} aria-label="إغلاق">
            ×
          </button>
        </div>
        <div className="modal-b">{children}</div>
        {footer ? <div className="modal-f">{footer}</div> : null}
      </div>
    </div>
  );
}

/** Paging under a table, with the rows-per-page choice (`usePageSize`).
 *
 *  With `onLimitChange` it stays visible whenever there is more than the
 *  smallest page — otherwise choosing "الكل" would hide the very control that
 *  switches it back. Changing the size keeps the first visible row on screen. */
export function Pager({
  total,
  limit,
  offset,
  onChange,
  onLimitChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
  onLimitChange?: (limit: number) => void;
}) {
  if (total <= (onLimitChange ? PAGE_SIZES[0] : limit)) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  const paged = total > limit;

  return (
    <div className="pager">
      <span className="mono">
        {paged ? `${count(from)}–${count(to)} من ${count(total)}` : `الكل — ${count(total)}`}
      </span>
      <div className="spacer" />
      {onLimitChange ? (
        <label className="pager-size">
          عدد الصفوف
          <select
            value={limit}
            onChange={(e) => {
              const next = Number(e.target.value);
              onLimitChange(next);
              onChange(Math.floor(offset / next) * next);
            }}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size === ALL_ROWS ? "الكل" : size}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {paged ? (
        <>
          <button className="btn sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
            السابق
          </button>
          <button className="btn sm" disabled={to >= total} onClick={() => onChange(offset + limit)}>
            التالي
          </button>
        </>
      ) : null}
    </div>
  );
}
