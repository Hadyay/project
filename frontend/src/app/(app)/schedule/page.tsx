"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";

import { BulkReceipts, type BulkClient } from "@/components/BulkReceipts";
import { useConfirm } from "@/components/Confirm";
import { ExportButtons, PrintFooter, ResultCount } from "@/components/Filters";
import { SearchPanel, type SearchSpec, type SearchValues } from "@/components/SearchPanel";
import { useToast } from "@/components/Toast";
import { Amount, Async, Card, Doc, Empty, Head, Modal, Pill, Tile } from "@/components/ui";
import { monthsLabel } from "@/lib/alerts";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CONTRACT_TYPE_AR, METHOD_AR, count, isoDate, lateLabel, money, num, schedulePill, today } from "@/lib/format";
import { useLang, type Lang } from "@/lib/i18n";
import type {
  BulkRemindResult,
  ContractType,
  GridCell,
  GridRow,
  GridStatus,
  OverdueRefresh,
  OverdueRow,
  Page,
  PaymentGrid,
  ReceiptDetail,
  RentInvoiceRun,
} from "@/lib/types";
import { useApi } from "@/lib/useApi";

/* ------------------------------------------------------------------ the page */

type ScheduleTab = "grid" | "contracts";

export default function SchedulePage() {
  return (
    <Suspense fallback={<div className="loading">جارٍ التحميل…</div>}>
      <ScheduleInner />
    </Suspense>
  );
}

/** جدول الدفعات — two views of who pays when:
 *  - دفعات العملاء الشهرية: built from the receipts (the old system had no
 *    contracts, but 2,041 receipts), a client per row, a month per column.
 *  - أقساط العقود: the installments of real contracts, when there are some. */
function ScheduleInner() {
  const router = useRouter();
  const tab: ScheduleTab = useSearchParams().get("tab") === "contracts" ? "contracts" : "grid";
  const open = (next: ScheduleTab) => router.replace(next === "grid" ? "/schedule" : "/schedule?tab=contracts", { scroll: false });

  return (
    <>
      <div className="tabs no-print">
        <button className={tab === "grid" ? "on" : ""} onClick={() => open("grid")}>
          دفعات العملاء الشهرية
        </button>
        <button className={tab === "contracts" ? "on" : ""} onClick={() => open("contracts")}>
          أقساط العقود
        </button>
      </div>
      {tab === "grid" ? <GridTab /> : <InstallmentsTab />}
    </>
  );
}

/* ------------------------------------------------------------ monthly grid */

const STATUS_AR: Record<GridStatus, string> = {
  paid: "دفع",
  short: "دفع أقل من القسط",
  unpaid: "لم يدفع",
  settled: "لا شيء مستحق",
  before: "قبل أول قيد",
  future: "لم يأتِ بعد",
};

/** 2500 → "2,500"; 107000 → "107k": a month cell has room for five characters. */
function compact(value: number): string {
  if (value >= 100_000) return `${Math.round(value / 1000)}k`;
  if (value >= 10_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return money(value, 0);
}

function monthLabel(period: string, lang: Lang): string {
  const [y, m] = period.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "ar-LB-u-nu-latn", { month: "long", year: "numeric" }).format(
    new Date(y, m - 1, 1),
  );
}

function monthRange(period: string): { from: string; to: string } {
  const [y, m] = period.split("-").map(Number);
  return { from: `${period}-01`, to: `${period}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}` };
}

