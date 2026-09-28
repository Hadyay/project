"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Voucher } from "@/components/Voucher";
import { count } from "@/lib/format";
import { printPage } from "@/lib/export";

export default function PrintAllPage() {
  return (
    <Suspense fallback={<div className="loading">جارٍ التحميل…</div>}>
      <PrintAll />
    </Suspense>
  );
}

/** /receipts/print?ids=1,2,3 — several receipt vouchers, one per page: the
 *  "print all" after تسجيل دفعات الشهر. */
function PrintAll() {
  const ids = (useSearchParams().get("ids") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

  if (ids.length === 0) return <div className="alert err">لا سندات للطباعة</div>;
  return (
    <>
      <div className="filters no-print">
        <Link className="btn" href="/receipts">
          ← رجوع
        </Link>
        <span className="sub">{`${count(ids.length)} سند — كل سند على صفحة`}</span>
        <div className="spacer" style={{ flex: 1 }} />
        <button className="btn primary" onClick={printPage}>
          ⎙ طباعة الكل / حفظ PDF
        </button>
      </div>
      {ids.map((id) => (
        <div className="sheet-page" key={id}>
          <Voucher kind="receipt" id={id} bare />
        </div>
      ))}
    </>
  );
}
