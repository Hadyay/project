"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { useConfirm } from "@/components/Confirm";
import { SearchSelect } from "@/components/SearchSelect";
import { ExportButtons, PrintFooter, ResultCount, useClampedOffset } from "@/components/Filters";
import { SearchPanel, type SearchSpec, type SearchValues } from "@/components/SearchPanel";
import { ALL_ROWS, usePageSize } from "@/lib/paging";
import { useToast } from "@/components/Toast";
import { Amount, Async, Card, Doc, Empty, ErrorNote, Field, Head, Modal, Pager, Pill } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { METHOD_AR, isoDate, today } from "@/lib/format";
import type {
  Account,
  Client,
  Contract,
  Currency,
  Page,
  PaymentMethod,
  ReceiptDetail,
} from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function ReceiptsPage() {
  return (
    <Suspense fallback={<div className="loading">جارٍ التحميل…</div>}>
      <ReceiptsInner />
    </Suspense>
  );
}

function ReceiptsInner() {
  const params = useSearchParams();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [clientId, setClientId] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [method, setMethod] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = usePageSize("receipts");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter choices come from the data, not from a hard-coded list.
  const clients = useApi(useCallback(() => api.get<Page<Client>>("/api/clients", { limit: ALL_ROWS }), []), []);
  const cashAccounts = useApi(
    useCallback(
      () => api.get<Page<Account>>("/api/accounts", { is_cash_bank: true, postable_only: true, limit: ALL_ROWS }),
      [],
    ),
    [],
  );

  // Arriving from a client or contract screen opens the form pre-filled.
  const presetClient = params.get("client_id") ?? "";
  const presetContract = params.get("contract_id") ?? "";
  useEffect(() => {
    if (presetClient && can("receipts.create")) setCreating(true);
  }, [presetClient, can]);

  const fetcher = useCallback(
    () =>
      api.get<Page<ReceiptDetail>>("/api/receipts", {
        date_from: from || undefined,
        date_to: to || undefined,
        q: q || undefined,
        client_id: clientId || undefined,
        cash_account_id: cashAccountId || undefined,
        method: method || undefined,
        min_amount: minAmount || undefined,
        max_amount: maxAmount || undefined,
        limit,
        offset,
      }),
    [from, to, q, clientId, cashAccountId, method, minAmount, maxAmount, offset, limit],
  );
  const state = useApi(fetcher, [from, to, q, clientId, cashAccountId, method, minAmount, maxAmount, offset, limit]);

  useClampedOffset(state.data?.total, offset, limit, setOffset);

  const filtered = Boolean(
    from || to || q.trim() || clientId || cashAccountId || method || minAmount || maxAmount,
  );

  // The search box: typed text, a client by name, and the فلاتر menu.
  const searchValues: SearchValues = {
    q, client_id: clientId, cash_account_id: cashAccountId, method,
    date_from: from, date_to: to, min_amount: minAmount, max_amount: maxAmount,
  };
  const searchSpecs: SearchSpec[] = [
    { kind: "text", key: "q", label: "رقم الوصل / العميل / البيان" },
    {
      kind: "choice", key: "client_id", label: "العميل", menu: false,
      options: (clients.data?.items ?? []).map((c) => ({ value: String(c.id), label: c.name_ar, hint: c.code })),
    },
    {
      kind: "choice", key: "cash_account_id", label: "الصندوق / المصرف",
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
      q: setQ, client_id: setClientId, cash_account_id: setCashAccountId, method: setMethod,
      date_from: setFrom, date_to: setTo, min_amount: setMinAmount, max_amount: setMaxAmount,
    };
    for (const [key, value] of Object.entries(patch)) setters[key]?.(value);
    setOffset(0);
  }

  async function voidReceipt(id: number, no: string) {
    const ok = await confirm({
      title: `إلغاء الوصل ${no}؟`,
      body: (
        <p>
          يُعكس تخصيص المبلغ على جدول الدفعات — من الأحدث إلى الأقدم — ويُلغى القيد المرتبط، فيعود
          رصيد العميل كما كان قبل الوصل. الوصل الملغى لا يُحذف من السجل.
        </p>
      ),
      confirmLabel: "إلغاء الوصل",
      cancelLabel: "تراجع",
      danger: true,
    });
    if (!ok) return;

    setError(null);
    try {
      await api.del(`/api/receipts/${id}`);
      toast.ok(`أُلغي الوصل ${no}`);
      state.reload();
    } catch (err) {
      toast.err(err instanceof Error ? err.message : "تعذّر الإلغاء");
    }
  }

  return (
    <>
      <Head
        title="الوصولات — قبض"
        subtitle="المقبوضات من العملاء"
        actions={
          can("receipts.create") ? (
            <button className="btn primary" onClick={() => setCreating(true)}>+ وصل قبض</button>
          ) : null
        }
      />

      {error ? <ErrorNote message={error} /> : null}

      <SearchPanel
        specs={searchSpecs}
        values={searchValues}
        onChange={onSearch}
        placeholder="ابحث برقم الوصل، اسم العميل، البيان…"
        summary={<ResultCount shown={state.data?.items.length ?? 0} total={state.data?.total ?? 0} noun="وصل" />}
        actions={
          <ExportButtons
            filename="receipts"
            headers={["رقم الوصل", "التاريخ", "العميل", "العقد", "الصندوق", "الطريقة", "المبلغ", "العملة", "البيان"]}
            disabled={!state.data?.items.length}
            rows={() =>
              (state.data?.items ?? []).map((r) => [
                r.ref_no ?? r.receipt_no,
                isoDate(r.receipt_date),
                r.client_name,
                r.contract_no,
                r.cash_account_name,
                METHOD_AR[r.method],
                r.amount,
                r.currency_code,
                r.notes,
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
                title={filtered ? "لا وصولات مطابقة" : "لا وصولات"}
                hint={
                  filtered
                    ? "لا وصل يطابق هذه الفلاتر — جرّب توسيعها أو امسحها."
                    : "سجّل أول وصل قبض ليُقيَّد في دفتر الأستاذ."
                }
              />
            ) : (
              <>
                <div className="tbl-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>رقم الوصل</th>
                        <th>التاريخ</th>
                        <th>العميل</th>
                        <th>العقد</th>
                        <th>الطريقة</th>
                        <th className="num">المبلغ</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {page.items.map((receipt) => (
                        <tr key={receipt.id}>
                          <td>
                            <b className="mono">{receipt.ref_no ?? receipt.receipt_no}</b>
                            {receipt.ref_no ? <div className="sub">
                                <span className="mono">{receipt.receipt_no}</span>
                              </div> : null}
                          </td>
                          <td><Doc>{isoDate(receipt.receipt_date)}</Doc></td>
                          <td>
                            <div className="nm">
                              <Link href={`/clients/${receipt.client_id}`}>{receipt.client_name ?? "—"}</Link>
                            </div>
                            <div className="sub">{receipt.cash_account_name ?? ""}</div>
                          </td>
                          <td><Doc>{receipt.contract_no ?? "—"}</Doc></td>
                          <td>
                            <Pill tone="gray">{METHOD_AR[receipt.method]}</Pill>
                            {receipt.cheque_no ? <div className="sub">شيك {receipt.cheque_no}</div> : null}
                          </td>
                          <td className="num">
                            <Amount value={receipt.amount} tone="cr" sub={receipt.currency_code ?? undefined} />
                          </td>
                          <td className="num no-print">
                            <Link className="btn sm" href={`/receipts/${receipt.id}/print`}>
                              ⎙ سند
                            </Link>{" "}
                            {can("receipts.void") ? (
                              <button
                                className="btn sm danger"
                                onClick={() => voidReceipt(receipt.id, receipt.receipt_no)}
                              >
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
                <PrintFooter title="الوصولات — قبض" />
              </>
            )}
          </Card>
        )}
      </Async>

      {creating ? (
        <ReceiptForm
          presetClient={presetClient}
          presetContract={presetContract}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); state.reload(); }}
        />
      ) : null}
    </>
  );
}

function ReceiptForm({
  presetClient,
  presetContract,
  onClose,
  onSaved,
}: {
  presetClient: string;
  presetContract: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const clients = useApi(useCallback(() => api.get<Page<Client>>("/api/clients", { limit: ALL_ROWS }), []), []);
  const currencies = useApi(useCallback(() => api.get<Currency[]>("/api/currencies"), []), []);
  const cashAccounts = useApi(
    useCallback(
      () => api.get<Page<Account>>("/api/accounts", { is_cash_bank: true, postable_only: true, limit: ALL_ROWS }),
      [],
    ),
    [],
  );

  const [form, setForm] = useState({
    receipt_date: today(),
    client_id: presetClient,
    contract_id: presetContract,
    cash_account_id: "",
    amount: "",
    currency_id: "",
    method: "cash" as PaymentMethod,
    cheque_no: "",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The contract list is scoped to the chosen client so a receipt cannot be
  // allocated against someone else's contract (the API rejects that too).
  const contracts = useApi(
    useCallback(
      () =>
        form.client_id
          ? api.get<Page<Contract>>("/api/contracts", { client_id: Number(form.client_id), limit: ALL_ROWS })
          : Promise.resolve({ items: [], total: 0, limit: 0, offset: 0 } as Page<Contract>),
      [form.client_id],
    ),
    [form.client_id],
  );

  const baseCurrency = currencies.data?.find((c) => c.is_base);
  const accounts = cashAccounts.data?.items ?? [];
  const defaultCash = accounts[0]?.id;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/receipts", {
        receipt_date: form.receipt_date,
        client_id: Number(form.client_id),
        contract_id: form.contract_id ? Number(form.contract_id) : null,
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

  const ready = form.client_id && Number(form.amount) > 0 && (form.cash_account_id || defaultCash);

  return (
    <Modal
      title="وصل قبض"
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
        <span>يُقيَّد الوصل: من ح/ الصندوق أو المصرف — إلى ح/ ذمة العميل، ويُخصَّم من أقدم دفعة مستحقّة.</span>
      </div>

      <div className="form-row">
        <Field label="التاريخ">
          <input className="mono-in" type="date" value={form.receipt_date}
                 onChange={(e) => setForm({ ...form, receipt_date: e.target.value })} />
        </Field>
        <Field label="العميل">
          <select value={form.client_id}
                  onChange={(e) => setForm({ ...form, client_id: e.target.value, contract_id: "" })}>
            <option value="">— اختر —</option>
            {(clients.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name_ar}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="form-row">
        <Field label="العقد" hint="اختياري — يخصَّص المبلغ على جدول دفعاته">
          <select value={form.contract_id} onChange={(e) => setForm({ ...form, contract_id: e.target.value })}
                  disabled={!form.client_id}>
            <option value="">بدون تخصيص</option>
            {(contracts.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.contract_no}</option>
            ))}
          </select>
        </Field>
        <Field label="الصندوق / المصرف">
          <select value={form.cash_account_id} onChange={(e) => setForm({ ...form, cash_account_id: e.target.value })}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name_ar}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="form-row">
        <Field label="المبلغ">
          <input className="mono-in" type="number" step="0.01" value={form.amount}
                 onChange={(e) => setForm({ ...form, amount: e.target.value })} autoFocus />
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
