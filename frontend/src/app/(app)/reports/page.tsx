"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";

import { MonthlyReportView, SalesReportView } from "@/components/ExtraReports";
import { ExportButtons, PrintFooter, ResultCount } from "@/components/Filters";
import { SearchPanel, type SearchSpec, type SearchValues } from "@/components/SearchPanel";
import { ReportFirm, ReportSheet, RsPeriod } from "@/components/ReportSheet";
import { Async, Card, Doc, Empty, Head, Pill, Tile } from "@/components/ui";
import { api } from "@/lib/api";
import {
  METHOD_AR,
  UNIT_STATUS_AR,
  UNIT_TYPE_AR,
  count,
  isoDate,
  money,
  monthStart,
  num,
  today,
  unitPill,
} from "@/lib/format";
import type {
  ApartmentStatus,
  AvailabilityRow,
  Client,
  ClientBalancesReport as BalancesData,
  Page,
  PaymentDetail,
  ReceiptDetail,
  TrialBalanceRow,
} from "@/lib/types";
import { ALL_ROWS } from "@/lib/paging";
import { useApi } from "@/lib/useApi";

/** Screens that are reports in their own right. */
const LINKS = [
  { href: "/trial", icon: "⚖", title: "ميزان المراجعة", body: "أرصدة كل الحسابات أو حركة فترة، مع الإجماليات." },
  { href: "/statement", icon: "▥", title: "كشف حساب عميل", body: "حركة حساب العميل بالتفصيل مع رصيد متسلسل." },
  { href: "/schedule", icon: "◷", title: "الدفعات المتأخرة", body: "الأقساط التي تجاوزت الاستحقاق، بالأقدم." },
  { href: "/accounts", icon: "☰", title: "دفتر الأستاذ", body: "حركة أي حساب على حدة مع رصيد ما قبل الفترة." },
  { href: "/journal", icon: "≡", title: "دفتر اليومية", body: "كل القيود مع تفاصيل الطرفين." },
];

/** Reports that open here, below the cards. */
const INLINE = [
  { key: "balances", icon: "◉", title: "كشف الأرصدة", body: "أرصدة كل العملاء حسب عملة الحساب، مع المشروع والبلوك والطابق." },
  { key: "cash", icon: "⇅", title: "حركة الصندوق", body: "المقبوض والمصروف خلال فترة، وصافي الحركة." },
  { key: "sales", icon: "▭", title: "تقرير المبيعات", body: "كل عملية بيع: التاريخ والعميل والمبلغ." },
  { key: "monthly", icon: "▤", title: "الملخّص الشهري", body: "المبيعات والمقبوض والمصروف شهراً بشهر." },
  { key: "availability", icon: "▦", title: "توافر الوحدات", body: "كل الوحدات وحالتها وسعرها المعروض." },
] as const;

type ReportKey = (typeof INLINE)[number]["key"];

export default function ReportsPage() {
  return (
    <Suspense fallback={<div className="loading">جارٍ التحميل…</div>}>
      <ReportsInner />
    </Suspense>
  );
}

function ReportsInner() {
  // Opens on a report, not on an empty grid of cards: ?r= when a link names
  // one (the dashboard does), else كشف الأرصدة — the one an office opens first.
  const requested = useSearchParams().get("r");
  const [openReport, setOpenReport] = useState<ReportKey>(
    INLINE.some((report) => report.key === requested) ? (requested as ReportKey) : "balances",
  );
  const current = INLINE.find((report) => report.key === openReport);

  return (
    <>
      <Head
        title="التقارير"
        subtitle={current ? `${current.title} — ${current.body}` : "التقارير المحاسبية والتشغيلية"}
      />

      <div className="grid-3 no-print" style={{ marginBottom: 18 }}>
        {LINKS.map((report) => (
          <Link
            key={report.href}
            href={report.href}
            className="rep"
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <div className="ric">{report.icon}</div>
            <div>
              <h4>{report.title}</h4>
              <p>{report.body}</p>
            </div>
          </Link>
        ))}

        {INLINE.map((report) => (
          <button
            key={report.key}
            className="rep"
            style={{
              textAlign: "start",
              font: "inherit",
              borderColor: openReport === report.key ? "var(--brass)" : undefined,
              boxShadow: openReport === report.key ? "0 0 0 2px var(--brass-soft)" : undefined,
            }}
            onClick={() => setOpenReport(report.key)}
            aria-pressed={openReport === report.key}
          >
            <div className="ric">{report.icon}</div>
            <div>
              <h4>{report.title}</h4>
              <p>{report.body}</p>
            </div>
          </button>
        ))}
      </div>

      {openReport === "balances" ? <ClientBalancesReport /> : null}
      {openReport === "cash" ? <CashMovementReport /> : null}
      {openReport === "sales" ? <SalesReportView /> : null}
      {openReport === "monthly" ? <MonthlyReportView /> : null}
      {openReport === "availability" ? <AvailabilityReport /> : null}
    </>
  );
}

