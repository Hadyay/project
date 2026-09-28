"use client";

import Link from "next/link";
import { useCallback } from "react";

import { Async } from "@/components/ui";
import { api } from "@/lib/api";
import { METHOD_AR, isoDate, money } from "@/lib/format";
import { useOrg } from "@/lib/useOrg";
import { printPage } from "@/lib/export";
import { tafqeet } from "@/lib/tafqeet";
import type { PaymentDetail, ReceiptDetail } from "@/lib/types";
import { useApi } from "@/lib/useApi";

/** سند قبض / سند صرف — the printable voucher.
 *
 *  Receipts and payments print the same sheet with only the title and the
 *  party line swapped, so they stay in step: one layout to keep aligned with
 *  the office's paper, not two. */
export function Voucher({
  kind,
  id,
  bare = false,
}: {
  kind: "receipt" | "payment";
  id: number;
  /** Without the back / print toolbar: one of several on a print-all page. */
  bare?: boolean;
}) {
  const isReceipt = kind === "receipt";
  const path = isReceipt ? "receipts" : "payments";
  const org = useOrg();

  const state = useApi(
    useCallback(
      () => api.get<ReceiptDetail | PaymentDetail>(`/api/${path}/${id}`),
      [path, id],
    ),
    [path, id],
  );

  return (
    <Async state={state}>
      {(doc) => {
        const receipt = isReceipt ? (doc as ReceiptDetail) : null;
        const payment = isReceipt ? null : (doc as PaymentDetail);

        // The printed number, as on the original paper voucher; the system
        // number goes in the footer.
        const systemNo = receipt ? receipt.receipt_no : payment!.payment_no;
        const docNo = doc.ref_no ?? systemNo;
        const docDate = receipt ? receipt.receipt_date : payment!.payment_date;
        const party = receipt ? receipt.client_name : payment!.beneficiary_name;
        const currency = doc.currency_name ?? doc.currency_code ?? "";
        const partyAccount = receipt
          ? (receipt.client_code ?? receipt.client_id)
          : payment!.beneficiary_account_id;
        const rate =
          Number(doc.exchange_rate) !== 1 ? money(doc.exchange_rate, 6) : null;

        return (
          <>
            {bare ? null : (
              <div className="filters no-print">
                <Link className="btn" href={`/${path}`}>
                  ← رجوع
                </Link>
                <div className="spacer" style={{ flex: 1 }} />
                {receipt ? (
                  <Link className="btn" href={`/clients/${receipt.client_id}`}>
                    كشف حساب العميل
                  </Link>
                ) : null}
                <button className="btn primary" onClick={printPage}>
                  ⎙ طباعة / حفظ PDF
                </button>
              </div>
            )}

            {/* Black on white by design, on screen as on paper: a voucher is
                photocopied, faxed and filed, and colour is the first thing
                those lose. Emphasis comes from rules, boxes and weight. */}
            <div className="sheet">
              <div className="sheet-head">
                <div className="sheet-org">
                  {org.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- inline data URI
                    <img className="sheet-logo" src={org.logo} alt="" />
                  ) : null}
                  <div>
                    <div className="sheet-org-name">{org.name}</div>
                    {org.subtitle ? (
                      <div className="org">{org.subtitle}</div>
                    ) : null}
                    {org.address ? (
                      <div className="org">{org.address}</div>
                    ) : null}
                    {org.phone || org.email ? (
                      <div className="org">
                        {[org.phone, org.email].filter(Boolean).join(" · ")}
                      </div>
                    ) : null}
                    {org.tax_no ? (
                      <div className="org">الرقم الضريبي: {org.tax_no}</div>
                    ) : null}
                  </div>
                </div>
                <div className="sheet-title">
                  <h2>{isReceipt ? "سند قبض" : "سند صرف"}</h2>
                  <span>
                    {isReceipt ? "RECEIPT VOUCHER" : "PAYMENT VOUCHER"}
                  </span>
                </div>
              </div>

              <div className="sheet-meta">
                <div>
                  <span>رقم السند</span>
                  <b className="mono">{docNo}</b>
                </div>
                <div>
                  <span>التاريخ</span>
                  <b className="mono">{isoDate(docDate)}</b>
                </div>
                <div className="sheet-amount">
                  <span className="lbl">المبلغ</span>
                  <span className="val">{money(doc.amount)}</span>
                  <span className="cur">{doc.currency_code ?? currency}</span>
                </div>
              </div>

              <div className="sheet-lines">
                <div className="sheet-line">
                  <span>
                    {isReceipt ? "استلمنا من السيد/ة" : "دفعنا إلى السيد/ة"}
                  </span>
                  <b>{party ?? "—"}</b>
                </div>
                <div className="sheet-line">
                  <span>مبلغاً وقدره</span>
                  <b>{tafqeet(doc.amount, currency)}</b>
                </div>
                <div className="sheet-line">
                  <span>وذلك عن</span>
                  <b>{doc.notes || (isReceipt ? "دفعة من الحساب" : "—")}</b>
                </div>
              </div>

              <table className="sheet-details">
                <tbody>
                  <tr>
                    <th>{isReceipt ? "رقم الحساب" : "حساب المستفيد"}</th>
                    <td>
                      <span className="mono">{partyAccount}</span>
                    </td>
                    <th>{isReceipt ? "الصندوق / المصرف" : "دفعاً من"}</th>
                    <td>{doc.cash_account_name ?? "—"}</td>
                  </tr>
                  <tr>
                    <th>طريقة الدفع</th>
                    <td>{METHOD_AR[doc.method]}</td>
                    <th>رقم الشيك</th>
                    <td>
                      <span className="mono">{doc.cheque_no || "—"}</span>
                    </td>
                  </tr>
                  <tr>
                    <th>العملة</th>
                    <td>{currency || "—"}</td>
                    <th>{receipt ? "العقد" : "سعر الصرف"}</th>
                    <td>
                      <span className="mono">
                        {receipt ? (receipt.contract_no ?? "—") : (rate ?? "—")}
                      </span>
                    </td>
                  </tr>
                  {receipt && rate ? (
                    <tr>
                      <th>سعر الصرف</th>
                      <td colSpan={3}>
                        <span className="mono">{rate}</span>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>

              <div className="sheet-sign">
                <div>المحاسب</div>
                <div>أمين الصندوق</div>
                <div>{isReceipt ? "توقيع الدافع" : "توقيع المستلم"}</div>
              </div>

              {org.footer_note ? (
                <div className="sheet-note">{org.footer_note}</div>
              ) : null}

              <div className="sheet-foot">
                <span>
                  القيد:{" "}
                  <span className="mono">
                    {doc.journal_entry_id
                      ? `#${doc.journal_entry_id}`
                      : "غير مُقيَّد"}
                  </span>
                </span>
                {doc.ref_no ? (
                  <span>
                    رقم النظام: <span className="mono">{systemNo}</span>
                  </span>
                ) : null}
                <span>
                  أُنشئ: <span className="mono">{isoDate(doc.created_at)}</span>
                </span>
                <div className="spacer" style={{ flex: 1 }} />
                <span>
                  طُبع:{" "}
                  <span className="mono">
                    {new Date().toISOString().slice(0, 10)}
                  </span>
                </span>
              </div>
            </div>
          </>
        );
      }}
    </Async>
  );
}
