"use client";

import { useEffect, useRef, useState } from "react";

import { Field } from "@/components/ui";
import { downloadCsv, exportName, printPage, setPageStyle, type CsvValue } from "@/lib/export";
import { count } from "@/lib/format";

/* The search box every browse screen shares is SearchPanel (components/SearchPanel.tsx). */

/** Keep `offset` inside the result set as it shrinks.
 *
 *  Void the only receipt on page 41 of 41 and the list reloads with a total of
 *  2,040 while the offset still says 2,050 — an empty page that reads as "no
 *  receipts match", which is a lie. This walks back to the last page that has
 *  rows. It only ever moves backwards, so it cannot fight a user paging
 *  forward. */
export function useClampedOffset(
  total: number | undefined,
  offset: number,
  limit: number,
  setOffset: (next: number) => void,
): void {
  useEffect(() => {
    if (total === undefined || offset === 0) return;
    if (offset < total) return;
    setOffset(total === 0 ? 0 : Math.floor((total - 1) / limit) * limit);
  }, [total, offset, limit, setOffset]);
}

/** "٥٠ من ٢٠٤١ حركة" — how much of the data the current filter is showing. */
export function ResultCount({ shown, total, noun = "سجل" }: { shown: number; total: number; noun?: string }) {
  if (total === 0) return null;
  return (
    <span className="sub mono" style={{ direction: "rtl" }}>
      {shown === total ? `${count(total)} ${noun}` : `${count(shown)} من ${count(total)} ${noun}`}
    </span>
  );
}

/** Export CSV / print, side by side. Both act on exactly what the filters
 *  selected — exporting the unfiltered table would be a different report. */
export function ExportButtons({
  filename,
  headers,
  rows,
  disabled = false,
}: {
  filename: string;
  headers: string[];
  rows: () => CsvValue[][];
  disabled?: boolean;
}) {
  return (
    <>
      <button
        className="btn"
        disabled={disabled}
        onClick={() => downloadCsv(exportName(filename), headers, rows())}
        title="تصدير المعروض إلى Excel"
      >
        ⤓ تصدير CSV
      </button>
      <PrintButton disabled={disabled} />
    </>
  );
}

/** Print, with the two settings that actually decide whether a printout is
 *  usable: orientation and paper.
 *
 *  A statement with eight columns needs landscape; a voucher needs portrait.
 *  Choosing in the browser's own dialogue works too, but the browser forgets
 *  it every time, and a clerk printing forty statements should set it once.
 *  The choice is written into an `@page` rule, which is the only thing a page
 *  can say about paper. */
export function PrintButton({ disabled = false }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [landscape, setLandscape] = useState(false);
  const [size, setSize] = useState("A4");
  const wrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setPageStyle(size, landscape);
  }, [size, landscape]);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="pop-wrap" ref={wrap}>
      <button
        className="btn"
        disabled={disabled}
        onClick={printPage}
        title="طباعة أو حفظ PDF"
      >
        ⎙ طباعة / PDF
      </button>
      <button
        className="btn"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="خيارات الطباعة"
        title="خيارات الطباعة"
        style={{ marginInlineStart: 4 }}
      >
        ⌄
      </button>

      {open ? (
        <div className="pop">
          <h5>خيارات الطباعة</h5>
          <Field label="الاتجاه">
            <select value={landscape ? "landscape" : "portrait"}
                    onChange={(e) => setLandscape(e.target.value === "landscape")}>
              <option value="portrait">طولي</option>
              <option value="landscape">عرضي — للجداول العريضة</option>
            </select>
          </Field>
          <Field label="حجم الورق">
            <select value={size} onChange={(e) => setSize(e.target.value)}>
              <option value="A4">A4</option>
              <option value="A5">A5</option>
              <option value="Letter">Letter</option>
              <option value="Legal">Legal</option>
            </select>
          </Field>
          <button
            className="btn primary"
            onClick={() => {
              setOpen(false);
              printPage();
            }}
          >
            طباعة الآن
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Long tables scroll a long way. This comes back. */
export function BackToTop() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // The document scrolls, not a wrapper: `.main` is a flex column with no
    // overflow of its own, and the nav and topbar are sticky against the page.
    function onScroll() {
      setShow(window.scrollY > 400);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!show) return null;

  return (
    <button
      className="to-top no-print"
      aria-label="العودة إلى الأعلى"
      title="العودة إلى الأعلى"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    >
      ↑
    </button>
  );
}

/** The letterhead that only shows up on paper, above a printed report.
 *
 *  On screen the page already says what it is — the nav is highlighted, the
 *  <Head> carries the title. On paper none of that survives, so a printout
 *  needs to name the firm, the report, the period it covers and when it was
 *  taken, or it is an anonymous table of numbers. */
export function PrintHeader({
  title,
  period,
  org,
}: {
  title: string;
  period?: string;
  org?: {
    name: string;
    subtitle?: string | null;
    phone?: string | null;
    tax_no?: string | null;
    logo?: string | null;
  };
}) {
  return (
    <div className="print-head">
      {org?.logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data URI, not a file to optimise
        <img className="ph-logo" src={org.logo} alt="" />
      ) : null}
      <div className="ph-org">
        <b>{org?.name ?? ""}</b>
        {org?.subtitle ? <span> — {org.subtitle}</span> : null}
        {org?.phone ? <span> · {org.phone}</span> : null}
        {org?.tax_no ? <span> · رقم ضريبي {org.tax_no}</span> : null}
      </div>
      <div className="ph-title">
        <b>{title}</b>
        {period ? <span> — {period}</span> : null}
      </div>
    </div>
  );
}

/** The line that only shows up on paper, under every printed report. */
export function PrintFooter({ title }: { title: string }) {
  return (
    <div className="print-foot">
      {title} — طُبع بتاريخ {new Date().toISOString().slice(0, 10)} من نظام إدارة العقارات
    </div>
  );
}