/* ------------------------------------------- كشف الأرصدة حسب عملة الحساب */

/** The office's balances report, laid out like its legacy printout: every
 *  client's debit, credit and balance for the period, with phone and where
 *  they bought (project, block, floor), in account-code order. */
function ClientBalancesReport() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [side, setSide] = useState("");

  const state = useApi(
    useCallback(
      () =>
        api.get<BalancesData>("/api/reports/client-balances", {
          date_from: from || undefined,
          date_to: to || undefined,
          q: q || undefined,
          side: side || undefined,
        }),
      [from, to, q, side],
    ),
    [from, to, q, side],
  );
  const rows = state.data?.rows ?? [];

  const searchValues: SearchValues = { q, side, date_from: from, date_to: to };
  const searchSpecs: SearchSpec[] = [
    { kind: "text", key: "q", label: "الاسم / الرمز / الهاتف / المشروع / البلوك" },
    {
      kind: "choice",
      key: "side",
      label: "الرصيد",
      suggest: false,
      options: [
        { value: "debit", label: "مدينون — عليهم" },
        { value: "credit", label: "دائنون — لهم" },
        { value: "nonzero", label: "كل من له رصيد" },
      ],
    },
    { kind: "dates", from: "date_from", to: "date_to", label: "الفترة" },
  ];
  function onSearch(patch: SearchValues) {
    const setters: Record<string, (value: string) => void> = {
      q: setQ,
      side: setSide,
      date_from: setFrom,
      date_to: setTo,
    };
    for (const [key, value] of Object.entries(patch)) setters[key]?.(value);
  }

  return (
    <>
      <SearchPanel
        specs={searchSpecs}
        values={searchValues}
        onChange={onSearch}
        placeholder="ابحث بالاسم، الرمز، الهاتف، المشروع أو البلوك…"
        summary={<ResultCount shown={rows.length} total={rows.length} noun="حساب" />}
        actions={
          <ExportButtons
            filename="client-balances"
            headers={["الرمز", "اسم الحساب", "عملة", "مدين", "دائن", "الرصيد", "هاتف", "المشروع والعقار", "بلوك", "طابق / جهة"]}
            disabled={rows.length === 0}
            rows={() =>
              rows.map((row) => [
                row.code,
                row.name,
                row.currency,
                row.debit,
                row.credit,
                row.balance,
                row.phone,
                row.project,
                row.block,
                row.floor_side,
              ])
            }
          />
        }
      />

      <Async state={state}>
        {(data) => (
          <ReportSheet>
            <ReportFirm />
            <div className="rs-head">
              <div className="rs-box rs-main" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div className="rs-title" style={{ border: 0, margin: 0, padding: 0, fontSize: 19 }}>
                  كشف الأرصدة حسب عملة الحساب
                </div>
              </div>
              <div className="rs-side">
                <RsPeriod from={data.date_from} to={data.date_to} />
              </div>
            </div>

            {rows.length === 0 ? (
              <Empty title="لا أرصدة" hint="لا حساب يطابق هذا البحث." />
            ) : (
              <div className="tbl-wrap">
                <table className="rs-table">
                  <thead>
                    <tr>
                      <th>الرمز</th>
                      <th>اسم الحساب</th>
                      <th>عملة</th>
                      <th className="num">مدين</th>
                      <th className="num">دائن</th>
                      <th className="num">الرصيد</th>
                      <th>هاتف</th>
                      <th>المشروع والعقار</th>
                      <th>بلوك</th>
                      <th>طابق / جهة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.client_id}>
                        <td>
                          <span className="mono">{row.code ?? ""}</span>
                        </td>
                        <td className="nm" translate="no">
                          <Link href={`/clients/${row.client_id}`} style={{ color: "inherit", textDecoration: "none" }}>
                            {row.name}
                          </Link>
                        </td>
                        <td translate="no">{row.currency ?? ""}</td>
                        <td className="num">
                          <span className="mono">{money(row.debit, 0)}</span>
                        </td>
                        <td className="num">
                          <span className="mono">{money(row.credit, 0)}</span>
                        </td>
                        <td className="num">
                          <b className="mono">{money(row.balance, 0)}</b>
                        </td>
                        <td>
                          <span className="mono">{row.phone ?? ""}</span>
                        </td>
                        <td translate="no">{row.project ?? ""}</td>
                        <td translate="no">{row.block ?? ""}</td>
                        <td translate="no">{row.floor_side ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>الإجمالي</td>
                      <td className="num">
                        <span className="mono">{money(data.total_debit, 0)}</span>
                      </td>
                      <td className="num">
                        <span className="mono">{money(data.total_credit, 0)}</span>
                      </td>
                      <td className="num">
                        <span className="mono">{money(data.total_balance, 0)}</span>
                      </td>
                      <td colSpan={4} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div className="rs-foot">
              <div className="rs-box rs-upto">
                <span className="rs-l">عدد الحسابات :</span>
                <b className="mono">{count(rows.length)}</b>
              </div>
              <div className="rs-box rs-upto" style={{ minWidth: 340 }}>
                <span className="rs-l">إجمالي الرصيد بالدولار :</span>
                <b className="mono">{money(data.total_balance)}</b>
              </div>
            </div>
          </ReportSheet>
        )}
      </Async>
    </>
  );
}

/* ------------------------------------------------------- حركة الصندوق */

// Every movement in the period, so the totals are complete. The "capped" note
// below only fires past ALL_ROWS in one direction.
const CASH_LIMIT = ALL_ROWS;

/** Money in and money out over a period, on one timeline.
 *
 *  Receipts and payments are separate tables in the schema — as they were in
 *  the legacy system — so the two are fetched and merged here rather than
 *  inventing a combined endpoint for one screen. */
function CashMovementReport() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [direction, setDirection] = useState("");

  const receipts = useApi(
    useCallback(
      () =>
        api.get<Page<ReceiptDetail>>("/api/receipts", {
          date_from: from || undefined,
          date_to: to || undefined,
          limit: CASH_LIMIT,
        }),
      [from, to],
    ),
    [from, to],
  );
  const payments = useApi(
    useCallback(
      () =>
        api.get<Page<PaymentDetail>>("/api/payments", {
          date_from: from || undefined,
          date_to: to || undefined,
          limit: CASH_LIMIT,
        }),
      [from, to],
    ),
    [from, to],
  );

  const rows = useMemo(() => {
    const inflow = (receipts.data?.items ?? []).map((r) => ({
      id: `r${r.id}`,
      date: r.receipt_date,
      no: r.receipt_no,
      party: r.client_name ?? "—",
      account: r.cash_account_name ?? "—",
      method: METHOD_AR[r.method],
      note: r.notes ?? "",
      inAmount: num(r.amount),
      outAmount: 0,
      href: `/receipts/${r.id}/print`,
    }));
    const outflow = (payments.data?.items ?? []).map((p) => ({
      id: `p${p.id}`,
      date: p.payment_date,
      no: p.payment_no,
      party: p.beneficiary_name ?? "—",
      account: p.cash_account_name ?? "—",
      method: METHOD_AR[p.method],
      note: p.notes ?? "",
      inAmount: 0,
      outAmount: num(p.amount),
      href: `/payments/${p.id}/print`,
    }));

    const merged = [...(direction === "out" ? [] : inflow), ...(direction === "in" ? [] : outflow)];
    return merged.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [receipts.data, payments.data, direction]);

  const totalIn = rows.reduce((sum, row) => sum + row.inAmount, 0);
  const totalOut = rows.reduce((sum, row) => sum + row.outAmount, 0);

  const capped =
    (receipts.data?.total ?? 0) > CASH_LIMIT || (payments.data?.total ?? 0) > CASH_LIMIT;

  // The search box: period and direction, both under فلاتر.
  const searchValues: SearchValues = { direction, date_from: from, date_to: to };
  const searchSpecs: SearchSpec[] = [
    {
      kind: "choice", key: "direction", label: "الاتجاه",
      options: [
        { value: "in", label: "قبض فقط" },
        { value: "out", label: "صرف فقط" },
      ],
    },
    { kind: "dates", from: "date_from", to: "date_to", label: "الفترة" },
  ];
  function onSearch(patch: SearchValues) {
    const setters: Record<string, (value: string) => void> = {
      direction: setDirection, date_from: setFrom, date_to: setTo,
    };
    for (const [key, value] of Object.entries(patch)) setters[key]?.(value);
  }

  return (
    <>
      <SearchPanel
        specs={searchSpecs}
        values={searchValues}
        onChange={onSearch}
        placeholder="اختر الفترة أو الاتجاه من فلاتر…"
        summary={<ResultCount shown={rows.length} total={rows.length} noun="حركة" />}
        actions={
          <ExportButtons
            filename="cash-movement"
            headers={["التاريخ", "المستند", "الجهة", "الصندوق", "الطريقة", "قبض", "صرف", "البيان"]}
            disabled={rows.length === 0}
            rows={() =>
              rows.map((row) => [
                isoDate(row.date),
                row.no,
                row.party,
                row.account,
                row.method,
                row.inAmount || "",
                row.outAmount || "",
                row.note,
              ])
            }
          />
        }
      />

      <Async state={receipts}>
        {() => (
          <>
            <div className="tiles">
              <Tile label="إجمالي المقبوض" value={money(totalIn)} sub="داخل إلى الصندوق" tone="b" />
              <Tile label="إجمالي المصروف" value={money(totalOut)} sub="خارج من الصندوق" tone="a" />
              <Tile label="صافي الحركة" value={money(totalIn - totalOut)} sub="قبض ناقص صرف" tone="c" />
              <Tile label="عدد الحركات" value={count(rows.length)} tone="d" />
            </div>

            {capped ? (
              <div className="note no-print">
                <span>◈</span>
                <span>
                  الفترة تحوي أكثر من {count(CASH_LIMIT)} حركة في أحد الاتجاهين — المعروض أحدث{" "}
                  {count(CASH_LIMIT)}. ضيّق نطاق التواريخ للحصول على إجماليات كاملة.
                </span>
              </div>
            ) : null}

            <Card title="حركة الصندوق">
              {rows.length === 0 ? (
                <Empty title="لا حركات" hint="لا قبض ولا صرف في هذه الفترة." />
              ) : (
                <>
                  <div className="tbl-wrap">
                    <table className="ledger">
                      <thead>
                        <tr>
                          <th>التاريخ</th>
                          <th>المستند</th>
                          <th>الجهة</th>
                          <th>الصندوق / المصرف</th>
                          <th>الطريقة</th>
                          <th className="num">قبض</th>
                          <th className="num">صرف</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.id}>
                            <td><Doc>{isoDate(row.date)}</Doc></td>
                            <td><Doc>{row.no}</Doc></td>
                            <td>
                              <div className="nm">{row.party}</div>
                              {row.note ? <div className="sub">{row.note}</div> : null}
                            </td>
                            <td className="sub">{row.account}</td>
                            <td><Pill tone="gray">{row.method}</Pill></td>
                            <td className="num mono" style={{ color: "var(--credit)" }}>
                              {row.inAmount ? money(row.inAmount) : "—"}
                            </td>
                            <td className="num mono" style={{ color: "var(--debit)" }}>
                              {row.outAmount ? money(row.outAmount) : "—"}
                            </td>
                            <td className="num no-print">
                              <Link className="btn sm" href={row.href}>⎙ سند</Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="ledger-foot">
                    <div>
                      <div className="lf-lbl">إجمالي المقبوض</div>
                      <div className="lf-val">{money(totalIn)}</div>
                    </div>
                    <div>
                      <div className="lf-lbl">إجمالي المصروف</div>
                      <div className="lf-val">{money(totalOut)}</div>
                    </div>
                    <div>
                      <div className="lf-lbl">الصافي</div>
                      <div className="lf-val">{money(totalIn - totalOut)}</div>
                    </div>
                  </div>

                  <PrintFooter title={`حركة الصندوق ${from || "البداية"} → ${to || "اليوم"}`} />
                </>
              )}
            </Card>
          </>
        )}
      </Async>
    </>
  );
}

