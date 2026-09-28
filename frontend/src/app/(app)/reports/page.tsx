"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";

import { MonthlyReportView, SalesReportView } from "@/components/ExtraReports";
import { ExportButtons, PrintFooter, ResultCount } from "@/components/Filters";
import { SearchPanel, type SearchSpec, type SearchValues } from "@/components/SearchPanel";
import { ReportFirm, ReportSheet, RsPeriod } from "@/components/ReportSheet";
import { Async, Card, Doc, Empty, Field, Head, Pill, Tile } from "@/components/ui";
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
  CollectionReport as CollectionReportData,
  Page,
  PaymentDetail,
  ReceiptDetail,
  TrialBalanceRow,
} from "@/lib/types";
import { useLang } from "@/lib/i18n";
import { ALL_ROWS } from "@/lib/paging";
import { useApi } from "@/lib/useApi";

type ReportKey = "balances" | "cash" | "collection" | "sales" | "monthly" | "availability";

interface ReportItem {
  /** Opens here, below the picker… */
  key?: ReportKey;
  /** …or is a screen of its own. */
  href?: string;
  icon: string;
  title: string;
  /** The question the report answers — shown under its title. */
  body: string;
  isNew?: boolean;
}

/** Every report, grouped by what the office is asking. */
const GROUPS: { label: string; items: ReportItem[] }[] = [
  {
    label: "مالية",
    items: [
      { href: "/trial", icon: "⚖", title: "ميزان المراجعة", body: "هل الدفاتر متوازنة، وما رصيد كل حساب؟" },
      {
        key: "balances",
        icon: "◉",
        title: "كشف الأرصدة",
        body: "كم على كل عميل وكم له — حسب عملة الحساب، مع المشروع والبلوك والطابق.",
      },
      { key: "cash", icon: "⇅", title: "حركة الصندوق", body: "ما دخل الصندوق وما خرج منه خلال فترة، وصافي الحركة." },
      { href: "/accounts", icon: "☰", title: "دفتر الأستاذ", body: "حركة أي حساب على حدة مع رصيد ما قبل الفترة." },
      { href: "/journal", icon: "≡", title: "دفتر اليومية", body: "كل القيود مع تفاصيل الطرفين." },
    ],
  },
  {
    label: "التحصيل",
    items: [
      {
        key: "collection",
        icon: "◔",
        title: "تقرير التحصيل الشهري",
        body: "كم عميلاً مديناً دفع كل شهر، وكم لم يدفع، وكم حُصِّل.",
        isNew: true,
      },
      { href: "/alerts", icon: "🔔", title: "العملاء المتأخرون", body: "من لم يدفع دفعة هذا الشهر، مع هاتفه ورصيده." },
      { href: "/schedule", icon: "◷", title: "جدول الدفعات", body: "دفعات كل عميل شهراً بشهر على مدار السنة." },
      { href: "/statement", icon: "▥", title: "كشف حساب عميل", body: "حركة حساب عميل بالتفصيل مع رصيد متسلسل." },
    ],
  },
  {
    label: "المبيعات",
    items: [
      { key: "sales", icon: "▭", title: "تقرير المبيعات", body: "كل عملية بيع: التاريخ والعميل والمبلغ." },
      { key: "monthly", icon: "▤", title: "الملخّص الشهري", body: "المبيعات والمقبوض والمصروف شهراً بشهر." },
    ],
  },
  {
    label: "العقارات",
    items: [{ key: "availability", icon: "▦", title: "توافر الوحدات", body: "كل الوحدات وحالتها وسعرها المعروض." }],
  },
];

const INLINE = GROUPS.flatMap((g) => g.items).filter((item): item is ReportItem & { key: ReportKey } => !!item.key);

export default function ReportsPage() {
  return (
    <Suspense fallback={<div className="loading">جارٍ التحميل…</div>}>
      <ReportsInner />
    </Suspense>
  );
}

function ReportsInner() {
  const router = useRouter();
  // Opens on a report, not on an empty page: ?r= when a link names one (the
  // dashboard does), else كشف الأرصدة — the one an office opens first.
  const requested = useSearchParams().get("r");
  const current = INLINE.find((report) => report.key === requested) ?? INLINE[0];

  function open(key: ReportKey) {
    router.replace(`/reports?r=${key}`, { scroll: false });
  }

  return (
    <>
      <Head title={current.title} subtitle={current.body} />

      <nav className="rep-hub no-print" aria-label="التقارير">
        {GROUPS.map((group) => (
          <div className="rep-group" key={group.label}>
            <h6>{group.label}</h6>
            {group.items.map((item) =>
              item.href ? (
                <Link key={item.title} className="rep-item" href={item.href} title={item.body}>
                  <span className="ri">{item.icon}</span>
                  {item.title}
                  <span className="rep-go">↗</span>
                </Link>
              ) : (
                <button
                  key={item.title}
                  className={`rep-item${item.key === current.key ? " on" : ""}`}
                  onClick={() => open(item.key!)}
                  title={item.body}
                  aria-pressed={item.key === current.key}
                >
                  <span className="ri">{item.icon}</span>
                  {item.title}
                  {item.isNew ? <span className="rep-new">جديد</span> : null}
                </button>
              ),
            )}
          </div>
        ))}
      </nav>

      {current.key === "balances" ? <ClientBalancesReport /> : null}
      {current.key === "cash" ? <CashMovementReport /> : null}
      {current.key === "collection" ? <CollectionReport /> : null}
      {current.key === "sales" ? <SalesReportView /> : null}
      {current.key === "monthly" ? <MonthlyReportView /> : null}
      {current.key === "availability" ? <AvailabilityReport /> : null}
    </>
  );
}

/* ------------------------------------------------ تقرير التحصيل الشهري */

