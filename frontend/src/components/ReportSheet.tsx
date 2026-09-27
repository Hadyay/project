"use client";

import type { ReactNode } from "react";

import { dmy } from "@/lib/format";
import { useOrg } from "@/lib/useOrg";

/* The office's report paper, rebuilt from its legacy printouts (كشف حساب,
 * كشف الأرصدة حسب عملة الحساب): the firm's name on top, a rounded header box
 * with the report's facts, a fully ruled table, rounded total boxes under it,
 * and the print time + page number in the page footer (lib/export.ts).
 *
 * Black and white, and identical on screen and on paper — what the clerk
 * sees is what the client is handed. Styles: .rs-* in app/print.css. */

export function ReportSheet({ children }: { children: ReactNode }) {
  return <div className="rs">{children}</div>;
}

/** Firm name line (and logo), as at the top of every legacy report. */
export function ReportFirm() {
  const org = useOrg();
  return (
    <div className="rs-firm" translate="no">
      {org.logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- inline data URI
        <img src={org.logo} alt="" />
      ) : null}
      <span>{org.name}</span>
    </div>
  );
}

/** A labelled value inside a header box: "رقم الحساب : 41100101". */
export function RsField({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="rs-field">
      <span className="rs-l">{label}</span>
      <b className={mono ? "mono" : undefined}>{children ?? "—"}</b>
    </div>
  );
}

/** The من تاريخ / الى تاريخ box. */
export function RsPeriod({ from, to }: { from: string | null; to: string | null }) {
  return (
    <div className="rs-period">
      <div>
        <span className="rs-l">من تاريخ</span>
        <b className="mono">{from ? dmy(from) : "البداية"}</b>
      </div>
      <div>
        <span className="rs-l">الى تاريخ</span>
        <b className="mono">{to ? dmy(to) : dmy(new Date().toISOString())}</b>
      </div>
    </div>
  );
}

/** A rounded total box: label over value, several side by side. */
export function RsTotals({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <div className="rs-totals">
      {items.map((item) => (
        <div key={item.label}>
          <span className="rs-l">{item.label}</span>
          <b className="mono">{item.value}</b>
        </div>
      ))}
    </div>
  );
}
