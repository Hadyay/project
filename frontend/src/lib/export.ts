/** Exporting what is on screen: CSV for Excel, and the browser's own print
 *  dialogue for PDF.
 *
 *  No PDF library. The app has zero runtime dependencies beyond Next and
 *  React, and a client-side PDF writer would have to ship an Arabic font and
 *  do its own bidi shaping to render "ثمانون ألف دولار" correctly. Chrome and
 *  Edge already do that perfectly in "Save as PDF", against the same
 *  stylesheet the screen uses — see `print.css`. */

export type CsvValue = string | number | null | undefined;

function cell(value: CsvValue): string {
  if (value === null || value === undefined) return '""';
  const text = String(value);
  // A leading =, +, - or @ makes Excel treat the cell as a formula. Arabic
  // names never start that way, but document numbers and notes can.
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** Download `rows` as a CSV file Excel opens with Arabic intact.
 *
 *  The BOM is not optional: without it Excel reads UTF-8 as the local
 *  codepage and every Arabic name comes out as mojibake. */
export function downloadCsv(filename: string, headers: string[], rows: CsvValue[][]): void {
  const body = [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Timestamped file name: `receipts-2026-09-11.csv`. */
export function exportName(base: string): string {
  return `${base}-${new Date().toISOString().slice(0, 10)}.csv`;
}

export function printPage(): void {
  window.print();
}

const PAGE_STYLE_ID = "erp-page-style";

/** Set the paper the next print uses.
 *
 *  `@page` is the only place a page can state its own size and orientation,
 *  and it cannot be set from an inline style — so the rule is written into a
 *  dedicated <style> appended to <head>, after print.css, where it wins on
 *  order. The browser's print dialogue can still override it; this only
 *  changes what it starts with. */
let paper = { size: "A4", landscape: false };

export function setPageStyle(size: string, landscape: boolean): void {
  paper = { size, landscape };
  writePageStyle();
}

/** "17/09/2026 12:06:18 PM" — the stamp the office's old reports carry. */
function printStamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = now.getHours() % 12 || 12;
  return (
    `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ` +
    `${pad(hours)}:${pad(now.getMinutes())}:${pad(now.getSeconds())} ${now.getHours() < 12 ? "AM" : "PM"}`
  );
}

/** The @page rule: paper, and a footer on every sheet — the print time on
 *  one side and "Page N" on the other, as the legacy reports print them.
 *  Margin boxes (@bottom-left…) are Chrome/Edge 131+, which is where this
 *  app prints; older browsers simply print without the footer. */
function writePageStyle(): void {
  if (typeof document === "undefined") return;
  let tag = document.getElementById(PAGE_STYLE_ID);
  if (!tag) {
    tag = document.createElement("style");
    tag.id = PAGE_STYLE_ID;
    document.head.appendChild(tag);
  }
  tag.textContent =
    `@page { size: ${paper.size}${paper.landscape ? " landscape" : ""}; margin: 12mm 10mm 14mm;` +
    ` @bottom-left { content: "Page " counter(page) " / " counter(pages); font: 9pt Arial, sans-serif; color: #000; }` +
    ` @bottom-right { content: "${printStamp()}"; font: 9pt Arial, sans-serif; color: #000; } }`;
}

// Stamp the time at the moment of printing, whether from a button or Ctrl+P.
if (typeof window !== "undefined") {
  window.addEventListener("beforeprint", writePageStyle);
}