const pad2 = (n: number) => String(n).padStart(2, "0");

function periodNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function periodEnd(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${period}-${pad2(new Date(y, m, 0).getDate())}`;
}

/** Month by month: of the clients who owed when the month began, how many
 *  paid and how many did not, and what came in (GET /api/reports/collection —
 *  the same figures as the dashboard ring and the alerts list). */
function CollectionReport() {
  const { lang } = useLang();
  const [months, setMonths] = useState("12");
  const [end, setEnd] = useState(periodNow());

  const state = useApi(
    useCallback(
      () =>
        api.get<CollectionReportData>("/api/reports/collection", {
          months: Number(months),
          as_of: periodEnd(end),
        }),
      [months, end],
    ),
    [months, end],
  );
  const rows = state.data?.months ?? [];
  const label = (period: string) => {
    const [y, m] = period.split("-").map(Number);
    return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "ar-LB-u-nu-latn", { month: "long", year: "numeric" }).format(
      new Date(y, m - 1, 1),
    );
  };

  return (
    <>
      <div className="filters no-print">
        <Field label="حتى شهر">
          <input className="mono-in" type="month" value={end} max={periodNow()} onChange={(e) => e.target.value && setEnd(e.target.value)} />
        </Field>
        <Field label="عدد الأشهر">
          <select value={months} onChange={(e) => setMonths(e.target.value)}>
            {["6", "12", "24", "36"].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <div className="spacer" style={{ flex: 1 }} />
        <ExportButtons
          filename={`collection-${end}`}
          headers={["الشهر", "مدينون في بداية الشهر", "دفعوا", "لم يدفعوا", "نسبة من دفع %", "المحصّل", "المتوقّع"]}
          disabled={rows.length === 0}
          rows={() => rows.map((m) => [m.period, m.owing_at_start, m.paid, m.late, m.rate, m.amount_collected, m.expected ?? ""])}
        />
      </div>

      <Async state={state}>
        {(data) => {
          const collected = data.months.reduce((sum, m) => sum + num(m.amount_collected), 0);
          const counted = data.months.filter((m) => m.owing_at_start > 0);
          const avg = counted.length ? counted.reduce((sum, m) => sum + num(m.rate), 0) / counted.length : 0;
          const best = [...counted].sort((a, b) => num(b.rate) - num(a.rate))[0];
          return (
            <ReportSheet>
              <ReportFirm />
              <div className="rs-head">
                <div className="rs-box rs-main" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div className="rs-title" style={{ border: 0, margin: 0, padding: 0, fontSize: 19 }}>
                    تقرير التحصيل الشهري
                  </div>
                </div>
                <div className="rs-side">
                  <RsPeriod from={data.months[0] ? `${data.months[0].period}-01` : null} to={data.as_of} />
                </div>
              </div>

              <div className="tbl-wrap">
                <table className="rs-table coll-table">
                  <thead>
                    <tr>
                      <th>الشهر</th>
                      <th className="num">مدينون في بداية الشهر</th>
                      <th className="num">دفعوا</th>
                      <th className="num">لم يدفعوا</th>
                      <th>نسبة من دفع</th>
                      <th className="num">المحصّل ($)</th>
                      <th className="num">المتوقّع ($)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.months].reverse().map((m) => {
                      const rate = num(m.rate);
                      return (
                        <tr key={m.period}>
                          <td translate="no">
                            <b>{label(m.period)}</b>
                          </td>
                          <td className="num">
                            <span className="mono">{count(m.owing_at_start)}</span>
                          </td>
                          <td className="num">
                            <b className="mono">{count(m.paid)}</b>
                          </td>
                          <td className="num">
                            <span className="mono">{count(m.late)}</span>
                          </td>
                          <td>
                            <span className="rate-cell">
                              <span className="rate-bar no-print">
                                <i
                                  className={rate >= 70 ? "good" : rate >= 40 ? "mid" : "low"}
                                  style={{ width: `${Math.min(100, rate)}%` }}
                                />
                              </span>
                              <b className="mono">{m.owing_at_start ? `${rate.toFixed(1)}%` : "—"}</b>
                            </span>
                          </td>
                          <td className="num">
                            <span className="mono">{money(m.amount_collected, 0)}</span>
                          </td>
                          <td className="num">
                            <span className="mono">{m.expected !== null ? money(m.expected, 0) : "—"}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4}>{`الإجمالي — ${count(data.months.length)} شهراً`}</td>
                      <td>
                        <span className="mono">{`${avg.toFixed(1)}%`}</span> <span className="sub">متوسط</span>
                      </td>
                      <td className="num">
                        <span className="mono">{money(collected, 0)}</span>
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="rs-foot">
                <div className="rs-box rs-upto">
                  <span className="rs-l">إجمالي المحصّل :</span>
                  <b className="mono">{money(collected)}</b>
                </div>
                <div className="rs-box rs-upto">
                  <span className="rs-l">متوسط نسبة من دفع :</span>
                  <b className="mono">{`${avg.toFixed(1)}%`}</b>
                </div>
                {best ? (
                  <div className="rs-box rs-upto">
                    <span className="rs-l">أفضل شهر :</span>
                    <b translate="no">{`${label(best.period)} — ${num(best.rate).toFixed(1)}%`}</b>
                  </div>
                ) : null}
              </div>
              <p className="rs-note">
                المدين في بداية الشهر: رصيده في أول يوم من الشهر أكبر من حدّ التنبيه. «دفع»: سجّل وصلاً خلال الشهر —
                بقيمة القسط الشهري على الأقل حين يكون محدّداً على بطاقته. المحصّل: كل الوصولات المؤرّخة في الشهر.
              </p>
            </ReportSheet>
          );
        }}
      </Async>
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
