"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { ExportButtons, PrintFooter, ResultCount } from "@/components/Filters";
import { SearchPanel, type SearchSpec, type SearchValues } from "@/components/SearchPanel";
import { Async, Card, Doc, Empty, Tile } from "@/components/ui";
import { api } from "@/lib/api";
import { count, isoDate, money, num } from "@/lib/format";
import type { MonthlyReport, SalesReport } from "@/lib/types";
import { useApi } from "@/lib/useApi";

/** Two ledger-wide reports the office asks for by name. They live here rather
 *  than in the reports screen because that file already carries three. */

/* ------------------------------------------------------ تقرير المبيعات */

/** Every sale document, with what the client was charged.
 *
 *  The amount comes from the server, taken off the debit on the client's own
 *  receivable rather than the revenue credit — see `reports.sales_report` for
 *  why that is the figure that survives an entry splitting revenue across more
 *  than one account. */
export function SalesReportView() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");

  const state = useApi(
    useCallback(
      () =>
        api.get<SalesReport>("/api/reports/sales", {
          date_from: from || undefined,
          date_to: to || undefined,
        }),
      [from, to],
    ),
    [from, to],
  );

  const all = state.data?.rows ?? [];
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((row) =>
      [row.client_name, row.description, row.entry_no]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle)),
    );
  }, [all, q]);

  const total = rows.reduce((sum, row) => sum + num(row.amount_base), 0);

  // The search box: typed client or description, plus period under فلاتر.
  const searchValues: SearchValues = { q, date_from: from, date_to: to };
  const searchSpecs: SearchSpec[] = [
    { kind: "text", key: "q", label: "اسم العميل / البيان" },
    { kind: "dates", from: "date_from", to: "date_to", label: "الفترة" },
  ];
  function onSearch(patch: SearchValues) {
    const setters: Record<string, (value: string) => void> = { q: setQ, date_from: setFrom, date_to: setTo };
    for (const [key, value] of Object.entries(patch)) setters[key]?.(value);
  }

  return (
    <>
      <SearchPanel
        specs={searchSpecs}
        values={searchValues}
        onChange={onSearch}
        placeholder="ابحث باسم العميل أو البيان…"
        summary={<ResultCount shown={rows.length} total={all.length} noun="عملية بيع" />}
        actions={
          <ExportButtons
            filename="sales"
            headers={["التاريخ", "المستند", "العميل", "البيان", "المبلغ"]}
            disabled={rows.length === 0}
            rows={() =>
              rows.map((row) => [
                isoDate(row.entry_date),
                row.entry_no,
                row.client_name,
                row.description,
                row.amount_base,
              ])
            }
          />
        }
      />

      <Async state={state}>
        {() => (
          <>
            <div className="tiles">
              <Tile label="إجمالي المبيعات المعروضة" value={money(total)} tone="a" />
              <Tile label="عدد العمليات" value={count(rows.length)} tone="b" />
              <Tile
                label="متوسط قيمة البيع"
                value={money(rows.length ? total / rows.length : 0)}
                tone="c"
              />
              <Tile
                label="أقدم عملية معروضة"
                value={rows.length ? isoDate(rows[rows.length - 1].entry_date) : "—"}
                sub={rows.length ? `أحدثها ${isoDate(rows[0].entry_date)}` : undefined}
                tone="d"
              />
            </div>

            <Card title="تقرير المبيعات">
              {rows.length === 0 ? (
                <Empty title="لا مبيعات" hint="لا عمليات بيع في هذه الفترة." />
              ) : (
                <>
                  <div className="tbl-wrap">
                    <table className="ledger">
                      <thead>
                        <tr>
                          <th>التاريخ</th>
                          <th>المستند</th>
                          <th>العميل</th>
                          <th>البيان</th>
                          <th className="num">المبلغ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.entry_id}>
                            <td>
                              <Doc>{isoDate(row.entry_date)}</Doc>
                            </td>
                            <td>
                              <Doc>{row.entry_no}</Doc>
                            </td>
                            <td className="nm">
                              {row.client_id ? (
                                <Link href={`/clients/${row.client_id}`}>{row.client_name}</Link>
                              ) : (
                                (row.client_name ?? "—")
                              )}
                            </td>
                            <td className="sub">{row.description ?? "—"}</td>
                            <td className="bal-col">{money(row.amount_base)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="ledger-foot">
                    <div>
                      <div className="lf-lbl">إجمالي المبيعات</div>
                      <div className="lf-val">{money(total)}</div>
                    </div>
                  </div>

                  <PrintFooter title="تقرير المبيعات" />
                </>
              )}
            </Card>
          </>
        )}
      </Async>
    </>
  );
}