function GridTab() {
  const { can } = useAuth();
  const { lang } = useLang();
  const toast = useToast();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [q, setQ] = useState("");
  const [project, setProject] = useState("");
  const [only, setOnly] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [cell, setCell] = useState<{ row: GridRow; cell: GridCell } | null>(null);
  const [bulk, setBulk] = useState<BulkClient[] | null>(null);

  // A past year is read as of its last day, so no month shows as "future".
  const state = useApi(
    useCallback(
      () =>
        api.get<PaymentGrid>("/api/schedule/grid", {
          year,
          as_of: year < thisYear ? `${year}-12-31` : undefined,
          q: q.trim() || undefined,
          project: project || undefined,
          only_late: only === "late" ? true : undefined,
        }),
      [year, thisYear, q, project, only],
    ),
    [year, q, project, only],
  );
  const data = state.data;
  const rows = data?.rows ?? [];
  const filtered = Boolean(q.trim() || project || only);

  const searchValues: SearchValues = { q, project, only };
  const searchSpecs: SearchSpec[] = [
    { kind: "text", key: "q", label: "الاسم / الرمز / الهاتف / المشروع" },
    {
      kind: "choice",
      key: "project",
      label: "المشروع",
      options: (data?.projects ?? []).map((p) => ({ value: p, label: p })),
    },
    {
      kind: "choice",
      key: "only",
      label: "العرض",
      suggest: false,
      options: [{ value: "late", label: "المتأخرون فقط" }],
    },
  ];
  function onSearch(patch: SearchValues) {
    const setters: Record<string, (value: string) => void> = { q: setQ, project: setProject, only: setOnly };
    for (const [key, value] of Object.entries(patch)) setters[key]?.(value);
    setPicked(new Set());
  }

  const totals = data?.totals ?? [];
  const collected = totals.reduce((sum, t) => sum + num(t.paid_amount), 0);
  const lastMonth = [...totals].reverse().find((t) => t.owing_clients > 0);
  const lateNow = rows.filter((r) => r.late).length;
  const nothingThisYear = year === thisYear && collected === 0 && !filtered;

  const toBulk = (r: GridRow): BulkClient => ({
    client_id: r.client_id,
    name: r.name,
    code: r.code,
    balance: r.balance,
    monthly_installment: r.monthly_installment,
  });

  function toggle(id: number) {
    setPicked((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.client_id));

  /** The sheet opens with the ticked clients, or — nothing ticked — with every
   *  client late on the screen: that is who a month's collection round visits. */
  function openBulk() {
    const chosen = picked.size ? rows.filter((r) => picked.has(r.client_id)) : rows.filter((r) => r.late);
    setBulk(chosen.map(toBulk));
  }

  async function remindPicked() {
    try {
      const result = await api.post<BulkRemindResult>("/api/alerts/remind/bulk", { client_ids: [...picked] });
      toast.ok(`سُجّل التذكير لـ ${count(result.count)} عميل — دورة ${result.period}`);
      setPicked(new Set());
    } catch (err) {
      toast.err(err instanceof Error ? err.message : "تعذّر التنفيذ");
    }
  }

  return (
    <>
      <Head
        title="جدول الدفعات — دفعات العملاء الشهرية"
        subtitle="كل عميل في سطر وكل شهر في عمود، من الوصولات المسجّلة. الأحمر: كان عليه رصيد في بداية الشهر ولم يدفع."
        actions={
          <>
            <div className="month-nav year-nav no-print">
              <button className="btn sm" onClick={() => setYear(year - 1)} title="السنة السابقة">
                {lang === "en" ? "‹" : "›"}
              </button>
              <b className="mono">{year}</b>
              <button className="btn sm" onClick={() => setYear(year + 1)} disabled={year >= thisYear} title="السنة التالية">
                {lang === "en" ? "›" : "‹"}
              </button>
            </div>
            {can("receipts.create") ? (
              <button className="btn primary" onClick={openBulk} disabled={!rows.length}>
                {picked.size ? `تسجيل دفعات المحدّدين (${count(picked.size)})` : "تسجيل دفعات الشهر"}
              </button>
            ) : null}
          </>
        }
      />

      {nothingThisYear ? (
        <div className="note no-print">
          <span>◈</span>
          <span>
            {`لا وصولات مسجّلة في ${year} بعد — السجل المستورد ينتهي في ${year - 1}.`}{" "}
            <button className="btn sm" onClick={() => setYear(year - 1)}>
              {`عرض ${year - 1}`}
            </button>
          </span>
        </div>
      ) : null}

      <div className="tiles">
        <Tile label={`المحصّل في ${year}`} value={money(collected, 0)} sub="$ — كل الوصولات" tone="b" />
        <Tile
          label={lastMonth ? `نسبة من دفع — ${lastMonth.period}` : "نسبة من دفع"}
          value={lastMonth ? `${num(lastMonth.rate).toFixed(0)}%` : "—"}
          sub={lastMonth ? `${count(lastMonth.paid_clients)} من ${count(lastMonth.owing_clients)} عميل مدين` : ""}
          tone="a"
        />
        <Tile label="متأخرون الآن" value={count(lateNow)} sub={`من ${count(rows.length)} عميل في الجدول`} tone="c" />
        <Tile
          label={`لم يدفعوا شيئاً في ${year}`}
          value={count(rows.filter((r) => num(r.total_paid) === 0 && r.cells.some((c) => c.status === "unpaid")).length)}
          sub="عليهم رصيد طوال السنة"
          tone="d"
        />
      </div>

      <SearchPanel
        specs={searchSpecs}
        values={searchValues}
        onChange={onSearch}
        placeholder="ابحث بالاسم، الرمز، الهاتف أو المشروع…"
        summary={<ResultCount shown={rows.length} total={rows.length} noun="عميل" />}
        actions={
          <ExportButtons
            filename={`payment-grid-${year}`}
            headers={["الرمز", "العميل", "الهاتف", "المشروع", "الرصيد", ...(data?.months ?? []), "المجموع"]}
            disabled={rows.length === 0}
            rows={() =>
              rows.map((r) => [
                r.code,
                r.name,
                r.phone,
                r.project,
                r.balance,
                ...r.cells.map((c) => (num(c.paid) > 0 ? c.paid : c.status === "unpaid" ? "لم يدفع" : "")),
                r.total_paid,
              ])
            }
          />
        }
      />

      {picked.size ? (
        <div className="pick-bar no-print">
          <b>{`${count(picked.size)} محدّد`}</b>
          {can("receipts.create") ? (
            <button className="btn sm primary" onClick={openBulk}>
              تسجيل دفعاتهم
            </button>
          ) : null}
          {can("alerts.manage") ? (
            <button className="btn sm" onClick={remindPicked}>
              تم التذكير للمحدّدين
            </button>
          ) : null}
          <button className="btn sm" onClick={() => setPicked(new Set())}>
            إلغاء التحديد
          </button>
        </div>
      ) : null}

      <Card>
        {state.loading && !data ? (
          <div className="loading">جارٍ التحميل…</div>
        ) : state.error ? (
          <div className="card-b">
            <div className="alert err">{state.error}</div>
          </div>
        ) : rows.length === 0 ? (
          <Empty
            title={filtered ? "لا عملاء مطابقون" : "لا عملاء في الجدول"}
            hint={filtered ? "جرّب مسح الفلاتر." : "يظهر هنا كل عميل عليه قيد في ذمته."}
          />
        ) : (
          <div className="tbl-wrap">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="gt-pick no-print">
                    <input
                      type="checkbox"
                      checked={allPicked}
                      onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.client_id)))}
                      aria-label="تحديد الكل"
                    />
                  </th>
                  <th className="gt-client">العميل</th>
                  {data!.months.map((m) => (
                    <th key={m} className="gt-m" title={monthLabel(m, lang)}>
                      {Number(m.slice(5))}
                    </th>
                  ))}
                  <th className="num">المجموع</th>
                  <th className="num">الرصيد</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.client_id} className={picked.has(r.client_id) ? "picked" : undefined}>
                    <td className="gt-pick no-print">
                      <input
                        type="checkbox"
                        checked={picked.has(r.client_id)}
                        onChange={() => toggle(r.client_id)}
                        aria-label={`تحديد ${r.name}`}
                      />
                    </td>
                    <td className="gt-client">
                      <div className="nm" translate="no">
                        <Link href={`/statement?client=${r.client_id}`}>{r.name}</Link>
                      </div>
                      <span className="sub">
                        <span className="mono">{r.code}</span>
                        {r.project ? <span translate="no">{` · ${r.project}`}</span> : null}
                        {r.late ? (
                          <>
                            {" · "}
                            <span className="late-txt">{monthsLabel(r.late_months)}</span>
                          </>
                        ) : null}
                      </span>
                    </td>
                    {r.cells.map((c) => {
                      const paid = num(c.paid);
                      const clickable = c.status === "paid" || c.status === "short" || c.status === "unpaid";
                      return (
                        <td
                          key={c.period}
                          className={`gc ${c.status}${clickable ? " click" : ""}`}
                          title={`${monthLabel(c.period, lang)} — ${STATUS_AR[c.status]}${paid ? ` — ${money(paid)} (${c.receipts} وصل)` : ""}`}
                          onClick={clickable ? () => setCell({ row: r, cell: c }) : undefined}
                        >
                          {paid > 0 ? compact(paid) : c.status === "unpaid" ? "✗" : c.status === "settled" ? "·" : ""}
                        </td>
                      );
                    })}
                    <td className="num">
                      <b className="mono">{num(r.total_paid) ? money(r.total_paid, 0) : "0"}</b>
                    </td>
                    <td className="num">
                      <span className="mono" style={{ color: num(r.balance) > 0 ? "var(--debit)" : undefined }}>
                        {money(r.balance, 0)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="no-print" />
                  <td>المحصّل</td>
                  {totals.map((t) => (
                    <td key={t.period} className="gt-sum mono">
                      {num(t.paid_amount) ? compact(num(t.paid_amount)) : "—"}
                    </td>
                  ))}
                  <td className="num mono">{money(collected, 0)}</td>
                  <td />
                </tr>
                <tr>
                  <td className="no-print" />
                  <td>نسبة من دفع</td>
                  {totals.map((t) => {
                    const rate = num(t.rate);
                    return (
                      <td
                        key={t.period}
                        className={`gt-rate mono ${t.owing_clients ? (rate >= 70 ? "good" : rate >= 40 ? "mid" : "low") : ""}`}
                        title={`${t.paid_clients} / ${t.owing_clients}`}
                      >
                        {t.owing_clients ? `${rate.toFixed(0)}%` : "—"}
                      </td>
                    );
                  })}
                  <td />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <div className="grid-legend">
          <span>
            <i className="gc paid" /> دفع
          </span>
          <span>
            <i className="gc short" /> أقل من القسط
          </span>
          <span>
            <i className="gc unpaid" /> لم يدفع
          </span>
          <span>
            <i className="gc settled" /> لا شيء مستحق
          </span>
          <span>
            <i className="gc before" /> قبل أول قيد
          </span>
          <span className="sub">اضغط على خانة لعرض وصولات ذلك الشهر.</span>
        </div>
        <PrintFooter title={`جدول الدفعات ${year}`} />
      </Card>

      {cell ? (
        <CellDetail
          row={cell.row}
          cell={cell.cell}
          onClose={() => setCell(null)}
          onReceipt={() => {
            setBulk([toBulk(cell.row)]);
            setCell(null);
          }}
        />
      ) : null}

      {bulk ? (
        <BulkReceipts
          clients={bulk}
          onClose={() => setBulk(null)}
          onDone={() => {
            setPicked(new Set());
            state.reload();
          }}
        />
      ) : null}
    </>
  );
}