/* ------------------------------------------------------ توافر الوحدات */

function AvailabilityReport() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const state = useApi(useCallback(() => api.get<AvailabilityRow[]>("/api/reports/availability"), []), []);

  const all = state.data ?? [];
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((row) => {
      if (status && row.status !== status) return false;
      if (!needle) return true;
      return (
        row.building.toLowerCase().includes(needle) || row.unit_no.toLowerCase().includes(needle)
      );
    });
  }, [all, status, q]);

  // The search box: typed building or unit, plus status under فلاتر.
  const searchValues: SearchValues = { q, status };
  const searchSpecs: SearchSpec[] = [
    { kind: "text", key: "q", label: "اسم البناء / رقم الوحدة" },
    {
      kind: "choice", key: "status", label: "الحالة",
      options: Object.entries(UNIT_STATUS_AR).map(([value, label]) => ({ value, label })),
    },
  ];
  function onSearch(patch: SearchValues) {
    if ("q" in patch) setQ(patch.q);
    if ("status" in patch) setStatus(patch.status);
  }

  return (
    <>
      <SearchPanel
        specs={searchSpecs}
        values={searchValues}
        onChange={onSearch}
        placeholder="ابحث باسم البناء أو رقم الوحدة…"
        summary={<ResultCount shown={rows.length} total={all.length} noun="وحدة" />}
        actions={
          <ExportButtons
            filename="availability"
            headers={["البناء", "الوحدة", "الطابق", "النوع", "الحالة", "السعر المعروض", "العملة"]}
            disabled={rows.length === 0}
            rows={() =>
              rows.map((row) => [
                row.building,
                row.unit_no,
                row.floor,
                UNIT_TYPE_AR[row.unit_type] ?? row.unit_type,
                UNIT_STATUS_AR[row.status as ApartmentStatus] ?? row.status,
                row.listed_price,
                row.price_currency,
              ])
            }
          />
        }
      />

      <Async state={state}>
        {() => (
          <Card title="توافر الوحدات">
            {rows.length === 0 ? (
              <Empty
                title="لا وحدات"
                hint={
                  all.length
                    ? "لا وحدات مطابقة لهذا الفلتر."
                    : "لم تُسجَّل وحدات بعد — بيانات الوحدات غير متوفرة في ملفات النظام القديم."
                }
              />
            ) : (
              <>
                <div className="tbl-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>البناء</th>
                        <th>الوحدة</th>
                        <th>الطابق</th>
                        <th>النوع</th>
                        <th>الحالة</th>
                        <th className="num">السعر المعروض</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={`${row.building}-${row.unit_no}-${index}`}>
                          <td className="nm">{row.building}</td>
                          <td><Doc>{row.unit_no}</Doc></td>
                          <td><span className="mono">{row.floor ?? "—"}</span></td>
                          <td className="sub">{UNIT_TYPE_AR[row.unit_type] ?? row.unit_type}</td>
                          <td>
                            <Pill tone={unitPill(row.status as ApartmentStatus)}>
                              {UNIT_STATUS_AR[row.status as ApartmentStatus] ?? row.status}
                            </Pill>
                          </td>
                          <td className="num mono">
                            {row.listed_price ? `${money(row.listed_price)} ${row.price_currency ?? ""}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <PrintFooter title="توافر الوحدات" />
              </>
            )}
          </Card>
        )}
      </Async>
    </>
  );
}
