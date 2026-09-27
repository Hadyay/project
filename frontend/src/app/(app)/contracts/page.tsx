"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { ExportButtons, PrintFooter, ResultCount, useClampedOffset } from "@/components/Filters";
import { SearchPanel, type SearchSpec, type SearchValues } from "@/components/SearchPanel";
import { ALL_ROWS, usePageSize } from "@/lib/paging";
import { useToast } from "@/components/Toast";
import { Amount, Async, Card, Doc, Empty, ErrorNote, Field, Head, Modal, Pager, Pill } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  CONTRACT_STATUS_AR,
  CONTRACT_TYPE_AR,
  contractPill,
  isoDate,
  today,
} from "@/lib/format";
import type {
  ApartmentWithBuilding,
  Client,
  Contract,
  ContractStatus,
  ContractType,
  Currency,
  Page,
} from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function ContractsPage() {
  const { can } = useAuth();
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = usePageSize("contracts");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const toast = useToast();

  const fetcher = useCallback(
    () =>
      api.get<Page<Contract>>("/api/contracts", {
        contract_type: type || undefined,
        contract_status: status || undefined,
        q: q || undefined,
        limit,
        offset,
      }),
    [type, status, q, offset, limit],
  );
  const state = useApi(fetcher, [type, status, q, offset, limit]);

  useClampedOffset(state.data?.total, offset, limit, setOffset);



  // The search box: typed text plus type and status under فلاتر.
  const searchValues: SearchValues = { q, contract_type: type, status };
  const searchSpecs: SearchSpec[] = [
    { kind: "text", key: "q", label: "العميل / رقم العقد / الوحدة" },
    {
      kind: "choice", key: "contract_type", label: "النوع",
      options: Object.entries(CONTRACT_TYPE_AR).map(([value, label]) => ({ value, label })),
    },
    {
      kind: "choice", key: "status", label: "الحالة",
      options: Object.entries(CONTRACT_STATUS_AR).map(([value, label]) => ({ value, label })),
    },
  ];
  function onSearch(patch: SearchValues) {
    const setters: Record<string, (value: string) => void> = {
      q: setQ, contract_type: setType, status: setStatus,
    };
    for (const [key, value] of Object.entries(patch)) setters[key]?.(value);
    setOffset(0);
  }

  return (
    <>
      <Head
        title="العقود"
        subtitle="عقود البيع والإيجار"
        actions={
          can("contracts.create") ? (
            <button className="btn primary" onClick={() => setCreating(true)}>
              + عقد جديد
            </button>
          ) : null
        }
      />

      <SearchPanel
        specs={searchSpecs}
        values={searchValues}
        onChange={onSearch}
        placeholder="ابحث باسم العميل، رقم العقد، رقم الوحدة…"
        summary={<ResultCount shown={state.data?.items.length ?? 0} total={state.data?.total ?? 0} noun="عقد" />}
        actions={
          <ExportButtons
            filename="contracts"
            headers={["رقم العقد", "النوع", "التوقيع", "البدء", "الانتهاء", "القيمة", "الإيجار الشهري", "الحالة"]}
            disabled={!state.data?.items.length}
            rows={() =>
              (state.data?.items ?? []).map((c) => [
                c.contract_no,
                CONTRACT_TYPE_AR[c.contract_type],
                isoDate(c.sign_date),
                isoDate(c.start_date),
                isoDate(c.end_date),
                c.total_amount,
                c.monthly_rent,
                CONTRACT_STATUS_AR[c.status],
              ])
            }
          />
        }
      />

      <Async state={state}>
        {(page) => (
          <Card>
            {page.items.length === 0 ? (
              <Empty title="لا عقود مطابقة" hint="أنشئ عقداً جديداً أو غيّر الفلاتر." />
            ) : (
              <>
                <div className="tbl-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>رقم العقد</th>
                        <th>النوع</th>
                        <th>التوقيع</th>
                        <th>المدة</th>
                        <th className="num">القيمة</th>
                        <th>الحالة</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {page.items.map((contract) => (
                        <tr key={contract.id}>
                          <td>
                            <Link href={`/contracts/${contract.id}`}>
                              <Doc>{contract.contract_no}</Doc>
                            </Link>
                          </td>
                          <td>
                            <Pill tone={contract.contract_type === "sale" ? "dark" : "ok"}>
                              {CONTRACT_TYPE_AR[contract.contract_type]}
                            </Pill>
                          </td>
                          <td><Doc>{isoDate(contract.sign_date)}</Doc></td>
                          <td className="sub">
                            {isoDate(contract.start_date)}
                            {contract.end_date ? ` ← ${isoDate(contract.end_date)}` : ""}
                          </td>
                          <td className="num">
                            <Amount
                              value={contract.contract_type === "sale" ? contract.total_amount : contract.monthly_rent}
                              sub={contract.contract_type === "rent" ? "شهرياً" : undefined}
                            />
                          </td>
                          <td>
                            <Pill tone={contractPill(contract.status)}>
                              {CONTRACT_STATUS_AR[contract.status]}
                            </Pill>
                          </td>
                          <td className="num no-print">
                            {can("contracts.edit") ? (
                              <button className="btn sm" onClick={() => setEditing(contract)}>
                                تعديل
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager total={page.total} limit={limit} offset={offset} onChange={setOffset} onLimitChange={setLimit} />
                <PrintFooter title="العقود" />
              </>
            )}
          </Card>
        )}
      </Async>

      {creating ? (
        <ContractForm
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            toast.ok("أُنشئ العقد");
            state.reload();
          }}
        />
      ) : null}

      {editing ? (
        <ContractEditForm
          key={editing.id}
          contract={editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            toast.ok(message);
            state.reload();
          }}
        />
      ) : null}
    </>
  );
}

function ContractForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const clients = useApi(useCallback(() => api.get<Page<Client>>("/api/clients", { limit: ALL_ROWS }), []), []);
  const currencies = useApi(useCallback(() => api.get<Currency[]>("/api/currencies"), []), []);
  // Only units that can actually be contracted — the API rejects the rest anyway.
  const units = useApi(
    useCallback(
      () => api.get<Page<ApartmentWithBuilding>>("/api/apartments", { limit: ALL_ROWS }),
      [],
    ),
    [],
  );

  const [type, setType] = useState<ContractType>("sale");
  const [form, setForm] = useState({
    contract_no: "",
    client_id: "",
    apartment_id: "",
    currency_id: "",
    sign_date: today(),
    start_date: today(),
    end_date: "",
    total_amount: "",
    down_payment: "",
    installment_count: "12",
    monthly_rent: "",
    deposit: "",
    billing_day: "",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const bookable = (units.data?.items ?? []).filter(
    (u) => u.status === "available" || u.status === "reserved",
  );
  const baseCurrency = currencies.data?.find((c) => c.is_base);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/contracts", {
        contract_no: form.contract_no,
        contract_type: type,
        client_id: Number(form.client_id),
        apartment_id: Number(form.apartment_id),
        currency_id: Number(form.currency_id || baseCurrency?.id),
        sign_date: form.sign_date || null,
        start_date: form.start_date || null,
        end_date: type === "rent" ? form.end_date || null : null,
        total_amount: type === "sale" ? form.total_amount || null : null,
        down_payment: type === "sale" ? form.down_payment || null : null,
        installment_count: type === "sale" ? Number(form.installment_count) : null,
        monthly_rent: type === "rent" ? form.monthly_rent || null : null,
        deposit: type === "rent" ? form.deposit || null : null,
        billing_day: form.billing_day ? Number(form.billing_day) : null,
        notes: form.notes || null,
        generate_schedule: true,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر الحفظ");
    } finally {
      setBusy(false);
    }
  }

  const ready =
    form.contract_no.trim() &&
    form.client_id &&
    form.apartment_id &&
    form.start_date &&
    (type === "sale" ? form.total_amount && Number(form.installment_count) > 0 : form.monthly_rent && form.end_date);

  return (
    <Modal
      title="عقد جديد"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn primary" onClick={save} disabled={busy || !ready}>
            {busy ? "جارٍ الحفظ…" : "حفظ وإنشاء جدول الدفعات"}
          </button>
          <button className="btn" onClick={onClose}>إلغاء</button>
        </>
      }
    >
      {error ? <ErrorNote message={error} /> : null}

      <div className="tabs">
        <button className={type === "sale" ? "on" : ""} onClick={() => setType("sale")}>عقد بيع</button>
        <button className={type === "rent" ? "on" : ""} onClick={() => setType("rent")}>عقد إيجار</button>
      </div>

      <div className="form-row">
        <Field label="رقم العقد">
          <input
            className="mono-in"
            value={form.contract_no}
            onChange={(e) => setForm({ ...form, contract_no: e.target.value })}
            placeholder={type === "sale" ? "SALE-001" : "RENT-001"}
            autoFocus
          />
        </Field>
        <Field label="العملة">
          <select value={form.currency_id} onChange={(e) => setForm({ ...form, currency_id: e.target.value })}>
            <option value="">{baseCurrency ? `${baseCurrency.name_ar} (أساسية)` : "—"}</option>
            {(currencies.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name_ar}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="form-row">
        <Field label="العميل">
          <select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
            <option value="">— اختر —</option>
            {(clients.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name_ar}</option>
            ))}
          </select>
        </Field>
        <Field label="الوحدة" hint="تظهر الوحدات المتاحة والمحجوزة فقط">
          <select value={form.apartment_id} onChange={(e) => setForm({ ...form, apartment_id: e.target.value })}>
            <option value="">— اختر —</option>
            {bookable.map((u) => (
              <option key={u.id} value={u.id}>
                {u.building_name} — {u.unit_no}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="form-row">
        <Field label="تاريخ التوقيع">
          <input className="mono-in" type="date" value={form.sign_date}
                 onChange={(e) => setForm({ ...form, sign_date: e.target.value })} />
        </Field>
        <Field label="تاريخ البدء">
          <input className="mono-in" type="date" value={form.start_date}
                 onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
        </Field>
      </div>

      {type === "sale" ? (
        <>
          <div className="form-row">
            <Field label="قيمة البيع">
              <input className="mono-in" type="number" step="0.01" value={form.total_amount}
                     onChange={(e) => setForm({ ...form, total_amount: e.target.value })} />
            </Field>
            <Field label="الدفعة الأولى">
              <input className="mono-in" type="number" step="0.01" value={form.down_payment}
                     onChange={(e) => setForm({ ...form, down_payment: e.target.value })} />
            </Field>
          </div>
          <div className="form-row">
            <Field label="عدد الأقساط" hint="تُوزَّع القيمة بعد الدفعة الأولى على هذا العدد">
              <input className="mono-in" type="number" min={1} value={form.installment_count}
                     onChange={(e) => setForm({ ...form, installment_count: e.target.value })} />
            </Field>
            <Field label="يوم الاستحقاق" hint="اتركه فارغاً ليتبع يوم البدء">
              <input className="mono-in" type="number" min={1} max={28} value={form.billing_day}
                     onChange={(e) => setForm({ ...form, billing_day: e.target.value })} />
            </Field>
          </div>
        </>
      ) : (
        <>
          <div className="form-row">
            <Field label="الإيجار الشهري">
              <input className="mono-in" type="number" step="0.01" value={form.monthly_rent}
                     onChange={(e) => setForm({ ...form, monthly_rent: e.target.value })} />
            </Field>
            <Field label="التأمين">
              <input className="mono-in" type="number" step="0.01" value={form.deposit}
                     onChange={(e) => setForm({ ...form, deposit: e.target.value })} />
            </Field>
          </div>
          <div className="form-row">
            <Field label="تاريخ الانتهاء">
              <input className="mono-in" type="date" value={form.end_date}
                     onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
            </Field>
            <Field label="يوم الفوترة" hint="اتركه فارغاً ليتبع يوم البدء">
              <input className="mono-in" type="number" min={1} max={28} value={form.billing_day}
                     onChange={(e) => setForm({ ...form, billing_day: e.target.value })} />
            </Field>
          </div>
        </>
      )}

      <Field label="ملاحظات">
        <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </Field>
    </Modal>
  );
}

/** Editing a contract, limited to what a contract can safely change.
 *
 *  Not everything on a contract is editable, and the API says so: the number,
 *  the client, the unit and the type are fixed once it exists, because the
 *  activation posting and the payment schedule were built from them. What is
 *  left — status, dates, amounts, notes — is exactly `ContractUpdate`.
 *
 *  Amounts here do NOT re-post anything. A contract already activated has its
 *  sale entry in the ledger; changing the figure afterwards adjusts the record,
 *  not the GL, and the correcting entry is a journal entry like any other. */
function ContractEditForm({
  contract,
  onClose,
  onSaved,
}: {
  contract: Contract;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isSale = contract.contract_type === "sale";
  const [form, setForm] = useState({
    status: contract.status,
    sign_date: contract.sign_date ?? "",
    start_date: contract.start_date ?? "",
    end_date: contract.end_date ?? "",
    total_amount: contract.total_amount ?? "",
    down_payment: contract.down_payment ?? "",
    monthly_rent: contract.monthly_rent ?? "",
    deposit: contract.deposit ?? "",
    billing_day: contract.billing_day != null ? String(contract.billing_day) : "",
    notes: contract.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/contracts/${contract.id}`, {
        status: form.status,
        sign_date: form.sign_date || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        total_amount: isSale ? form.total_amount || null : null,
        down_payment: isSale ? form.down_payment || null : null,
        monthly_rent: isSale ? null : form.monthly_rent || null,
        deposit: isSale ? null : form.deposit || null,
        billing_day: form.billing_day ? Number(form.billing_day) : null,
        notes: form.notes || null,
      });
      onSaved(`حُفظ العقد ${contract.contract_no}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر الحفظ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`تعديل العقد ${contract.contract_no}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? "جارٍ الحفظ…" : "حفظ"}
          </button>
          <button className="btn" onClick={onClose}>إلغاء</button>
        </>
      }
    >
      {error ? <ErrorNote message={error} /> : null}

      <div className="note">
        <span>◈</span>
        <span>
          رقم العقد والعميل والوحدة والنوع ثابتة بعد الإنشاء — جدول الدفعات وقيد التفعيل بُنيا
          عليها. تعديل المبالغ هنا لا يُعيد القيد؛ التصحيح المحاسبي يكون بقيد يومية.
        </span>
      </div>

      <div className="form-row">
        <Field label="الحالة">
          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as ContractStatus })}
          >
            {Object.entries(CONTRACT_STATUS_AR).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label="تاريخ التوقيع">
          <input className="mono-in" type="date" value={form.sign_date}
                 onChange={(e) => setForm({ ...form, sign_date: e.target.value })} />
        </Field>
      </div>

      <div className="form-row">
        <Field label="تاريخ البدء">
          <input className="mono-in" type="date" value={form.start_date}
                 onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
        </Field>
        <Field label="تاريخ الانتهاء">
          <input className="mono-in" type="date" value={form.end_date}
                 onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
        </Field>
      </div>

      {isSale ? (
        <div className="form-row">
          <Field label="قيمة العقد">
            <input className="mono-in" type="number" step="0.01" value={String(form.total_amount)}
                   onChange={(e) => setForm({ ...form, total_amount: e.target.value })} />
          </Field>
          <Field label="الدفعة الأولى">
            <input className="mono-in" type="number" step="0.01" value={String(form.down_payment)}
                   onChange={(e) => setForm({ ...form, down_payment: e.target.value })} />
          </Field>
        </div>
      ) : (
        <div className="form-row">
          <Field label="الإيجار الشهري">
            <input className="mono-in" type="number" step="0.01" value={String(form.monthly_rent)}
                   onChange={(e) => setForm({ ...form, monthly_rent: e.target.value })} />
          </Field>
          <Field label="التأمين">
            <input className="mono-in" type="number" step="0.01" value={String(form.deposit)}
                   onChange={(e) => setForm({ ...form, deposit: e.target.value })} />
          </Field>
        </div>
      )}

      <Field label="يوم الفوترة" hint="من ١ إلى ٢٨">
        <input className="mono-in" type="number" min={1} max={28} value={form.billing_day}
               onChange={(e) => setForm({ ...form, billing_day: e.target.value })} />
      </Field>

      <Field label="ملاحظات">
        <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </Field>
    </Modal>
  );
}