/** One month of one client: the receipts behind the cell, or what to do about
 *  a red one. */
function CellDetail({
  row,
  cell,
  onClose,
  onReceipt,
}: {
  row: GridRow;
  cell: GridCell;
  onClose: () => void;
  onReceipt: () => void;
}) {
  const { can } = useAuth();
  const { lang } = useLang();
  const range = monthRange(cell.period);
  const state = useApi(
    useCallback(
      () =>
        api.get<Page<ReceiptDetail>>("/api/receipts", {
          client_id: row.client_id,
          date_from: range.from,
          date_to: range.to,
          limit: 100,
        }),
      [row.client_id, range.from, range.to],
    ),
    [row.client_id, cell.period],
  );

  return (
    <Modal
      title={`${row.name} — ${monthLabel(cell.period, lang)}`}
      onClose={onClose}
      footer={
        <>
          {can("receipts.create") ? (
            <button className="btn primary" onClick={onReceipt}>
              تسجيل قبض
            </button>
          ) : null}
          <Link className="btn" href={`/statement?client=${row.client_id}`}>
            كشف الحساب
          </Link>
          <button className="btn" onClick={onClose}>
            إغلاق
          </button>
        </>
      }
    >
      <p className="sub" style={{ marginBottom: 10 }}>
        {`${STATUS_AR[cell.status]} · الرصيد الحالي ${money(row.balance)}`}
        {row.monthly_installment ? ` · القسط ${money(row.monthly_installment)}` : ""}
        {row.phone ? ` · ☎ ${row.phone}` : ""}
      </p>
      <Async state={state}>
        {(page) =>
          page.items.length === 0 ? (
            <Empty title="لا وصولات في هذا الشهر" hint="كان على العميل رصيد في بداية الشهر ولم يُسجَّل له أي وصل." />
          ) : (
            <div className="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>رقم السند</th>
                    <th>الطريقة</th>
                    <th className="num">المبلغ</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <span className="mono">{isoDate(r.receipt_date)}</span>
                      </td>
                      <td>
                        <b className="mono">{r.ref_no ?? r.receipt_no}</b>
                      </td>
                      <td>{METHOD_AR[r.method]}</td>
                      <td className="num">
                        <b className="mono">{money(r.amount)}</b>
                      </td>
                      <td className="num">
                        <Link className="btn sm" href={`/receipts/${r.id}/print`}>
                          ⎙ سند
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Async>
    </Modal>
  );
}

/* ------------------------------------------------------- contract installments */

/** The installments of real contracts: what is due, what is late. */
function InstallmentsTab() {
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