/* ----------------------------------------------------- الملخّص الشهري */

/** Sales raised, cash in and cash out, month by month.
 *
 *  Cash is read off the cash and bank accounts themselves, so an entry that
 *  never touched the till does not inflate a month. */
export function MonthlyReportView() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const state = useApi(
    useCallback(
      () =>
        api.get<MonthlyReport>("/api/reports/monthly", {
          date_from: from || undefined,
          date_to: to || undefined,
        }),
      [from, to],
    ),
    [from, to],
  );

  const rows = state.data?.rows ?? [];

  // The search box: the period, under فلاتر.
  const searchValues: SearchValues = { date_from: from, date_to: to };
  const searchSpecs: SearchSpec[] = [{ kind: "dates", from: "date_from", to: "date_to", label: "الفترة" }];
  function onSearch(patch: SearchValues) {
    if ("date_from" in patch) setFrom(patch.date_from);
    if ("date_to" in patch) setTo(patch.date_to);
  }

  return (
    <>
      <SearchPanel
        specs={searchSpecs}
        values={searchValues}
        onChange={onSearch}
        placeholder="اختر الفترة من فلاتر…"
        summary={<ResultCount shown={rows.length} total={rows.length} noun="شهر" />}
        actions={
          <ExportButtons
            filename="monthly"
            headers={["الشهر", "المبيعات", "المقبوض", "المصروف", "الصافي"]}
            disabled={rows.length === 0}
            rows={() =>
              rows.map((row) => [
                row.month,
                row.sales_base,
                row.received_base,
                row.paid_base,
                row.net_base,
              ])
            }
          />
        }
      />

      <Async state={state}>
        {(report) => (
          <>
            <div className="tiles">
              <Tile label="إجمالي المبيعات" value={money(report.sales_base)} tone="a" />
              <Tile label="إجمالي المقبوض" value={money(report.received_base)} tone="b" />
              <Tile label="إجمالي المصروف" value={money(report.paid_base)} tone="c" />
              <Tile label="الصافي" value={money(report.net_base)} sub="قبض ناقص صرف" tone="d" />
            </div>

            <Card title="الملخّص الشهري">
              {rows.length === 0 ? (
                <Empty title="لا حركات" hint="لا قيود في هذه الفترة." />
              ) : (
                <>
                  <div className="tbl-wrap">
                    <table className="ledger">
                      <thead>
                        <tr>
                          <th>الشهر</th>
                          <th className="num">المبيعات</th>
                          <th className="num">المقبوض</th>
                          <th className="num">المصروف</th>
                          <th className="num">الصافي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.month}>
                            <td>
                              <Doc>{row.month}</Doc>
                            </td>
                            <td className="num mono">
                              {num(row.sales_base) ? money(row.sales_base) : "—"}
                            </td>
                            <td className="num mono" style={{ color: "var(--credit)" }}>
                              {num(row.received_base) ? money(row.received_base) : "—"}
                            </td>
                            <td className="num mono" style={{ color: "var(--debit)" }}>
                              {num(row.paid_base) ? money(row.paid_base) : "—"}
                            </td>
                            <td className="bal-col">{money(row.net_base)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <PrintFooter title="الملخّص الشهري" />
                </>
              )}
            </Card>
          </>
        )}
      </Async>
    </>
  );
}
