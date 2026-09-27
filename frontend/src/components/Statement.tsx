"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { ExportButtons, PrintFooter, ResultCount } from "@/components/Filters";
import { SearchPanel, type SearchSpec, type SearchValues } from "@/components/SearchPanel";
import { ReportFirm, ReportSheet, RsField, RsPeriod, RsTotals } from "@/components/ReportSheet";
import { Async, Empty } from "@/components/ui";
import { api } from "@/lib/api";
import { ENTRY_TYPE_AR, count, dayBefore, dmy, isoDate, money, num } from "@/lib/format";
import type {
  ClientBalance,
  ClientStatement,
  EntryType,
  JournalEntryDetail,
  StatementLine,
} from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { monthsLabel } from "@/lib/alerts";
import { useAuth } from "@/lib/auth";
import type { LateClient } from "@/lib/types";

/** كشف حساب — laid out like the office's legacy statement (see ReportSheet):
 *  the client's card and the period on top, the ruled ledger with a running
 *  balance, the totals boxes underneath. On screen each row still opens to
 *  show the whole double entry behind it (not printed), because "what is this
 *  5,000 against?" is the question a client asks at the counter. */
export function Statement({ clientId }: { clientId: number }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  // Dates go to the server: anything before `from` folds into the opening
  // balance, which only the server can compute. Type and text filter here, so
  // the running balance keeps counting every movement on the account.
  const state = useApi(
    useCallback(
      () =>
        api.get<ClientStatement>(`/api/clients/${clientId}/statement`, {
          date_from: from || undefined,
          date_to: to || undefined,
        }),
      [clientId, from, to],
    ),
    [clientId, from, to],
  );

  const balance = useApi(
    useCallback(() => api.get<ClientBalance>(`/api/clients/${clientId}/balance`), [clientId]),
    [clientId],
  );

  const all = state.data?.lines ?? [];
  const lines = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((line) => {
      if (type && line.entry_type !== type) return false;
      if (!needle) return true;
      return [line.line_desc, line.entry_no, line.document_no, line.counterpart]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });
  }, [all, type, q]);

  const shownDebit = lines.reduce((sum, line) => sum + num(line.debit_base), 0);
  const shownCredit = lines.reduce((sum, line) => sum + num(line.credit_base), 0);
  const filtered = lines.length !== all.length;


  // The search box: typed text, plus period and movement type under فلاتر.
  const searchValues: SearchValues = { q, entry_type: type, date_from: from, date_to: to };
  const searchSpecs: SearchSpec[] = [
    { kind: "text", key: "q", label: "البيان / رقم القيد / السند" },
    {
      kind: "choice", key: "entry_type", label: "نوع الحركة",
      options: Object.entries(ENTRY_TYPE_AR).map(([value, label]) => ({ value, label })),
    },
    { kind: "dates", from: "date_from", to: "date_to", label: "الفترة" },
  ];
  function onSearch(patch: SearchValues) {
    const setters: Record<string, (value: string) => void> = {
      q: setQ, entry_type: setType, date_from: setFrom, date_to: setTo,
    };
    for (const [key, value] of Object.entries(patch)) setters[key]?.(value);
  }

  return (
    <>
      <SearchPanel
        specs={searchSpecs}
        values={searchValues}
        onChange={onSearch}
        placeholder="ابحث في البيان أو رقم القيد أو السند…"
        summary={<ResultCount shown={lines.length} total={all.length} noun="حركة" />}
        actions={
          <ExportButtons
            filename={`statement-${clientId}`}
            headers={[
              "التاريخ",
              "المستند",
              "السند",
              "النوع",
              "البيان",
              "مقابل حساب",
              "مدين",
              "دائن",
              "الرصيد",
            ]}
            disabled={lines.length === 0}
            rows={() =>
              lines.map((line) => [
                isoDate(line.entry_date),
                line.entry_no,
                line.document_no,
                ENTRY_TYPE_AR[line.entry_type],
                line.line_desc,
                line.counterpart,
                num(line.debit_base) || "",
                num(line.credit_base) || "",
                line.running_balance_base,
              ])
            }
          />
        }
      />

      <Async state={state}>
        {(data) => {
          const client = data.client;
          // Period totals come from every movement in the period, as on the
          // legacy sheet; the type/text filter only narrows what is listed.
          const totalDebit = all.reduce((sum, line) => sum + num(line.debit_base), 0);
          const totalCredit = all.reduce((sum, line) => sum + num(line.credit_base), 0);
          const closing = num(data.closing_balance);
          return (
            <ReportSheet>
              <LateBanner clientId={clientId} />
              <ReportFirm />
              <div className="rs-head">
                <div className="rs-box rs-main">
                  <div className="rs-title">
                    كشف حساب بعملة الحساب <span translate="no">{client.name_ar}</span>
                  </div>
                  <div className="rs-fields">
                    <RsField label="رقم الحساب" mono>
                      {client.code ?? client.account_id}
                    </RsField>
                    <RsField label="العملة">دولار</RsField>
                    <RsField label="الهاتف" mono>
                      {client.phone}
                    </RsField>
                    <RsField label="المشروع والعقار">
                      <span translate="no">{client.project ?? "—"}</span>
                    </RsField>
                    <RsField label="بلوك">
                      <span translate="no">{client.block ?? "—"}</span>
                    </RsField>
                    <RsField label="الطابق والجهة">
                      <span translate="no">{client.floor_side ?? "—"}</span>
                    </RsField>
                  </div>
                </div>
                <div className="rs-side">
                  <RsPeriod from={from || null} to={to || null} />
                  <div className="rs-box rs-open">
                    <span className="rs-l">
                      {from ? (
                        <>
                          الرصيد السابق لغاية <span className="mono">{dmy(dayBefore(from))}</span>
                        </>
                      ) : (
                        "الرصيد السابق"
                      )}
                    </span>
                    <b className="mono">{money(data.opening_balance)}</b>
                  </div>
                </div>
              </div>

              {lines.length === 0 ? (
                <Empty
                  title={all.length ? "لا حركات مطابقة للفلتر" : "لا حركات في هذه الفترة"}
                  hint={all.length ? "جرّب مسح الفلاتر." : "جرّب توسيع نطاق التواريخ."}
                />
              ) : (
                <div className="tbl-wrap">
                  <table className="rs-table">
                    <thead>
                      <tr>
                        <th>تاريخ السند</th>
                        <th>نوع</th>
                        <th>اليومية</th>
                        <th>رقم السند</th>
                        <th>الشرح</th>
                        <th className="num">مدين</th>
                        <th className="num">دائن</th>
                        <th className="num">الرصيد</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, index) => (
                        <StatementRow
                          key={`${line.entry_no}-${index}`}
                          line={line}
                          open={open === line.entry_id}
                          onToggle={() => setOpen(open === line.entry_id ? null : line.entry_id)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="rs-foot">
                <div className="rs-box rs-upto">
                  <span className="rs-l">
                    الرصيد لغاية <span className="mono">{dmy(to || new Date().toISOString())}</span>
                  </span>
                  <b className="mono">{money(closing)}</b>
                </div>
                <RsTotals
                  items={[
                    { label: "اجمالي مدين", value: money(totalDebit) },
                    { label: "اجمالي دائن", value: money(totalCredit) },
                    { label: "الرصيد الحالي", value: money(closing) },
                  ]}
                />
              </div>
              {filtered ? (
                <div className="sub no-print" style={{ marginTop: 8 }}>
                  {`المعروض ${count(lines.length)} من ${count(all.length)} حركة — الإجماليات والرصيد تشمل كل حركات الفترة.`}
                </div>
              ) : null}
              <div className="no-print" style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <Link className="btn primary" href={`/receipts?client_id=${clientId}`}>
                  تسجيل قبض
                </Link>
                {balance.data?.last_payment_date ? (
                  <span className="sub" style={{ alignSelf: "center" }}>
                    آخر دفعة <span className="mono">{dmy(balance.data.last_payment_date)}</span>
                  </span>
                ) : null}
              </div>
            </ReportSheet>
          );
        }}
      </Async>
    </>
  );
}

/** One statement row, and the entry behind it when opened. */
function StatementRow({
  line,
  open,
  onToggle,
}: {
  line: StatementLine;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="row-link" onClick={onToggle} style={{ cursor: "pointer" }}>
        <td>
          <span className="mono">{dmy(line.entry_date)}</span>
        </td>
        <td>{ENTRY_TYPE_AR[line.entry_type]}</td>
        <td>
          <span className="mono">{line.entry_no}</span>
        </td>
        <td>
          <span className="mono">{line.document_no ?? ""}</span>
        </td>
        <td className="wrap" translate="no">
          {line.line_desc ?? ""}
        </td>
        {/* mono on a span, never on the td: .mono is inline-block, and an
            inline-block cell stops being a table cell. */}
        <td className="num">
          <span className="mono">{num(line.debit_base) ? money(line.debit_base) : "0"}</span>
        </td>
        <td className="num">
          <span className="mono">{num(line.credit_base) ? money(line.credit_base) : "0"}</span>
        </td>
        <td className="num">
          <b className="mono">{money(line.running_balance_base)}</b>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={8} className="no-print" style={{ background: "var(--stone)" }}>
            <EntryDetail entryId={line.entry_id} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** The full double entry behind a statement row — both sides, as posted. */
function EntryDetail({ entryId }: { entryId: number }) {
  const state = useApi(
    useCallback(() => api.get<JournalEntryDetail>(`/api/journal/${entryId}`), [entryId]),
    [entryId],
  );

  return (
    <Async state={state}>
      {(entry) => (
        <div className="je-bal" style={{ display: "block", padding: "10px 4px" }}>
          <div className="sub" style={{ marginBottom: 8 }}>
            قيد <span className="mono">{entry.entry_no}</span> — {isoDate(entry.entry_date)}
            {entry.description ? ` — ${entry.description}` : ""}
          </div>
          {entry.lines.map((line) => (
            <div className="je-line" key={line.id}>
              <span className="mono">{line.account_code ?? "—"}</span>
              <span style={{ flex: 1 }}>{line.account_name ?? "—"}</span>
              <span className="mono" style={{ color: "var(--debit)" }}>
                {num(line.debit_base) ? money(line.debit_base) : ""}
              </span>
              <span className="mono" style={{ color: "var(--credit)" }}>
                {num(line.credit_base) ? money(line.credit_base) : ""}
              </span>
            </div>
          ))}
          <div className="sub" style={{ marginTop: 8 }}>
            الإجمالي: <span className="mono">{money(entry.total_debit)}</span> /{" "}
            <span className="mono">{money(entry.total_credit)}</span>
            {"  "}
            <Link className="no-print" href={`/journal?q=${encodeURIComponent(entry.entry_no)}`}>
              عرض في دفتر اليومية ←
            </Link>
          </div>
        </div>
      )}
    </Async>
  );
}

/** Red banner over the statement when the client is late in this month's
 *  reminder cycle (not printed — the paper is the statement itself). */
function LateBanner({ clientId }: { clientId: number }) {
  const { can } = useAuth();
  const state = useApi(
    useCallback(() => api.get<LateClient | null>(`/api/alerts/clients/${clientId}`), [clientId]),
    [clientId],
  );
  const late = state.data;
  if (!late) return null;
  return (
    <div className="late-banner no-print">
      <span style={{ fontSize: 24 }}>🔔</span>
      <div style={{ flex: 1 }}>
        <b>{`لم يدفع — ${monthsLabel(late.months_unpaid)}`}</b>
        <div className="sub">
          {late.last_payment_date ? `آخر دفعة ${dmy(late.last_payment_date)}` : "لا دفعات مسجّلة"}
          {late.reminded_at ? ` · تم التذكير ${dmy(late.reminded_at)} (${late.reminded_by ?? ""})` : " · لم يُذكَّر هذا الشهر"}
        </div>
      </div>
      {can("alerts.view") ? (
        <Link className="btn sm" href="/alerts">
          التنبيهات
        </Link>
      ) : null}
    </div>
  );
}
