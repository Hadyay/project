"use client";

import Link from "next/link";
import { useCallback, type ReactNode } from "react";

import { Async, Card, Doc, Head, Pill } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAlertSummary } from "@/lib/alerts";
import { ENTRY_TYPE_AR, count, isoDate, money, num, today } from "@/lib/format";
import type { Dashboard, MonthlyReport } from "@/lib/types";
import { useApi } from "@/lib/useApi";

/** لوحة التحكم — everything an office checks first, each figure one click
 *  from the screen that explains it. */
export default function DashboardPage() {
  const { can } = useAuth();
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
  const months = (monthly.data?.rows ?? []).filter((row) => num(row.received_base) > 0 || num(row.sales_base) > 0);
  const lastActive = months.find((row) => num(row.received_base) > 0);
  const chart = months.slice(0, 12).reverse();
  const chartMax = Math.max(1, ...chart.map((row) => num(row.received_base)));

  return (
    <>
      <Head title="لوحة التحكم" subtitle={`كل ما يهمّ في مكان واحد — ${today()}`} />

      <div className="quick no-print">
        {/* Only what this user's role allows. */}
        {can("receipts.create") ? (
          <Link className="main" href="/receipts">
            <span className="qi">↓</span> وصل قبض جديد
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
        {can("journal.view") ? (
          <Link href="/journal">
            <span className="qi">≡</span> قيود اليومية
          </Link>
        ) : null}
      </div>

      <Async state={state}>
        {(data) => {
          const { kpis } = data;
          const cash = data.cash_accounts.filter((account) => num(account.balance) !== 0);
          const cashTotal = cash.reduce((sum, account) => sum + num(account.balance), 0);
          const overdueCount = data.upcoming_dues.filter((row) => row.days_late > 0).length;
          const thisMonth = num(kpis.collected_this_month);

          return (
            <>
              <div className="dash-grid">
                <KpiLink className="kpi blue" href="/reports?r=balances" open={can("reports.view")}>
                  <span className="kpi-go">←</span>
                  <div className="kpi-lbl">ذمم العملاء</div>
                  <div className="kpi-val">{money(kpis.receivable_base, 0)}</div>
                  <div className="kpi-sub">
                    {`${count(data.debtors_count)} مدين · ${count(data.creditors_count)} دائن · من ${count(kpis.total_clients)} عميل`}
                  </div>
                </KpiLink>
                <KpiLink className="kpi green" href="/reports?r=cash" open={can("reports.view")}>
                  <span className="kpi-go">←</span>
                  <div className="kpi-lbl">النقد في الصناديق والمصارف</div>
                  <div className="kpi-val">{money(cashTotal, 0)}</div>
                  <div className="kpi-sub">{count(cash.length)} حساب نقدي</div>
                </KpiLink>
                <KpiLink className="kpi amber" href="/receipts" open={can("receipts.view")}>
                  <span className="kpi-go">←</span>
                  <div className="kpi-lbl">{thisMonth > 0 ? "محصّل هذا الشهر" : "آخر شهر فيه تحصيل"}</div>
                  <div className="kpi-val">
                    {money(thisMonth > 0 ? thisMonth : (lastActive?.received_base ?? 0), 0)}
                  </div>
                  <div className="kpi-sub">
                    {thisMonth > 0 ? "من الوصولات المسجّلة" : lastActive ? `في ${lastActive.month}` : "لا تحصيل مسجّل بعد"}
                  </div>
                </KpiLink>
                <KpiLink className="kpi red" href="/alerts" open={can("alerts.view")}>
                  <span className="kpi-go">←</span>
                  <div className="kpi-lbl">🔔 لم يدفعوا هذا الشهر</div>
                  <div className="kpi-val">{alerts.summary ? count(alerts.summary.count) : "—"}</div>
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
                          <div className="bar-col" key={row.month} title={`${row.month}: ${money(value)}`}>
                            <span className="bar-n">{value >= 1000 ? `${Math.round(value / 1000)}k` : money(value, 0)}</span>
                            <div className="bar-v" style={{ height: `${Math.max(2, (value / chartMax) * 130)}px` }} />
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
                  <div className="list-row" style={{ background: "#F8FAFC" }}>
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
                        <Link href={`/clients/${row.client_id}`}>
                          <b>{row.name}</b>
                        </Link>
                        <span className="sub">
                          <span className="mono">{row.code}</span>
                          {row.project ? ` · ${row.project}` : ""}
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
                              <span className="mono">{isoDate(receipt.receipt_date)}</span>
                            </td>
                            <td>
                              <b className="mono">{receipt.ref_no ?? receipt.receipt_no}</b>
                            </td>
                            <td className="nm">
                              {receipt.client_id ? (
                                <Link href={`/clients/${receipt.client_id}`}>{receipt.client_name}</Link>
                              ) : (
                                (receipt.client_name ?? "—")
                              )}
                            </td>
                            <td className="num">
                              <b className="mono">{money(receipt.amount_base)}</b>
                            </td>
                            <td className="num no-print">
                              <Link className="btn sm" href={`/receipts/${receipt.id}/print`}>
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
                              <span className="mono">{isoDate(doc.entry_date)}</span>
                            </td>
                            <td>
                              <Doc>{doc.entry_no}</Doc>
                            </td>
                            <td>
                              <Pill tone="gray">{ENTRY_TYPE_AR[doc.entry_type]}</Pill>
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
                    سجلّ العقارات فارغ — ملفات النظام القديم لا تحتوي على جدول وحدات، لكن مشروع كل عميل وبلوكه وطابقه
                    محفوظة على بطاقته وتظهر في كشف الأرصدة.{" "}
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
