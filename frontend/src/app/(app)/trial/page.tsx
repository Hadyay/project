"use client";

import { useCallback, useMemo, useState } from "react";

import { ExportButtons, PrintFooter, ResultCount } from "@/components/Filters";
import { SearchPanel, type SearchSpec, type SearchValues } from "@/components/SearchPanel";
import { Async, Card, Doc, Empty, Head } from "@/components/ui";
import { api } from "@/lib/api";
import { ACCOUNT_TYPE_AR, money, num } from "@/lib/format";
import type { TrialBalanceRow } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function TrialBalancePage() {
  const [nonzeroOnly, setNonzeroOnly] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [accountType, setAccountType] = useState("");
  const [q, setQ] = useState("");

  // Dates and account type filter on the server — with dates this becomes the
  // movement within the period, which only the query can work out. The text
  // box filters the returned rows, so typing stays instant across 593 accounts.
  const state = useApi(
    useCallback(
      () =>
        api.get<TrialBalanceRow[]>("/api/accounts/trial-balance", {
          nonzero_only: nonzeroOnly,
          date_from: from || undefined,
          date_to: to || undefined,
          account_type: accountType || undefined,
        }),
      [nonzeroOnly, from, to, accountType],
    ),
    [nonzeroOnly, from, to, accountType],
  );

  const all = state.data ?? [];
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (row) =>
        row.code.toLowerCase().includes(needle) || row.name_ar.toLowerCase().includes(needle),
    );
  }, [all, q]);


  // The search box: typed code or name, plus period and account type under فلاتر.
  const searchValues: SearchValues = { q, account_type: accountType, date_from: from, date_to: to };
  const searchSpecs: SearchSpec[] = [
    { kind: "text", key: "q", label: "رمز الحساب أو اسمه" },
    {
      kind: "choice", key: "account_type", label: "نوع الحساب",
      options: Object.entries(ACCOUNT_TYPE_AR).map(([value, label]) => ({ value, label })),
    },
    { kind: "dates", from: "date_from", to: "date_to", label: "الفترة" },
  ];
  function onSearch(patch: SearchValues) {
    const setters: Record<string, (value: string) => void> = {
      q: setQ, account_type: setAccountType, date_from: setFrom, date_to: setTo,
    };
    for (const [key, value] of Object.entries(patch)) setters[key]?.(value);
  }

  const period = from || to ? `حركة الفترة ${from || "البداية"} → ${to || "اليوم"}` : "أرصدة الحسابات بالعملة الأساسية";

  return (
    <>
      <Head
        title="ميزان المراجعة"
        subtitle={period}
        actions={
          <button className="btn no-print" onClick={() => setNonzeroOnly((v) => !v)}>
            {nonzeroOnly ? "إظهار كل الحسابات" : "الحسابات المتحرّكة فقط"}
          </button>
        }
      />

      <SearchPanel
        specs={searchSpecs}
        values={searchValues}
        onChange={onSearch}
        placeholder="ابحث برمز الحساب أو اسمه…"
        summary={<ResultCount shown={rows.length} total={all.length} noun="حساب" />}
        actions={
          <ExportButtons
            filename="trial-balance"
            headers={["الرمز", "الحساب", "مدين", "دائن", "الرصيد"]}
            disabled={rows.length === 0}
            rows={() =>
              rows.map((row) => [row.code, row.name_ar, row.total_debit, row.total_credit, row.balance])
            }
          />
        }
      />

      <Async state={state}>
        {() => {
          const totalDebit = rows.reduce((sum, r) => sum + num(r.total_debit), 0);
          const totalCredit = rows.reduce((sum, r) => sum + num(r.total_credit), 0);
          const balanced = Math.abs(totalDebit - totalCredit) < 0.005;
          const partial = rows.length !== all.length;

          return (
            <Card>
              {rows.length === 0 ? (
                <Empty
                  title={all.length ? "لا حسابات مطابقة" : "لا حركات"}
                  hint={all.length ? "جرّب مسح الفلاتر." : "لم تُسجَّل قيود في هذه الفترة."}
                />
              ) : (
                <>
                  <div className="tbl-wrap">
                    <table className="ledger">
                      <thead>
                        <tr>
                          <th>الرمز</th>
                          <th>الحساب</th>
                          <th className="num">مدين</th>
                          <th className="num">دائن</th>
                          <th className="num">الرصيد</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.account_id}>
                            <td><Doc>{row.code}</Doc></td>
                            <td className="nm">{row.name_ar}</td>
                            <td className="num mono" style={{ color: "var(--debit)" }}>
                              {num(row.total_debit) ? money(row.total_debit) : "—"}
                            </td>
                            <td className="num mono" style={{ color: "var(--credit)" }}>
                              {num(row.total_credit) ? money(row.total_credit) : "—"}
                            </td>
                            <td className="bal-col">{money(row.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="ledger-foot">
                    <div>
                      <div className="lf-lbl">إجمالي المدين</div>
                      <div className="lf-val">{money(totalDebit)}</div>
                    </div>
                    <div>
                      <div className="lf-lbl">إجمالي الدائن</div>
                      <div className="lf-val">{money(totalCredit)}</div>
                    </div>
                    <div>
                      <div className="lf-lbl">الحالة</div>
                      <div className="lf-val" style={{ color: balanced ? undefined : "var(--brass)" }}>
                        {balanced ? "متوازن" : partial ? "جزئي" : "غير متوازن"}
                        <small>
                          {balanced
                            ? "المدين يساوي الدائن"
                            : partial
                              ? "المعروض جزء من الحسابات — امسح البحث للتحقق من التوازن"
                              : "راجع القيود غير المرحّلة"}
                        </small>
                      </div>
                    </div>
                  </div>

                  <PrintFooter title={`ميزان المراجعة — ${period}`} />
                </>
              )}
            </Card>
          );
        }}
      </Async>
    </>
  );
}
