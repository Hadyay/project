"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";

import { Amount, Async, Card, Doc, ErrorNote, Head, Pill } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  CONTRACT_STATUS_AR,
  CONTRACT_TYPE_AR,
  SCHEDULE_STATUS_AR,
  contractPill,
  count,
  isoDate,
  money,
  num,
  schedulePill,
  today,
} from "@/lib/format";
import type { ContractDetail, ScheduleRow } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function ContractPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { can } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const contract = useApi(
    useCallback(() => api.get<ContractDetail>(`/api/contracts/${id}`), [id]),
    [id],
  );
  const schedule = useApi(
    useCallback(() => api.get<ScheduleRow[]>(`/api/contracts/${id}/schedule`), [id]),
    [id],
  );

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/contracts/${id}/activate`);
      contract.reload();
      schedule.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر التفعيل");
    } finally {
      setBusy(false);
    }
  }

  async function invoicePeriod(rowId: number) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/contracts/${id}/schedule/${rowId}/invoice`);
      schedule.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّرت الفوترة");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Async state={contract}>
      {(data) => (
        <>
          <Head
            title={`عقد ${CONTRACT_TYPE_AR[data.contract_type]} — ${data.contract_no}`}
            subtitle={`${data.building_name ?? ""} ${data.unit_no ? `— ${data.unit_no}` : ""}`.trim()}
            actions={
              <>
                <Link className="btn" href="/contracts">← العقود</Link>
                {data.status === "draft" && can("contracts.activate") ? (
                  <button className="btn primary" onClick={activate} disabled={busy}>
                    تفعيل العقد
                  </button>
                ) : null}
                {can("receipts.create") ? (
                  <Link className="btn brass" href={`/receipts?client_id=${data.client_id}&contract_id=${data.id}`}>
                    تسجيل قبض
                  </Link>
                ) : null}
              </>
            }
          />

          {error ? <ErrorNote message={error} /> : null}

          {data.status === "draft" ? (
            <div className="note">
              <span>◈</span>
              <span>
                العقد مسودّة — لم يُسجَّل بعد في دفتر الأستاذ. التفعيل يقيّد قيمة البيع على ذمة العميل
                ويحوّل حالة الوحدة.
              </span>
            </div>
          ) : null}

          <div className="profile">
            <div className="card profile-card">
              <div className="card-h"><h3>تفاصيل العقد</h3></div>
              <div className="card-b">
                <div className="kv">
                  <span>الحالة</span>
                  <b><Pill tone={contractPill(data.status)}>{CONTRACT_STATUS_AR[data.status]}</Pill></b>
                </div>
                <div className="kv"><span>العميل</span>
                  <b><Link href={`/clients/${data.client_id}`}>{data.client_name ?? "—"}</Link></b></div>
                <div className="kv"><span>الوحدة</span><b className="mono">{data.unit_no ?? "—"}</b></div>
                <div className="kv"><span>التوقيع</span><b className="mono">{isoDate(data.sign_date)}</b></div>
                <div className="kv"><span>البدء</span><b className="mono">{isoDate(data.start_date)}</b></div>
                {data.end_date ? (
                  <div className="kv"><span>الانتهاء</span><b className="mono">{isoDate(data.end_date)}</b></div>
                ) : null}
              </div>
            </div>

            <div className="card profile-card">
              <div className="card-h"><h3>الأرقام</h3></div>
              <div className="card-b">
                {data.contract_type === "sale" ? (
                  <>
                    <div className="kv"><span>قيمة البيع</span><b className="mono">{money(data.total_amount)}</b></div>
                    <div className="kv"><span>الدفعة الأولى</span><b className="mono">{money(data.down_payment)}</b></div>
                    <div className="kv"><span>عدد الأقساط</span><b className="mono">{count(data.installment_count ?? 0)}</b></div>
                  </>
                ) : (
                  <>
                    <div className="kv"><span>الإيجار الشهري</span><b className="mono">{money(data.monthly_rent)}</b></div>
                    <div className="kv"><span>التأمين</span><b className="mono">{money(data.deposit)}</b></div>
                  </>
                )}
                <div className="kv">
                  <span>المحصّل</span>
                  <b className="mono" style={{ color: "var(--credit)" }}>{money(data.paid_total)}</b>
                </div>
                <div className="kv">
                  <span>المتبقّي</span>
                  <b className="mono" style={{ color: "var(--debit)" }}>{money(data.outstanding_total)}</b>
                </div>
              </div>
            </div>
          </div>

          <Card title="جدول الدفعات">
            <Async state={schedule}>
              {(rows) =>
                rows.length === 0 ? (
                  <div className="empty">
                    <h4>لا جدول دفعات</h4>
                    <p>لم يُنشأ جدول لهذا العقد.</p>
                  </div>
                ) : (
                  <div className="card-b">
                    <div className="sched">
                      {rows.map((row) => {
                        const paid = num(row.paid_amount);
                        const amount = num(row.amount);
                        const filled = amount ? Math.min(100, (paid / amount) * 100) : 0;
                        const daysLate =
                          row.status !== "paid" && row.due_date < today()
                            ? Math.floor(
                                (Date.parse(today()) - Date.parse(row.due_date)) / 86_400_000,
                              )
                            : 0;

                        return (
                          <div className="sched-row" key={row.id}>
                            <div
                              className={`sched-n${row.status === "paid" ? " paid" : daysLate > 0 ? " late" : ""}`}
                            >
                              {row.seq_no}
                            </div>

                            <div style={{ minWidth: 96 }}>
                              <Doc>{isoDate(row.due_date)}</Doc>
                            </div>

                            <div className="sched-bar">
                              <i style={{ width: `${filled}%` }} />
                            </div>

                            <div style={{ minWidth: 92, textAlign: "left" }}>
                              <Amount value={row.amount} sub={paid ? `دُفع ${money(paid)}` : undefined} />
                            </div>

                            <div style={{ minWidth: 96 }}>
                              <Pill tone={schedulePill(row.status, daysLate)}>
                                {SCHEDULE_STATUS_AR[row.status]}
                              </Pill>
                            </div>

                            {data.contract_type === "rent" && can("schedule.manage") ? (
                              <button
                                className="btn sm"
                                disabled={busy}
                                onClick={() => invoicePeriod(row.id)}
                                title="تسجيل إيراد هذه الفترة في دفتر الأستاذ"
                              >
                                فوترة
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )
              }
            </Async>
          </Card>
        </>
      )}
    </Async>
  );
}
