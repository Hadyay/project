"use client";

import Link from "next/link";
import { useCallback, useId, useState } from "react";

import { useConfirm } from "@/components/Confirm";
import { useToast } from "@/components/Toast";
import { ErrorNote, Field, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import { METHOD_AR, count, money, num, today } from "@/lib/format";
import { ALL_ROWS } from "@/lib/paging";
import { useReceiptDefaults } from "@/lib/receiptDefaults";
import type {
  Account,
  BulkReceiptLine,
  BulkReceiptResult,
  ClientListItem,
  Currency,
  Page,
  PaymentMethod,
} from "@/lib/types";
import { useApi } from "@/lib/useApi";

/** A client offered to the sheet: who, what they owe, what they usually pay. */
export interface BulkClient {
  client_id: number;
  name: string;
  code: string | null;
  balance: string | number | null;
  monthly_installment: string | number | null;
}

interface Line extends BulkClient {
  key: number;
  amount: string;
  ref_no: string;
  notes: string;
  /** Why the server refused it on the last save. */
  error?: string;
}

let nextKey = 1;
const toLine = (c: BulkClient): Line => ({
  ...c,
  key: nextKey++,
  amount: c.monthly_installment && num(c.monthly_installment) > 0 ? String(num(c.monthly_installment)) : "",
  ref_no: "",
  notes: "",
});

/** تسجيل دفعات الشهر — one sheet, one amount box per client, one "save all".
 *
 *  Each line becomes an ordinary receipt (POST /api/receipts/bulk: the same
 *  allocation and ledger entry as a single receipt, each in its own
 *  savepoint), so one refused line never loses the others. Saved lines leave
 *  the sheet; refused ones stay, marked with the reason, for a second try.
 *  Lines left empty are skipped. */
export function BulkReceipts({
  clients: initial,
  onClose,
  onDone,
}: {
  clients: BulkClient[];
  onClose: () => void;
  /** After a save that created at least one receipt. */
  onDone: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [lines, setLines] = useState<Line[]>(() => initial.map(toLine));
  const [head, setHead] = useState({
    receipt_date: today(),
    cash_account_id: "",
    currency_id: "",
    method: "cash" as PaymentMethod,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printed, setPrinted] = useState<number[]>([]);
  const [savedTotal, setSavedTotal] = useState(0);

  const currencies = useApi(useCallback(() => api.get<Currency[]>("/api/currencies"), []), []);
  const cash = useApi(
    useCallback(
      () => api.get<Page<Account>>("/api/accounts", { is_cash_bank: true, postable_only: true, limit: ALL_ROWS }),
      [],
    ),
    [],
  );
  const all = useApi(
    useCallback(() => api.get<Page<ClientListItem>>("/api/clients", { limit: ALL_ROWS }), []),
    [],
  );

  const defaults = useReceiptDefaults();
  const base = currencies.data?.find((c) => c.is_base);
  const accounts = cash.data?.items ?? [];
  // The configured till; the first one only when none is configured.
  const defaultCash =
    accounts.find((a) => a.id === defaults?.cash_account_id)?.id ?? (defaults ? accounts[0]?.id : undefined);
  const cashId = Number(head.cash_account_id || defaultCash || 0);
  const currencyId = Number(head.currency_id || base?.id || 0);

  const filled = lines.filter((l) => num(l.amount) > 0);
  const total = filled.reduce((sum, l) => sum + num(l.amount), 0);
  const inSheet = new Set(lines.map((l) => l.client_id));

  function patch(key: number, change: Partial<Line>) {
    setLines((rows) => rows.map((l) => (l.key === key ? { ...l, ...change, error: undefined } : l)));
  }

  function add(id: string) {
    const c = all.data?.items.find((x) => String(x.id) === id);
    if (!c || inSheet.has(c.id)) return;
    setLines((rows) => [
      ...rows,
      toLine({
        client_id: c.id,
        name: c.name_ar,
        code: c.code,
        balance: c.balance_base,
        monthly_installment: c.monthly_installment,
      }),
    ]);
  }

  async function save() {
    if (!filled.length || !cashId || !currencyId) return;
    const ok = await confirm({
      title: `تسجيل ${count(filled.length)} وصل قبض؟`,
      body: (
        <p>
          {`المجموع ${money(total)} — كل وصل يُقيَّد: من ح/ الصندوق إلى ح/ ذمة العميل، بتاريخ ${head.receipt_date}. الوصل لا يُعدَّل بعد القيد؛ يُلغى ويُعاد إن لزم.`}
        </p>
      ),
      confirmLabel: "حفظ وقيد الكل",
    });
    if (!ok) return;

    setBusy(true);
    setError(null);
    const sent = filled;
    const body: {
      receipt_date: string;
      cash_account_id: number;
      currency_id: number;
      method: PaymentMethod;
      post: boolean;
      lines: BulkReceiptLine[];
    } = {
      receipt_date: head.receipt_date,
      cash_account_id: cashId,
      currency_id: currencyId,
      method: head.method,
      post: true,
      lines: sent.map((l) => ({
        client_id: l.client_id,
        amount: l.amount,
        ref_no: l.ref_no.trim() || null,
        notes: l.notes.trim() || null,
      })),
    };
    try {
      const result = await api.post<BulkReceiptResult>("/api/receipts/bulk", body);
      const done = new Set(result.created.map((c) => sent[c.line].key));
      const refused = new Map(result.failures.map((f) => [sent[f.line].key, f.detail]));
      setLines((rows) =>
        rows.filter((l) => !done.has(l.key)).map((l) => (refused.has(l.key) ? { ...l, error: refused.get(l.key) } : l)),
      );
      setPrinted((ids) => [...ids, ...result.created.map((c) => c.receipt_id)]);
      setSavedTotal((t) => t + num(result.total_amount));
      if (result.count) {
        toast.ok(`سُجّل ${count(result.count)} وصل — المجموع ${money(result.total_amount)}`);
        onDone();
      }
      if (result.failures.length) toast.err(`تعذّر ${count(result.failures.length)} — السبب بجانب كل سطر`);
    } catch (err) {
      // A 400 on the shared fields (till, currency, rate): nothing was written.
      setError(err instanceof Error ? err.message : "تعذّر الحفظ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="تسجيل دفعات الشهر"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn primary" onClick={save} disabled={busy || !filled.length || !cashId}>
            {busy ? "جارٍ الحفظ…" : `حفظ وقيد الكل (${count(filled.length)})`}
          </button>
          {printed.length ? (
            <Link className="btn" href={`/receipts/print?ids=${printed.join(",")}`} target="_blank">
              {`⎙ طباعة السندات (${count(printed.length)})`}
            </Link>
          ) : null}
          <button className="btn" onClick={onClose}>
            {printed.length ? "إغلاق" : "إلغاء"}
          </button>
          <span className="bulk-total">
            {`${count(filled.length)} وصل · المجموع `}
            <b className="mono">{money(total)}</b>
          </span>
        </>
      }
    >
      <div className="bulk">
        {error ? <ErrorNote message={error} /> : null}
        {printed.length ? (
          <div className="alert ok">
            <span>✓</span>
            <span>{`سُجّل ${count(printed.length)} وصل بمجموع ${money(savedTotal)}. اطبع سنداتها من الزر أدناه.`}</span>
          </div>
        ) : null}

        <div className="bulk-head">
          <Field label="تاريخ الوصولات">
            <input
              className="mono-in"
              type="date"
              value={head.receipt_date}
              onChange={(e) => setHead({ ...head, receipt_date: e.target.value })}
            />
          </Field>
          <Field label="الصندوق / المصرف">
            <select
              value={head.cash_account_id || String(defaultCash ?? "")}
              onChange={(e) => setHead({ ...head, cash_account_id: e.target.value })}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name_ar}
                </option>
              ))}
            </select>
          </Field>
          <Field label="العملة">
            <select
              value={head.currency_id || String(base?.id ?? "")}
              onChange={(e) => setHead({ ...head, currency_id: e.target.value })}
            >
              {(currencies.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name_ar}
                </option>
              ))}
            </select>
          </Field>
          <Field label="طريقة الدفع">
            <select value={head.method} onChange={(e) => setHead({ ...head, method: e.target.value as PaymentMethod })}>
              {Object.entries(METHOD_AR).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="tbl-wrap">
          <table className="bulk-table">
            <thead>
              <tr>
                <th>العميل</th>
                <th className="num">الرصيد</th>
                <th className="num">القسط</th>
                <th>المبلغ</th>
                <th>رقم السند المطبوع</th>
                <th>ملاحظة</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="sub" style={{ textAlign: "center", padding: 20 }}>
                    {printed.length ? "سُجّلت كل الأسطر." : "أضف عملاء من الحقل أدناه."}
                  </td>
                </tr>
              ) : (
                lines.map((l) => (
                  <tr key={l.key} className={l.error ? "late" : undefined}>
                    <td>
                      <div className="nm" translate="no">
                        {l.name}
                      </div>
                      <span className="sub mono">{l.code}</span>
                      {l.error ? <div className="bulk-err">{l.error}</div> : null}
                    </td>
                    <td className="num">
                      <span className="mono" style={{ color: num(l.balance) > 0 ? "var(--debit)" : undefined }}>
                        {money(l.balance, 0)}
                      </span>
                    </td>
                    <td className="num">
                      <span className="mono">{l.monthly_installment ? money(l.monthly_installment, 0) : "—"}</span>
                    </td>
                    <td>
                      <input
                        className="bulk-in mono-in"
                        inputMode="decimal"
                        value={l.amount}
                        placeholder="0"
                        onChange={(e) => patch(l.key, { amount: e.target.value.replace(/[^\d.]/g, "") })}
                      />
                    </td>
                    <td>
                      <input
                        className="bulk-in mono-in"
                        value={l.ref_no}
                        onChange={(e) => patch(l.key, { ref_no: e.target.value })}
                      />
                    </td>
                    <td>
                      <input className="bulk-in" value={l.notes} onChange={(e) => patch(l.key, { notes: e.target.value })} />
                    </td>
                    <td>
                      <button
                        className="btn sm"
                        title="إزالة من الورقة"
                        onClick={() => setLines((rows) => rows.filter((x) => x.key !== l.key))}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="bulk-add">
          <Field label="إضافة عميل إلى الورقة">
            <AddClient
              options={(all.data?.items ?? []).filter((c) => !inSheet.has(c.id))}
              onPick={(c) => add(String(c.id))}
            />
          </Field>
          <p className="sub">
            السطر الفارغ لا يُسجَّل. المبلغ يُعبّأ بالقسط الشهري حيث حُدِّد على بطاقة العميل.
          </p>
        </div>
      </div>
    </Modal>
  );
}

/** Type a name (or pick it from the list) and the client joins the sheet; the
 *  box clears for the next one. */
function AddClient({ options, onPick }: { options: ClientListItem[]; onPick: (c: ClientListItem) => void }) {
  const listId = useId();
  const [text, setText] = useState("");
  const label = (c: ClientListItem) => (c.code ? `${c.name_ar} — ${c.code}` : c.name_ar);
  return (
    <>
      <input
        list={listId}
        value={text}
        placeholder="اكتب اسم العميل أو رمزه…"
        onChange={(e) => {
          const value = e.target.value;
          const hit = options.find((c) => label(c) === value.trim());
          if (hit) {
            onPick(hit);
            setText("");
          } else {
            setText(value);
          }
        }}
      />
      <datalist id={listId}>
        {options.map((c) => (
          <option key={c.id} value={label(c)} />
        ))}
      </datalist>
    </>
  );
}
