"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import { fold } from "@/components/SearchPanel";
import { useToast } from "@/components/Toast";
import { Async, Card, Doc, Pill } from "@/components/ui";
import { monthsLabel, useAlertSummary } from "@/lib/alerts";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ENTRY_TYPE_AR, count, isoDate, money, num } from "@/lib/format";
import { useLang, type Lang } from "@/lib/i18n";
import { ALL_ROWS } from "@/lib/paging";
import type {
  AlertsReport,
  ClientListItem,
  CollectionReport,
  Dashboard,
  LateClient,
  MonthlyReport,
  Page,
} from "@/lib/types";
import { useApi } from "@/lib/useApi";

const pad = (n: number) => String(n).padStart(2, "0");

/** "2025-12" for today. */
function thisPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** The last day of a "YYYY-MM" period, as the as_of the API takes. */
function monthEnd(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${period}-${pad(new Date(y, m, 0).getDate())}`;
}

function shiftPeriod(period: string, by: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** "كانون الأول 2025" / "December 2025" — the office's month names, Western digits. */
function monthName(period: string, lang: Lang): string {
  const [y, m] = period.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "ar-LB-u-nu-latn", {
    month: "long",
    year: "numeric",
  }).format(new Date(y, m - 1, 1));
}

/** لوحة التحكم — the hub: find a client, see who paid this month and who has
 *  not, act on it, and every headline figure one click from its screen. */
export default function DashboardPage() {
  const { can, user } = useAuth();
  const { lang } = useLang();
  const alerts = useAlertSummary();
  const state = useApi(
    useCallback(() => api.get<Dashboard>("/api/reports/dashboard"), []),
    [],
  );
  // The monthly summary carries the collections history: imported ledgers
  // stop in the past, so "this month" alone would read as zero.
  const monthly = useApi(
    useCallback(() => api.get<MonthlyReport>("/api/reports/monthly"), []),
    [],
  );
  const months = (monthly.data?.rows ?? []).filter(
    (row) => num(row.received_base) > 0 || num(row.sales_base) > 0,
  );
  const lastActive = months.find((row) => num(row.received_base) > 0);
  const chart = months.slice(0, 12).reverse();
  const chartMax = Math.max(1, ...chart.map((row) => num(row.received_base)));

  const hour = new Date().getHours();
  const name = user?.full_name ?? user?.username ?? "";
  const date = new Intl.DateTimeFormat(
    lang === "en" ? "en-GB" : "ar-LB-u-nu-latn",
    {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    },
  ).format(new Date());

  return (
    <>
      <div className="hub-hero">
        <div className="hub-hi">
          <h1>{hour < 12 ? `صباح الخير، ${name}` : `مساء الخير، ${name}`}</h1>
          <p>
            <span translate="no">{date}</span> — كل ما يهمّ في مكان واحد
          </p>
        </div>
        {can("clients.view") ? <HubSearch /> : null}
      </div>

      <div className="quick no-print">
        {/* Only what this user's role allows. */}
        {can("receipts.create") ? (
          <Link className="main" href="/receipts">
            <span className="qi">↓</span> وصل قبض جديد
          </Link>
        ) : null}
        {can("schedule.view", "receipts.view") ? (
          <Link href="/schedule">
            <span className="qi">◷</span> جدول الدفعات
          </Link>
        ) : null}
        {can("payments.create") ? (
          <Link href="/payments">
            <span className="qi">↑</span> سند صرف
          </Link>
        ) : null}
        {can("clients.create") ? (
          <Link href="/clients">
            <span className="qi">＋</span> عميل جديد
          </Link>
        ) : null}
        {can("clients.view") ? (
          <Link href="/statement">
            <span className="qi">▥</span> كشف حساب عميل
          </Link>
        ) : null}
        {can("reports.view") ? (
          <Link href="/reports?r=balances">
            <span className="qi">◉</span> كشف الأرصدة
          </Link>
        ) : null}
        {can("reports.view") ? (
          <Link href="/trial">
            <span className="qi">⚖</span> ميزان المراجعة
          </Link>
        ) : null}
      </div>

      <div className="hub-top">
        <CollectionCard lastActive={lastActive?.month ?? null} />
        {can("alerts.view") ? <LatePanel /> : null}
      </div>

      <Async state={state}>
        {(data) => {
          const { kpis } = data;
          const cash = data.cash_accounts.filter(
            (account) => num(account.balance) !== 0,
          );
          const cashTotal = cash.reduce(
            (sum, account) => sum + num(account.balance),
            0,
          );
          const overdueCount = data.upcoming_dues.filter(
            (row) => row.days_late > 0,
          ).length;
          const thisMonth = num(kpis.collected_this_month);

          return (
            <>
              <div className="dash-grid">
                <KpiLink
                  className="kpi blue"
                  href="/reports?r=balances"
                  open={can("reports.view")}
                >
                  <span className="kpi-go">←</span>
                  <div className="kpi-lbl">ذمم العملاء</div>
                  <div className="kpi-val">
                    {money(kpis.receivable_base, 0)}
                  </div>
                  <div className="kpi-sub">
                    {`${count(data.debtors_count)} مدين · ${count(data.creditors_count)} دائن · من ${count(kpis.total_clients)} عميل`}
                  </div>
                </KpiLink>
                <KpiLink
                  className="kpi green"
                  href="/reports?r=cash"
                  open={can("reports.view")}
                >
                  <span className="kpi-go">←</span>
                  <div className="kpi-lbl">النقد في الصناديق والمصارف</div>
                  <div className="kpi-val">{money(cashTotal, 0)}</div>
                  <div className="kpi-sub">{count(cash.length)} حساب نقدي</div>
                </KpiLink>
                <KpiLink
                  className="kpi amber"
                  href="/receipts"
                  open={can("receipts.view")}
                >
                  <span className="kpi-go">←</span>
                  <div className="kpi-lbl">
                    {thisMonth > 0 ? "محصّل هذا الشهر" : "آخر شهر فيه تحصيل"}
                  </div>
                  <div className="kpi-val">
                    {money(
                      thisMonth > 0
                        ? thisMonth
                        : (lastActive?.received_base ?? 0),
                      0,
                    )}
                  </div>
                  <div className="kpi-sub">
                    {thisMonth > 0
                      ? "من الوصولات المسجّلة"
                      : lastActive
                        ? `في ${lastActive.month}`
                        : "لا تحصيل مسجّل بعد"}
                  </div>
                </KpiLink>
                <KpiLink
                  className="kpi red"
                  href="/alerts"
                  open={can("alerts.view")}
                >
                  <span className="kpi-go">←</span>
                  <div className="kpi-lbl">🔔 لم يدفعوا هذا الشهر</div>
                  <div className="kpi-val">
                    {alerts.summary ? count(alerts.summary.count) : "—"}
                  </div>
                  <div className="kpi-sub">
                    {alerts.summary
                      ? `عميل — أرصدتهم ${money(alerts.summary.total_balance, 0)} $ · التنبيه يوم ${alerts.summary.alert_day}`
                      : overdueCount
                        ? `${count(overdueCount)} دفعة متأخرة`
                        : "التنبيهات متوقفة"}
                  </div>
                </KpiLink>
              </div>

              <div className="dash-grid three">
                <Card title="التحصيل الشهري — آخر ١٢ شهراً فيها حركة">
                  {chart.length ? (
                    <div className="bars" dir="ltr">
                      {chart.map((row) => {
                        const value = num(row.received_base);
                        return (
                          <div
                            className="bar-col"
                            key={row.month}
                            title={`${row.month}: ${money(value)}`}
                          >
                            <span className="bar-n">
                              {value >= 1000
                                ? `${Math.round(value / 1000)}k`
                                : money(value, 0)}
                            </span>
                            <div
                              className="bar-v"
                              style={{
                                height: `${Math.max(2, (value / chartMax) * 130)}px`,
                              }}
                            />
                            <span className="bar-l">{row.month.slice(2)}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="card-b sub">لا تحصيل مسجّل بعد.</div>
                  )}
                </Card>

                <Card title="الصناديق والمصارف">
                  {cash.length ? (
                    cash.map((account) => (
                      <div className="list-row" key={account.account_id}>
                        <div className="grow">
                          <b>{account.name}</b>
                          <span className="sub mono">{account.code}</span>
                        </div>
                        <span className="v">{money(account.balance)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="card-b sub">لا أرصدة نقدية.</div>
                  )}
                  <div className="list-row total">
                    <div className="grow">
                      <b>الإجمالي</b>
                    </div>
                    <span className="v">{money(cashTotal)}</span>
                  </div>
                </Card>

                <Card
                  title="أكبر الأرصدة المدينة"
                  actions={
                    <Link className="btn sm" href="/reports?r=balances">
                      كشف الأرصدة
                    </Link>
                  }
                >
                  {data.top_debtors.map((row) => (
                    <div className="list-row" key={row.client_id}>
                      <div className="grow">
                        <Link href={`/statement?client=${row.client_id}`}>
                          <b translate="no">{row.name}</b>
                        </Link>
                        <span className="sub">
                          <span className="mono">{row.code}</span>
                          {row.project ? (
                            <span translate="no">{` · ${row.project}`}</span>
                          ) : null}
                        </span>
                      </div>
                      <span className="v" style={{ color: "var(--debit)" }}>
                        {money(row.balance)}
                      </span>
                    </div>
                  ))}
                </Card>
              </div>

              <div className="dash-grid two">
                <Card
                  title="آخر الوصولات"
                  actions={
                    <Link className="btn sm" href="/receipts">
                      كل الوصولات
                    </Link>
                  }
                >
                  <div className="tbl-wrap" style={{ maxHeight: "none" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>التاريخ</th>
                          <th>رقم الوصل</th>
                          <th>العميل</th>
                          <th className="num">المبلغ</th>
                          <th className="no-print" />
                        </tr>
                      </thead>
                      <tbody>
                        {data.recent_receipts.map((receipt) => (
                          <tr key={receipt.id}>
                            <td>
                              <span className="mono">
                                {isoDate(receipt.receipt_date)}
                              </span>
                            </td>
                            <td>
                              <b className="mono">
                                {receipt.ref_no ?? receipt.receipt_no}
                              </b>
                            </td>
                            <td className="nm" translate="no">
                              {receipt.client_id ? (
                                <Link
                                  href={`/statement?client=${receipt.client_id}`}
                                >
                                  {receipt.client_name}
                                </Link>
                              ) : (
                                (receipt.client_name ?? "—")
                              )}
                            </td>
                            <td className="num">
                              <b className="mono">
                                {money(receipt.amount_base)}
                              </b>
                            </td>
                            <td className="num no-print">
                              <Link
                                className="btn sm"
                                href={`/receipts/${receipt.id}/print`}
                              >
                                ⎙ سند
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <Card
                  title="آخر القيود"
                  actions={
                    <Link className="btn sm" href="/journal">
                      دفتر اليومية
                    </Link>
                  }
                >
                  <div className="tbl-wrap" style={{ maxHeight: "none" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>التاريخ</th>
                          <th>القيد</th>
                          <th>النوع</th>
                          <th>البيان</th>
                          <th className="num">المبلغ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recent_docs.slice(0, 8).map((doc) => (
                          <tr key={doc.entry_no}>
                            <td>
                              <span className="mono">
                                {isoDate(doc.entry_date)}
                              </span>
                            </td>
                            <td>
                              <Doc>{doc.entry_no}</Doc>
                            </td>
                            <td>
                              <Pill tone="gray">
                                {ENTRY_TYPE_AR[doc.entry_type]}
                              </Pill>
                            </td>
                            <td className="sub" translate="no">
                              {doc.description ?? "—"}
                            </td>
                            <td className="num">
                              <b className="mono">{money(doc.amount_base)}</b>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>

              {kpis.total_units === 0 ? (
                <div className="note no-print">
                  <span>◈</span>
                  <span>
                    سجلّ العقارات فارغ — ملفات النظام القديم لا تحتوي على جدول
                    وحدات، لكن مشروع كل عميل وبلوكه وطابقه محفوظة على بطاقته
                    وتظهر في كشف الأرصدة.{" "}
                    <Link href="/buildings">+ إضافة بناء</Link>
                  </span>
                </div>
              ) : null}
            </>
          );
        }}
      </Async>
    </>
  );
}

/* ------------------------------------------------------------- client search */

/** Type a name, code, phone or project → the client's statement. */
function HubSearch() {
  const router = useRouter();
  const clients = useApi(
    useCallback(
      () => api.get<Page<ClientListItem>>("/api/clients", { limit: ALL_ROWS }),
      [],
    ),
    [],
  );
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(0);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const hits = useMemo(() => {
    const needle = fold(q);
    if (!needle) return [];
    return (clients.data?.items ?? [])
      .filter((c) =>
        [c.name_ar, c.name_en, c.code, c.phone, c.phone2, c.project].some(
          (v) => v && fold(v).includes(needle),
        ),
      )
      .slice(0, 8);
  }, [clients.data, q]);

  function go(c: ClientListItem) {
    router.push(`/statement?client=${c.id}`);
  }

  return (
    <div
      className="hub-search"
      ref={box}
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <span className="hs-ic">⌕</span>
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setFocus(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setFocus((f) => Math.min(f + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setFocus((f) => Math.max(f - 1, 0));
          } else if (e.key === "Enter" && hits[focus]) {
            go(hits[focus]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="ابحث عن عميل: الاسم، الرمز، الهاتف أو المشروع…"
        aria-label="ابحث عن عميل"
      />
      {open && q.trim() ? (
        <ul className="hs-drop">
          {hits.length === 0 ? (
            <li className="hs-none">لا عملاء مطابقون</li>
          ) : (
            hits.map((c, i) => {
              const bal = num(c.balance_base);
              return (
                <li key={c.id}>
                  <button
                    className={i === focus ? "on" : ""}
                    onMouseEnter={() => setFocus(i)}
                    onClick={() => go(c)}
                  >
                    <span className="hs-nm">
                      <b translate="no">{c.name_ar}</b>
                      <span className="sub">
                        <span className="mono">{c.code}</span>
                        {c.phone ? (
                          <>
                            {" · ☎ "}
                            <span className="mono">{c.phone}</span>
                          </>
                        ) : null}
                        {c.project ? (
                          <span translate="no">{` · ${c.project}`}</span>
                        ) : null}
                      </span>
                    </span>
                    {c.late ? (
                      <span className="st-late">
                        🔔 {monthsLabel(c.months_unpaid)}
                      </span>
                    ) : null}
                    <span
                      className={`st-bal mono${bal > 0.005 ? " dr" : bal < -0.005 ? " cr" : ""}`}
                    >
                      {money(Math.abs(bal))}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- collection */

function Ring({ value, tone }: { value: number; tone: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <svg viewBox="0 0 120 120" className={`donut ${tone}`} aria-hidden>
      <circle className="ring-bg" cx="60" cy="60" r={r} />
      {/* A zero-length round-capped stroke still draws a dot: leave it out. */}
      {v > 0 ? (
        <circle
          className="ring-fg"
          cx="60"
          cy="60"
          r={r}
          strokeDasharray={`${(c * v) / 100} ${c}`}
          transform="rotate(-90 60 60)"
        />
      ) : null}
    </svg>
  );
}

/** "X% من العملاء دفعوا هذا الشهر": of the clients who owed when the month
 *  began, how many paid (the full installment, where one is set). Always
 *  labelled with its month — before the alert day the alerts list is still
 *  on last month's cycle, and the two must not look like the same number. */
function CollectionCard({ lastActive }: { lastActive: string | null }) {
  const { lang } = useLang();
  const now = thisPeriod();
  const [period, setPeriod] = useState(now);
  const state = useApi(
    useCallback(
      () =>
        api.get<CollectionReport>("/api/reports/collection", {
          months: 6,
          as_of: monthEnd(period),
        }),
      [period],
    ),
    [period],
  );

  const data = state.data;
  const cur = data?.current;
  const prev =
    data && data.months.length > 1 ? data.months[data.months.length - 2] : null;
  const rate = cur ? num(cur.rate) : 0;
  const tone = rate >= 70 ? "good" : rate >= 40 ? "mid" : "low";
  const delta =
    cur && prev && prev.owing_at_start > 0 ? rate - num(prev.rate) : null;
  const isNow = period === now;

  return (
    <div className="card hub-coll">
      <div className="card-h">
        <h3>{isNow ? "من دفع هذا الشهر؟" : "من دفع في الشهر؟"}</h3>
        <span className="spacer" />
        <div className="month-nav no-print">
          <button
            className="btn sm"
            onClick={() => setPeriod(shiftPeriod(period, -1))}
            title="الشهر السابق"
          >
            {lang === "en" ? "‹" : "›"}
          </button>
          <b translate="no">{monthName(period, lang)}</b>
          <button
            className="btn sm"
            onClick={() => setPeriod(shiftPeriod(period, 1))}
            disabled={isNow}
            title="الشهر التالي"
          >
            {lang === "en" ? "›" : "‹"}
          </button>
        </div>
      </div>

      {!cur ? (
        <div className="loading">{state.error ?? "جارٍ التحميل…"}</div>
      ) : (
        <div className="coll-body">
          <div className="coll-ring">
            <Ring value={rate} tone={cur.owing_at_start ? tone : "none"} />
            <div className="ring-c">
              <b className="mono">
                {cur.owing_at_start ? `${rate.toFixed(0)}%` : "—"}
              </b>
              <span>دفعوا</span>
            </div>
          </div>

          <div className="coll-facts">
            <p className="coll-line">
              {cur.owing_at_start
                ? `${count(cur.paid)} من ${count(cur.owing_at_start)} عميلاً مديناً دفعوا`
                : "لا عملاء مدينون في بداية الشهر"}
            </p>
            {delta !== null ? (
              <p className={`coll-delta ${delta >= 0 ? "up" : "down"}`}>
                {delta >= 0
                  ? `▲ ${delta.toFixed(1)} نقطة عن الشهر السابق`
                  : `▼ ${Math.abs(delta).toFixed(1)} نقطة عن الشهر السابق`}
              </p>
            ) : null}
            <div className="coll-stats">
              <div className="cs ok">
                <span>دفعوا</span>
                <b className="mono">{count(cur.paid)}</b>
              </div>
              <Link className="cs bad" href="/alerts">
                <span>لم يدفعوا</span>
                <b className="mono">{count(cur.late)}</b>
              </Link>
              <div className="cs">
                <span>المحصّل</span>
                <b className="mono">{money(cur.amount_collected, 0)}</b>
              </div>
              {cur.expected !== null ? (
                <div className="cs">
                  <span>المتوقّع</span>
                  <b className="mono">{money(cur.expected, 0)}</b>
                </div>
              ) : null}
            </div>
            {isNow &&
            num(cur.amount_collected) === 0 &&
            lastActive &&
            lastActive !== now ? (
              <div className="coll-hint">
                <span>لم تُسجَّل وصولات هذا الشهر بعد.</span>
                <button
                  className="btn sm"
                  onClick={() => setPeriod(lastActive)}
                >
                  عرض آخر شهر فيه تحصيل
                </button>
              </div>
            ) : !isNow ? (
              <div className="coll-hint">
                <button className="btn sm" onClick={() => setPeriod(now)}>
                  العودة إلى هذا الشهر
                </button>
              </div>
            ) : null}
          </div>

          <div className="coll-trend" dir="ltr" aria-label="آخر ستة أشهر">
            {data.months.map((m) => {
              const r = num(m.rate);
              return (
                <button
                  key={m.period}
                  className={`ct-col${m.period === period ? " on" : ""}`}
                  onClick={() => setPeriod(m.period)}
                  title={`${m.period}: ${m.paid} / ${m.owing_at_start}`}
                >
                  <span className="ct-n mono">
                    {m.owing_at_start ? `${r.toFixed(0)}%` : "—"}
                  </span>
                  <span className="ct-bar">
                    <i style={{ height: `${Math.max(3, r)}%` }} />
                  </span>
                  <span className="ct-l mono">{`${m.period.slice(5)}/${m.period.slice(2, 4)}`}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- late clients */

/** The five to call first: not yet reminded this month, largest balance. */
function LatePanel() {
  const { can } = useAuth();
  const toast = useToast();
  const state = useApi(
    useCallback(() => api.get<AlertsReport>("/api/alerts"), []),
    [],
  );
  const [busy, setBusy] = useState<number | null>(null);

  const top = useMemo(() => {
    const rows = [...(state.data?.rows ?? [])];
    rows.sort(
      (a, b) =>
        Number(!!a.reminded_at) - Number(!!b.reminded_at) ||
        num(b.balance) - num(a.balance),
    );
    return rows.slice(0, 5);
  }, [state.data]);

  async function remind(row: LateClient) {
    setBusy(row.client_id);
    try {
      await api.post(`/api/alerts/clients/${row.client_id}/remind`, {
        note: null,
      });
      toast.ok(`سُجّل التذكير — ${row.name}`);
      state.reload();
    } catch (err) {
      toast.err(err instanceof Error ? err.message : "تعذّر التنفيذ");
    } finally {
      setBusy(null);
    }
  }

  const data = state.data;
  return (
    <div className="card hub-late">
      <div className="card-h">
        <h3>🔔 للاتصال أولاً</h3>
        <span className="spacer" />
        {data?.enabled ? (
          <Link className="btn sm" href="/alerts">
            {`كل المتأخرين (${count(data.count)})`}
          </Link>
        ) : null}
      </div>
      {!data ? (
        <div className="loading">{state.error ?? "جارٍ التحميل…"}</div>
      ) : !data.enabled ? (
        <div className="card-b sub">
          التنبيهات متوقفة — فعّلها من الإعدادات ← التنبيهات.
        </div>
      ) : top.length === 0 ? (
        <div className="card-b hub-allpaid">
          <b>✓ كل العملاء دفعوا</b>
          <span className="sub">{`لا متأخرين في دورة ${data.cycle.period}.`}</span>
        </div>
      ) : (
        <>
          {top.map((row) => (
            <div className="list-row late-row" key={row.client_id}>
              <div className="grow">
                <Link href={`/statement?client=${row.client_id}`}>
                  <b translate="no">{row.name}</b>
                </Link>
                <span className="sub">
                  {row.phone ? (
                    <>
                      {"☎ "}
                      <span className="mono">{row.phone}</span>
                      {" · "}
                    </>
                  ) : null}
                  <span className="late-txt">
                    {monthsLabel(row.months_unpaid)}
                  </span>
                </span>
              </div>
              <span className="v" style={{ color: "var(--debit)" }}>
                {money(row.balance, 0)}
              </span>
              <span className="late-act no-print">
                {can("alerts.manage") ? (
                  row.reminded_at ? (
                    <span className="pill ok">✓ ذُكِّر</span>
                  ) : (
                    <button
                      className="btn sm"
                      onClick={() => remind(row)}
                      disabled={busy === row.client_id}
                    >
                      تم التذكير
                    </button>
                  )
                ) : null}
                {can("receipts.create") ? (
                  <Link
                    className="btn sm primary"
                    href={`/receipts?client_id=${row.client_id}`}
                  >
                    قبض
                  </Link>
                ) : null}
              </span>
            </div>
          ))}
          <div className="list-row total">
            <div className="grow sub">{`دورة ${data.cycle.period} · تم تذكير ${count(data.reminded_count)} من ${count(data.count)}`}</div>
          </div>
        </>
      )}
    </div>
  );
}

/** A headline figure: a link to the screen behind it when the user may open
 *  that screen, a plain tile otherwise. */
function KpiLink({
  className,
  href,
  open,
  children,
}: {
  className: string;
  href: string;
  open: boolean;
  children: ReactNode;
}) {
  if (open) {
    return (
      <Link className={className} href={href}>
        {children}
      </Link>
    );
  }
  return <div className={`${className} static`}>{children}</div>;
}
