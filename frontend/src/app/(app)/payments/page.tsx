"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { useConfirm } from "@/components/Confirm";
import { ExportButtons, PrintFooter, ResultCount, useClampedOffset } from "@/components/Filters";
import { SearchPanel, type SearchSpec, type SearchValues } from "@/components/SearchPanel";
import { ALL_ROWS, usePageSize } from "@/lib/paging";
import { useToast } from "@/components/Toast";
import { Amount, Async, Card, Doc, Empty, ErrorNote, Field, Head, Modal, Pager, Pill } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { METHOD_AR, isoDate, today } from "@/lib/format";
import type { Account, Currency, Page, PaymentDetail, PaymentMethod } from "@/lib/types";
import { useReceiptDefaults } from "@/lib/receiptDefaults";
import { useApi } from "@/lib/useApi";

export default function PaymentsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [method, setMethod] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = usePageSize("payments");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter choices come from the data, not from a hard-coded list.
  const cashAccounts = useApi(
    useCallback(
      () => api.get<Page<Account>>("/api/accounts", { is_cash_bank: true, postable_only: true, limit: ALL_ROWS }),
      [],
    ),
    [],
  );

  const fetcher = useCallback(
    () =>
      api.get<Page<PaymentDetail>>("/api/payments", {
        date_from: from || undefined,
        date_to: to || undefined,
        q: q || undefined,
        cash_account_id: cashAccountId || undefined,
        method: method || undefined,
        min_amount: minAmount || undefined,
        max_amount: maxAmount || undefined,
        limit,
        offset,
      }),
    [from, to, q, cashAccountId, method, minAmount, maxAmount, offset, limit],
  );
  const state = useApi(fetcher, [from, to, q, cashAccountId, method, minAmount, maxAmount, offset, limit]);

  useClampedOffset(state.data?.total, offset, limit, setOffset);



  const filtered = Boolean(
    from || to || q.trim() || cashAccountId || method || minAmount || maxAmount,
  );

  // The search box: typed text plus the فلاتر menu.
  const searchValues: SearchValues = {
    q, cash_account_id: cashAccountId, method,
    date_from: from, date_to: to, min_amount: minAmount, max_amount: maxAmount,
  };
  const searchSpecs: SearchSpec[] = [
    { kind: "text", key: "q", label: "رقم السند / الجهة / البيان" },
    {
      kind: "choice", key: "cash_account_id", label: "من حساب",
      options: (cashAccounts.data?.items ?? []).map((a) => ({ value: String(a.id), label: a.name_ar, hint: a.code })),
    },
    {
      kind: "choice", key: "method", label: "الطريقة",
      options: Object.entries(METHOD_AR).map(([value, label]) => ({ value, label })),
    },
    { kind: "dates", from: "date_from", to: "date_to", label: "التاريخ" },
    { kind: "range", min: "min_amount", max: "max_amount", label: "المبلغ" },
  ];
  function onSearch(patch: SearchValues) {
    const setters: Record<string, (value: string) => void> = {
      q: setQ, cash_account_id: setCashAccountId, method: setMethod,
      date_from: setFrom, date_to: setTo, min_amount: setMinAmount, max_amount: setMaxAmount,
    };
    for (const [key, value] of Object.entries(patch)) setters[key]?.(value);
    setOffset(0);
  }

  async function voidPayment(id: number, no: string) {
    const ok = await confirm({
      title: `إلغاء سند الصرف ${no}؟`,
      body: <p>يُلغى القيد المرتبط فيخرج المبلغ من أرصدة الصندوق والمستفيد. السند يبقى في السجل ملغى.</p>,
      confirmLabel: "إلغاء السند",
      cancelLabel: "تراجع",
      danger: true,
    });
    if (!ok) return;

    setError(null);
    try {
      await api.del(`/api/payments/${id}`);
      toast.ok(`أُلغي السند ${no}`);
      state.reload();
    } catch (err) {
      toast.err(err instanceof Error ? err.message : "تعذّر الإلغاء");
    }
  }

  return (
    <>
      <Head
        title="المدفوعات — صرف"
        subtitle="المصاريف والمدفوعات الخارجة"
        actions={
          can("payments.create") ? (
            <button className="btn primary" onClick={() => setCreating(true)}>+ سند صرف</button>
          ) : null
        }
      />

      {error ? <ErrorNote message={error} /> : null}

      <SearchPanel
        specs={searchSpecs}
        values={searchValues}
        onChange={onSearch}
        placeholder="ابحث برقم السند، الجهة المستفيدة، البيان…"
        summary={<ResultCount shown={state.data?.items.length ?? 0} total={state.data?.total ?? 0} noun="سند" />}
        actions={
          <ExportButtons
            filename="payments"
            headers={["رقم السند", "التاريخ", "الجهة المستفيدة", "من حساب", "الطريقة", "المبلغ", "العملة", "البيان"]}
            disabled={!state.data?.items.length}
            rows={() =>
              (state.data?.items ?? []).map((p) => [
                p.ref_no ?? p.payment_no,
                isoDate(p.payment_date),
                p.beneficiary_name,
                p.cash_account_name,
                METHOD_AR[p.method],
                p.amount,
                p.currency_code,
                p.notes,
              ])
            }
          />
        }
      />

      <Async state={state}>
        {(page) => (
          <Card>
            {page.items.length === 0 ? (
              <Empty
                title={filtered ? "لا مدفوعات مطابقة" : "لا مدفوعات"}
                hint={
                  filtered
                    ? "لا سند يطابق هذه الفلاتر — جرّب توسيعها أو امسحها."
                    : "سجّل أول سند صرف ليُقيَّد في دفتر الأستاذ."
                }
              />
            ) : (
              <>
                <div className="tbl-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>رقم السند</th>
                        <th>التاريخ</th>
                        <th>الجهة المستفيدة</th>
                        <th>من حساب</th>
                        <th>الطريقة</th>
                        <th className="num">المبلغ</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {page.items.map((payment) => (
                        <tr key={payment.id}>
                          <td>
                            <b className="mono">{payment.ref_no ?? payment.payment_no}</b>
                            {payment.ref_no ? <div className="sub">
                                <span className="mono">{payment.payment_no}</span>
                              </div> : null}
                          </td>
                          <td><Doc>{isoDate(payment.payment_date)}</Doc></td>
                          <td>
                            <div className="nm">{payment.beneficiary_name ?? "—"}</div>
                            {payment.notes ? <div className="sub">{payment.notes}</div> : null}
                          </td>
                          <td className="sub">{payment.cash_account_name ?? "—"}</td>
                          <td>
                            <Pill tone="gray">{METHOD_AR[payment.method]}</Pill>
                            {payment.cheque_no ? <div className="sub">شيك {payment.cheque_no}</div> : null}
                          </td>
                          <td className="num">
                            <Amount value={payment.amount} tone="dr" sub={payment.currency_code ?? undefined} />
                          </td>
                          <td className="num no-print">
                            <Link className="btn sm" href={`/payments/${payment.id}/print`}>
                              ⎙ سند
                            </Link>{" "}
                            {can("payments.void") ? (
                              <button className="btn sm danger"
                                      onClick={() => voidPayment(payment.id, payment.payment_no)}>
                                إلغاء
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager total={page.total} limit={limit} offset={offset} onChange={setOffset} onLimitChange={setLimit} />
                <PrintFooter title="المدفوعات — صرف" />
              </>
            )}
          </Card>
        )}
      </Async>

      {creating ? (
        <PaymentForm
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); state.reload(); }}
        />
      ) : null}
    </>
  );
}

function PaymentForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const currencies = useApi(useCallback(() => api.get<Currency[]>("/api/currencies"), []), []);
  const cashAccounts = useApi(
    useCallback(
      () => api.get<Page<Account>>("/api/accounts", { is_cash_bank: true, postable_only: true, limit: ALL_ROWS }),
      [],
    ),
    [],
  );
  // The beneficiary side is any postable account — typically an expense or a payable.
  const allAccounts = useApi(
    useCallback(() => api.get<Page<Account>>("/api/accounts", { postable_only: true, limit: ALL_ROWS }), []),
    [],
  );

  const [form, setForm] = useState({
    payment_date: today(),
    beneficiary_account_id: "",
    cash_account_id: "",
    amount: "",
    currency_id: "",
    method: "cash" as PaymentMethod,
    cheque_no: "",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const baseCurrency = currencies.data?.find((c) => c.is_base);
  const cash = cashAccounts.data?.items ?? [];
  const defaults = useReceiptDefaults();
  // The configured till (DEFAULT_CASH_CODE), not the first in the list.
  const defaultCash = cash.find((a) => a.id === defaults?.cash_account_id)?.id ?? cash[0]?.id;
  const beneficiaries = (allAccounts.data?.items ?? []).filter((a) => !a.is_cash_bank);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/payments", {
        payment_date: form.payment_date,
        beneficiary_account_id: Number(form.beneficiary_account_id),
        cash_account_id: Number(form.cash_account_id || defaultCash),
        amount: form.amount,
        currency_id: Number(form.currency_id || baseCurrency?.id),
        method: form.method,
        cheque_no: form.cheque_no || null,
        notes: form.notes || null,
        post: true,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر الحفظ");
    } finally {
      setBusy(false);
    }
  }

  const ready =
    form.beneficiary_account_id && Number(form.amount) > 0 && (form.cash_account_id || defaultCash);

  return (
    <Modal
      title="سند صرف"
      onClose={onClose}
      footer={
        <>
          <button className="btn primary" onClick={save} disabled={busy || !ready}>
            {busy ? "جارٍ الحفظ…" : "حفظ وقيد"}
          </button>
          <button className="btn" onClick={onClose}>إلغاء</button>
        </>
      }
    >
      {error ? <ErrorNote message={error} /> : null}

      <div className="note">
        <span>◈</span>
        <span>يُقيَّد السند: من ح/ الجهة المستفيدة — إلى ح/ الصندوق أو المصرف.</span>
      </div>

      <div className="form-row">
        <Field label="التاريخ">
          <input className="mono-in" type="date" value={form.payment_date}
                 onChange={(e) => setForm({ ...form, payment_date: e.target.value })} />
        </Field>
        <Field label="من حساب">
          <select value={form.cash_account_id || String(defaultCash ?? "")}
                  onChange={(e) => setForm({ ...form, cash_account_id: e.target.value })}>
            {cash.map((a) => (
              <option key={a.id} value={a.id}>{a.name_ar}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="الجهة المستفيدة">
        <select value={form.beneficiary_account_id}
                onChange={(e) => setForm({ ...form, beneficiary_account_id: e.target.value })}>
          <option value="">— اختر حساباً —</option>
          {beneficiaries.map((a) => (
            <option key={a.id} value={a.id}>{a.code} — {a.name_ar}</option>
          ))}
        </select>
      </Field>

      <div className="form-row">
        <Field label="المبلغ">
          <input className="mono-in" type="number" step="0.01" value={form.amount}
                 onChange={(e) => setForm({ ...form, amount: e.target.value })} />
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
        <Field label="طريقة الدفع">
          <select value={form.method}
                  onChange={(e) => setForm({ ...form, method: e.target.value as PaymentMethod })}>
            {Object.entries(METHOD_AR).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label="رقم الشيك">
          <input className="mono-in" value={form.cheque_no} disabled={form.method !== "cheque"}
                 onChange={(e) => setForm({ ...form, cheque_no: e.target.value })} />
        </Field>
      </div>

      <Field label="البيان">
        <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </Field>
    </Modal>
  );
}
