"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { useConfirm } from "@/components/Confirm";
import { ExportButtons, PrintFooter, ResultCount } from "@/components/Filters";
import { SearchPanel, type SearchSpec, type SearchValues } from "@/components/SearchPanel";
import { useToast } from "@/components/Toast";
import { Amount, Async, Card, Doc, Empty, Head, Pill, Tile } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CONTRACT_TYPE_AR, count, isoDate, lateLabel, money, num, schedulePill, today } from "@/lib/format";
import type { ContractType, OverdueRefresh, OverdueRow, RentInvoiceRun } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function SchedulePage() {
  const [asOf, setAsOf] = useState(today());
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [minLate, setMinLate] = useState("");

  const fetcher = useCallback(
    () => api.get<OverdueRow[]>("/api/contracts/overdue", { as_of: asOf, limit: 300 }),
    [asOf],
  );
  const state = useApi(fetcher, [asOf]);
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  /** The batch form of invoicing one rent period from a contract's schedule. */
  async function invoiceRent() {
    const ok = await confirm({
      title: `فوترة الإيجارات المستحقّة حتى ${asOf}؟`,
      body: (
        <>
          <p>
            لكل فترة إيجار مستحقّة على عقد نافذ ولم تُفوتر بعد، يُقيَّد قيد: من ذمم المستأجر إلى
            إيراد الإيجار، بتاريخ استحقاق الفترة.
          </p>
          <p className="sub" style={{ marginTop: 8 }}>
            الفترات المفوترة سابقاً تُتخطّى، فإعادة التشغيل لا تكرّر أي قيد.
          </p>
        </>
      ),
      confirmLabel: "فوترة",
    });
    if (!ok) return;

    setBusy(true);
    try {
      const run = await api.post<RentInvoiceRun>("/api/contracts/rent/invoice-due", undefined, { as_of: asOf });
      if (run.failures.length) {
        toast.err(
          `تعذّرت فوترة ${count(run.failures.length)} فترة: ` +
            run.failures.map((f) => `${f.contract_no} (${f.seq_no}) — ${f.detail}`).join("، "),
        );
      }
      toast.ok(
        run.invoiced
          ? `فُوترت ${count(run.invoiced)} فترة إيجار` +
              (run.skipped ? ` — وتُخطّيت ${count(run.skipped)} مفوترة سابقاً` : "")
          : "لا فترات إيجار مستحقّة غير مفوترة",
      );
      state.reload();
    } catch (err) {
      toast.err(err instanceof Error ? err.message : "تعذّرت الفوترة");
    } finally {
      setBusy(false);
    }
  }

  /** Status only — reversible, so no confirmation. */
  async function refreshOverdue() {
    setBusy(true);
    try {
      const result = await api.post<OverdueRefresh>("/api/contracts/schedule/refresh-overdue", undefined, {
        as_of: asOf,
      });
      toast.ok(
        result.marked_overdue || result.cleared
          ? `عُلّمت ${count(result.marked_overdue)} دفعة متأخرة` +
              (result.cleared ? ` وأُعيدت ${count(result.cleared)} إلى مستحقّة` : "")
          : "حالات التأخير محدّثة — لا تغيير",
      );
      state.reload();
    } catch (err) {
      toast.err(err instanceof Error ? err.message : "تعذّر التحديث");
    } finally {
      setBusy(false);
    }
  }

  // Only `as_of` reaches the server — it decides what "late" means. The rest
  // narrows the rows already fetched, so typing stays instant.
  const all = state.data ?? [];
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const floor = Number(minLate) || 0;
    return all.filter((row) => {
      if (type && row.contract_type !== type) return false;
      if (floor && row.days_late < floor) return false;
      if (!needle) return true;
      return (
        (row.client_name ?? "").toLowerCase().includes(needle) ||
        (row.contract_no ?? "").toLowerCase().includes(needle)
      );
    });
  }, [all, q, type, minLate]);

  // The search box: typed text, plus as-of date, contract type and lateness under فلاتر.
  const searchValues: SearchValues = { q, contract_type: type, as_of: asOf === today() ? "" : asOf, min_late: minLate };
  const searchSpecs: SearchSpec[] = [
    { kind: "text", key: "q", label: "العميل / رقم العقد" },
    {
      kind: "choice", key: "contract_type", label: "نوع العقد",
      options: Object.entries(CONTRACT_TYPE_AR).map(([value, label]) => ({ value, label })),
    },
    { kind: "input", key: "as_of", label: "حتى تاريخ", type: "date" },
    { kind: "input", key: "min_late", label: "تأخير لا يقل عن (يوم)", type: "number", placeholder: "30" },
  ];
  function onSearch(patch: SearchValues) {
    const setters: Record<string, (value: string) => void> = {
      q: setQ, contract_type: setType, as_of: (value) => setAsOf(value || today()), min_late: setMinLate,
    };
    for (const [key, value] of Object.entries(patch)) setters[key]?.(value);
  }

  return (
    <>
      <Head
        title="جدول الدفعات"
        subtitle="الاستحقاقات المتأخرة عبر كل العقود"
        actions={
          can("schedule.manage") ? (
            <>
              <button className="btn" onClick={refreshOverdue} disabled={busy}>
                تحديث حالات التأخير
              </button>
              <button className="btn primary" onClick={invoiceRent} disabled={busy}>
                فوترة الإيجارات المستحقّة
              </button>
            </>
          ) : null
        }
      />

      <SearchPanel
        specs={searchSpecs}
        values={searchValues}
        onChange={onSearch}
        placeholder="ابحث باسم العميل أو رقم العقد…"
        summary={<ResultCount shown={rows.length} total={all.length} noun="دفعة" />}
        actions={
          <ExportButtons
            filename="overdue"
            headers={["العميل", "العقد", "النوع", "الاستحقاق", "أيام التأخير", "القسط", "المدفوع", "المتبقّي"]}
            disabled={rows.length === 0}
            rows={() =>
              rows.map((row) => [
                row.client_name,
                row.contract_no,
                CONTRACT_TYPE_AR[row.contract_type],
                isoDate(row.due_date),
                row.days_late,
                row.amount,
                row.paid_amount,
                row.outstanding,
              ])
            }
          />
        }
      />

      <Async state={state}>
        {() => {
          const outstanding = rows.reduce((sum, r) => sum + num(r.outstanding), 0);
          const clients = new Set(rows.map((r) => r.client_id)).size;
          const worst = rows.reduce((max, r) => Math.max(max, r.days_late), 0);

          return (
            <>
              <div className="tiles">
                <Tile tone="c" label="إجمالي المتأخر" value={money(outstanding, 0)} sub="$ — بالعملة الأساسية" />
                <Tile tone="a" label="عدد الدفعات" value={count(rows.length)} sub="دفعة متأخرة" />
                <Tile tone="d" label="عدد العملاء" value={count(clients)} sub="عميل عليه متأخرات" />
                <Tile tone="b" label="أقدم تأخير" value={count(worst)} sub="يوم" />
              </div>

              <Card title="الدفعات المتأخرة">
                {rows.length === 0 ? (
                  <Empty
                    title={all.length ? "لا دفعات مطابقة" : "لا متأخرات"}
                    hint={all.length ? "جرّب مسح الفلاتر." : "كل الاستحقاقات مسدّدة حتى هذا التاريخ."}
                  />
                ) : (
                  <div className="tbl-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>العميل</th>
                          <th>العقد</th>
                          <th>الاستحقاق</th>
                          <th>التأخير</th>
                          <th className="num">القسط</th>
                          <th className="num">المدفوع</th>
                          <th className="num">المتبقّي</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.id}>
                            <td className="nm">
                              <Link href={`/clients/${row.client_id}`}>{row.client_name}</Link>
                            </td>
                            <td>
                              <Doc>{row.contract_no}</Doc>
                              <div className="sub">{CONTRACT_TYPE_AR[row.contract_type]}</div>
                            </td>
                            <td><Doc>{isoDate(row.due_date)}</Doc></td>
                            <td>
                              <Pill tone={schedulePill("pending", row.days_late)}>
                                {lateLabel(row.days_late)}
                              </Pill>
                            </td>
                            <td className="num mono">{money(row.amount)}</td>
                            <td className="num mono" style={{ color: "var(--credit)" }}>
                              {num(row.paid_amount) ? money(row.paid_amount) : "—"}
                            </td>
                            <td className="num">
                              <Amount value={row.outstanding} tone="dr" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <PrintFooter title="الدفعات المتأخرة" />
              </Card>
            </>
          );
        }}
      </Async>
    </>
  );
}
