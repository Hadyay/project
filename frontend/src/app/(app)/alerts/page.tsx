"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { ExportButtons, PrintFooter, ResultCount } from "@/components/Filters";
import { SearchPanel, fold, type SearchSpec, type SearchValues } from "@/components/SearchPanel";
import { useToast } from "@/components/Toast";
import { Async, Card, Empty, ErrorNote, Field, Head, Modal, Pill, Tile } from "@/components/ui";
import { monthsLabel } from "@/lib/alerts";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { count, dmy, money, num } from "@/lib/format";
import type { AlertsReport, LateClient } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const REASON_AR: Record<LateClient["reason"], string> = {
  no_payment: "لم يدفع هذا الشهر",
  short: "دفع أقل من القسط",
  overdue_installment: "قسط عقد متأخر",
};

/** التنبيهات — every client who owes and has not paid in the current cycle
 *  (app/services/reminders.py), in red, with a "reminded" mark per month. */
export default function AlertsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const state = useApi(useCallback(() => api.get<AlertsReport>("/api/alerts"), []), []);
  const [marking, setMarking] = useState<LateClient | null>(null);

  const [q, setQ] = useState("");
  const [reminded, setReminded] = useState("");
  const [reason, setReason] = useState("");
  const [project, setProject] = useState("");
  const [minMonths, setMinMonths] = useState("");

  const all = state.data?.rows ?? [];
  const rows = useMemo(() => {
    const needle = fold(q);
    return all.filter((row) => {
      if (reminded === "yes" && !row.reminded_at) return false;
      if (reminded === "no" && row.reminded_at) return false;
      if (reason && row.reason !== reason) return false;
      if (project && row.project !== project) return false;
      if (minMonths && (row.months_unpaid ?? 10_000) < Number(minMonths)) return false;
      if (!needle) return true;
      return [row.name, row.code, row.phone, row.project, row.block].some((v) => v && fold(v).includes(needle));
    });
  }, [all, q, reminded, reason, project, minMonths]);

  const projects = Array.from(new Set(all.map((r) => r.project).filter(Boolean))) as string[];
  const searchValues: SearchValues = { q, reminded, reason, project, min_months: minMonths };
  const searchSpecs: SearchSpec[] = [
    { kind: "text", key: "q", label: "الاسم / الرمز / الهاتف / المشروع" },
    {
      kind: "choice",
      key: "reminded",
      label: "التذكير",
      suggest: false,
      options: [
        { value: "no", label: "لم يُذكَّر بعد" },
        { value: "yes", label: "تم التذكير" },
      ],
    },
    {
      kind: "choice",
      key: "reason",
      label: "السبب",
      suggest: false,
      options: Object.entries(REASON_AR).map(([value, label]) => ({ value, label })),
    },
    { kind: "choice", key: "project", label: "المشروع", options: projects.map((p) => ({ value: p, label: p })) },
    { kind: "input", key: "min_months", label: "متأخر على الأقل (أشهر)", type: "number", placeholder: "2" },
  ];
  function onSearch(patch: SearchValues) {
    const setters: Record<string, (value: string) => void> = {
      q: setQ,
      reminded: setReminded,
      reason: setReason,
      project: setProject,
      min_months: setMinMonths,
    };
    for (const [key, value] of Object.entries(patch)) setters[key]?.(value);
  }

  async function unmark(row: LateClient) {
    try {
      await api.del(`/api/alerts/clients/${row.client_id}/remind`);
      toast.ok(`أُلغي تسجيل التذكير — ${row.name}`);
      state.reload();
    } catch (err) {
      toast.err(err instanceof Error ? err.message : "تعذّر التنفيذ");
    }
  }

  return (
    <>
      <Head
        title="التنبيهات — الدفعات غير المسدّدة"
        subtitle={
          state.data
            ? `دورة شهر ${state.data.cycle.period} — التنبيه يوم ${state.data.alert_day} من كل شهر · فُتحت ${dmy(state.data.cycle.alert_date)} · التالية ${dmy(state.data.cycle.next_alert_date)}`
            : "العملاء الذين لم يدفعوا دفعة الشهر"
        }
        actions={
          can("settings.alerts") ? (
            <Link className="btn" href="/settings?tab=alerts">
              ⚙ إعداد التنبيه
            </Link>
          ) : null
        }
      />

      <Async state={state}>
        {(data) =>
          !data.enabled ? (
            <Card>
              <Empty
                title="التنبيهات متوقفة"
                hint="فعّلها من الإعدادات ← التنبيهات، واختر يوم التنبيه من كل شهر."
              />
            </Card>
          ) : (
            <>
              <div className="tiles">
                <Tile label="عملاء لم يدفعوا" value={count(data.count)} sub={`في دورة ${data.cycle.period}`} tone="c" />
                <Tile label="إجمالي أرصدتهم" value={money(data.total_balance, 0)} sub="$ — المستحق عليهم" tone="a" />
                <Tile
                  label="تم تذكيرهم"
                  value={`${count(data.reminded_count)} / ${count(data.count)}`}
                  sub="هذا الشهر"
                  tone="b"
                />
                <Tile
                  label="لم يدفعوا أبداً"
                  value={count(data.rows.filter((r) => r.months_unpaid === null).length)}
                  sub="منذ فتح الحساب"
                  tone="d"
                />
              </div>

              <SearchPanel
                specs={searchSpecs}
                values={searchValues}
                onChange={onSearch}
                placeholder="ابحث بالاسم، الرمز، الهاتف أو المشروع…"
                summary={<ResultCount shown={rows.length} total={all.length} noun="عميل" />}
                actions={
                  <ExportButtons
                    filename={`late-clients-${data.cycle.period}`}
                    headers={["الرمز", "العميل", "الهاتف", "المشروع", "بلوك", "الرصيد", "القسط الشهري", "المدفوع هذا الشهر", "آخر دفعة", "الحالة", "التذكير"]}
                    disabled={rows.length === 0}
                    rows={() =>
                      rows.map((r) => [
                        r.code,
                        r.name,
                        r.phone,
                        r.project,
                        r.block,
                        r.balance,
                        r.monthly_installment,
                        r.paid_this_cycle,
                        r.last_payment_date,
                        monthsLabel(r.months_unpaid),
                        r.reminded_at ? `تم — ${r.reminded_by ?? ""}` : "",
                      ])
                    }
                  />
                }
              />

              <Card>
                {rows.length === 0 ? (
                  <Empty
                    title={all.length ? "لا عملاء مطابقون" : "كل العملاء دفعوا هذا الشهر"}
                    hint={all.length ? "جرّب مسح الفلاتر." : "لا تنبيهات في هذه الدورة."}
                  />
                ) : (
                  <div className="tbl-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>العميل</th>
                          <th>المشروع · البلوك</th>
                          <th className="num">الرصيد</th>
                          <th className="num">المدفوع هذا الشهر</th>
                          <th>آخر دفعة</th>
                          <th>الحالة</th>
                          <th>التذكير</th>
                          <th className="no-print" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.client_id} className="late">
                            <td>
                              <div className="nm" translate="no">
                                <Link href={`/clients/${row.client_id}`}>{row.name}</Link>
                              </div>
                              <span className="sub">
                                <span className="mono">{row.code}</span>
                                {row.phone ? (
                                  <>
                                    {" · ☎ "}
                                    <span className="mono">{row.phone}</span>
                                  </>
                                ) : null}
                              </span>
                            </td>
                            <td className="sub" translate="no">
                              {[row.project, row.block].filter(Boolean).join(" · ") || "—"}
                            </td>
                            <td className="num">
                              <b className="mono" style={{ color: "var(--debit)" }}>
                                {money(row.balance)}
                              </b>
                            </td>
                            <td className="num">
                              <span className="mono">{num(row.paid_this_cycle) ? money(row.paid_this_cycle) : "0"}</span>
                              {row.monthly_installment ? (
                                <div className="sub">
                                  من قسط <span className="mono">{money(row.monthly_installment)}</span>
                                </div>
                              ) : null}
                            </td>
                            <td>
                              <span className="mono">{row.last_payment_date ? dmy(row.last_payment_date) : "—"}</span>
                            </td>
                            <td>
                              <Pill tone="late">{monthsLabel(row.months_unpaid)}</Pill>
                              {row.reason !== "no_payment" ? <div className="sub">{REASON_AR[row.reason]}</div> : null}
                            </td>
                            <td>
                              {row.reminded_at ? (
                                <div>
                                  <Pill tone="ok">✓ تم التذكير</Pill>
                                  <div className="sub">
                                    <span className="mono">{dmy(row.reminded_at)}</span> · {row.reminded_by}
                                  </div>
                                  {row.reminder_note ? (
                                    <div className="sub" translate="no">
                                      {row.reminder_note}
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="sub">لم يُذكَّر</span>
                              )}
                            </td>
                            <td className="num no-print" style={{ whiteSpace: "nowrap" }}>
                              {can("alerts.manage") ? (
                                row.reminded_at ? (
                                  <button className="btn sm" onClick={() => unmark(row)}>
                                    إلغاء التذكير
                                  </button>
                                ) : (
                                  <button className="btn sm primary" onClick={() => setMarking(row)}>
                                    تم التذكير
                                  </button>
                                )
                              ) : null}{" "}
                              {can("receipts.create") ? (
                                <Link className="btn sm" href={`/receipts?client_id=${row.client_id}`}>
                                  قبض
                                </Link>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <PrintFooter title={`العملاء المتأخرون — ${data.cycle.period}`} />
              </Card>
            </>
          )
        }
      </Async>

      {marking ? (
        <RemindForm
          row={marking}
          onClose={() => setMarking(null)}
          onSaved={(message) => {
            setMarking(null);
            toast.ok(message);
            state.reload();
          }}
        />
      ) : null}
    </>
  );
}

function RemindForm({
  row,
  onClose,
  onSaved,
}: {
  row: LateClient;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/alerts/clients/${row.client_id}/remind`, { note: note.trim() || null });
      onSaved(`سُجّل التذكير — ${row.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر الحفظ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`تم تذكير ${row.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? "جارٍ الحفظ…" : "تسجيل التذكير"}
          </button>
          <button className="btn" onClick={onClose}>
            إلغاء
          </button>
        </>
      }
    >
      {error ? <ErrorNote message={error} /> : null}
      <p className="sub" style={{ marginBottom: 10 }}>
        {row.phone ? `الهاتف: ${row.phone} — ` : ""}الرصيد {money(row.balance)} $ — {monthsLabel(row.months_unpaid)}
      </p>
      <Field label="ملاحظة" hint="اختياري — مثلاً: وعد بالدفع يوم ١٠">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}
