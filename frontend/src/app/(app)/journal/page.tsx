"use client";

import { useCallback, useState } from "react";

import { ExportButtons, PrintFooter, ResultCount, useClampedOffset } from "@/components/Filters";
import { SearchPanel, type SearchSpec, type SearchValues } from "@/components/SearchPanel";
import { ALL_ROWS, usePageSize } from "@/lib/paging";
import { Amount, Async, Card, Doc, Empty, ErrorNote, Field, Head, Modal, Pager, Pill } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ENTRY_TYPE_AR, isoDate, money, num, today } from "@/lib/format";
import type {
  Account,
  Currency,
  EntryType,
  JournalEntry,
  JournalEntryDetail,
  Page,
} from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function JournalPage() {
  const { can } = useAuth();
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [accountId, setAccountId] = useState("");
  const [postedOnly, setPostedOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = usePageSize("journal");
  const [creating, setCreating] = useState(false);
  const [openEntry, setOpenEntry] = useState<number | null>(null);

  // Postable accounts only: a header account never carries a line, so
  // offering it as a filter would only ever return nothing.
  const accounts = useApi(
    useCallback(() => api.get<Page<Account>>("/api/accounts", { postable_only: true, limit: ALL_ROWS }), []),
    [],
  );

  const fetcher = useCallback(
    () =>
      api.get<Page<JournalEntry>>("/api/journal", {
        entry_type: type || undefined,
        date_from: from || undefined,
        date_to: to || undefined,
        q: q || undefined,
        account_id: accountId || undefined,
        posted_only: postedOnly || undefined,
        limit,
        offset,
      }),
    [type, from, to, q, accountId, postedOnly, offset, limit],
  );
  const state = useApi(fetcher, [type, from, to, q, accountId, postedOnly, offset, limit]);

  useClampedOffset(state.data?.total, offset, limit, setOffset);



  const filtered = Boolean(type || from || to || q.trim() || accountId || postedOnly);

  // The search box: typed text, an account by name or code, and the فلاتر menu.
  const searchValues: SearchValues = {
    q, account_id: accountId, entry_type: type, posted: postedOnly ? "posted" : "",
    date_from: from, date_to: to,
  };
  const searchSpecs: SearchSpec[] = [
    { kind: "text", key: "q", label: "الاسم / الحساب / رقم القيد / البيان" },
    {
      kind: "choice", key: "account_id", label: "الحساب", menu: false,
      options: (accounts.data?.items ?? []).map((a) => ({ value: String(a.id), label: a.name_ar, hint: a.code })),
    },
    {
      kind: "choice", key: "entry_type", label: "النوع",
      options: Object.entries(ENTRY_TYPE_AR).map(([value, label]) => ({ value, label })),
    },
    { kind: "choice", key: "posted", label: "الحالة", suggest: false, options: [{ value: "posted", label: "المرحَّلة فقط" }] },
    { kind: "dates", from: "date_from", to: "date_to", label: "التاريخ" },
  ];
  function onSearch(patch: SearchValues) {
    const setters: Record<string, (value: string) => void> = {
      q: setQ, account_id: setAccountId, entry_type: setType,
      posted: (value) => setPostedOnly(value === "posted"),
      date_from: setFrom, date_to: setTo,
    };
    for (const [key, value] of Object.entries(patch)) setters[key]?.(value);
    setOffset(0);
  }

  return (
    <>
      <Head
        title="قيود اليومية"
        subtitle="دفتر اليومية العام"
        actions={
          can("journal.create") ? (
            <button className="btn primary" onClick={() => setCreating(true)}>+ قيد يدوي</button>
          ) : null
        }
      />

      <SearchPanel
        specs={searchSpecs}
        values={searchValues}
        onChange={onSearch}
        placeholder="ابحث باسم العميل أو الحساب، رقم القيد، البيان…"
        summary={<ResultCount shown={state.data?.items.length ?? 0} total={state.data?.total ?? 0} noun="قيد" />}
        actions={
          <ExportButtons
            filename="journal"
            headers={["رقم القيد", "التاريخ", "النوع", "البيان", "العملة", "سعر الصرف", "مرحَّل"]}
            disabled={!state.data?.items.length}
            rows={() =>
              (state.data?.items ?? []).map((entry) => [
                entry.entry_no,
                isoDate(entry.entry_date),
                ENTRY_TYPE_AR[entry.entry_type],
                entry.description,
                entry.currency_id,
                entry.exchange_rate,
                entry.is_posted ? "نعم" : "لا",
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
                title={filtered ? "لا قيود مطابقة" : "لا قيود"}
                hint={
                  filtered
                    ? "لا قيد يطابق هذه الفلاتر — جرّب توسيعها أو امسحها."
                    : "ستظهر هنا القيود الآلية والقيود اليدوية."
                }
              />
            ) : (
              <>
                <div className="tbl-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>رقم القيد</th>
                        <th>التاريخ</th>
                        <th>النوع</th>
                        <th>البيان</th>
                        <th>الحالة</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {page.items.map((entry) => (
                        <tr key={entry.id} className="row-link" onClick={() => setOpenEntry(entry.id)}>
                          <td><Doc>{entry.entry_no}</Doc></td>
                          <td><Doc>{isoDate(entry.entry_date)}</Doc></td>
                          <td>
                            <Pill tone={entry.entry_type === "receipt" ? "ok" : "gray"}>
                              {ENTRY_TYPE_AR[entry.entry_type]}
                            </Pill>
                          </td>
                          <td className="sub">{entry.description ?? "—"}</td>
                          <td>
                            <Pill tone={entry.is_posted ? "ok" : "wait"}>
                              {entry.is_posted ? "مُرحَّل" : "غير مُرحَّل"}
                            </Pill>
                          </td>
                          <td className="num">
                            <button className="btn sm">تفاصيل</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager total={page.total} limit={limit} offset={offset} onChange={setOffset} onLimitChange={setLimit} />
                <PrintFooter title="دفتر اليومية" />
              </>
            )}
          </Card>
        )}
      </Async>

      {openEntry !== null ? (
        <EntryDetail id={openEntry} onClose={() => setOpenEntry(null)} onChanged={state.reload} />
      ) : null}

      {creating ? (
        <EntryForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); state.reload(); }} />
      ) : null}
    </>
  );
}

function EntryDetail({
  id,
  onClose,
  onChanged,
}: {
  id: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { can } = useAuth();
  const state = useApi(useCallback(() => api.get<JournalEntryDetail>(`/api/journal/${id}`), [id]), [id]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function post() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/journal/${id}/post`);
      state.reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر الترحيل");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="تفاصيل القيد"
      wide
      onClose={onClose}
      footer={
        <>
          {state.data && !state.data.is_posted && can("journal.post") ? (
            <button className="btn primary" onClick={post} disabled={busy}>ترحيل</button>
          ) : null}
          <button className="btn" onClick={onClose}>إغلاق</button>
        </>
      }
    >
      {error ? <ErrorNote message={error} /> : null}

      <Async state={state}>
        {(entry) => (
          <>
            <div className="form-row">
              <div className="kv"><span>رقم القيد</span><b className="mono">{entry.entry_no}</b></div>
              <div className="kv"><span>التاريخ</span><b className="mono">{isoDate(entry.entry_date)}</b></div>
            </div>
            <div className="form-row">
              <div className="kv"><span>النوع</span><b>{ENTRY_TYPE_AR[entry.entry_type]}</b></div>
              <div className="kv"><span>سعر الصرف</span><b className="mono">{money(entry.exchange_rate, 6)}</b></div>
            </div>
            {entry.description ? (
              <div className="kv"><span>البيان</span><b>{entry.description}</b></div>
            ) : null}

            <div className="tbl-wrap" style={{ marginTop: 14 }}>
              <table>
                <thead>
                  <tr>
                    <th>الحساب</th>
                    <th>البيان</th>
                    <th className="num">مدين</th>
                    <th className="num">دائن</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.lines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <div className="nm">{line.account_name ?? "—"}</div>
                        <Doc>{line.account_code ?? ""}</Doc>
                      </td>
                      <td className="sub">{line.line_desc ?? "—"}</td>
                      <td className="num mono" style={{ color: "var(--debit)" }}>
                        {num(line.debit_base) ? money(line.debit_base) : "—"}
                      </td>
                      <td className="num mono" style={{ color: "var(--credit)" }}>
                        {num(line.credit_base) ? money(line.credit_base) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className={`je-bal${num(entry.total_debit) === num(entry.total_credit) ? "" : " off"}`}>
              <span>
                {num(entry.total_debit) === num(entry.total_credit) ? "القيد متوازن" : "القيد غير متوازن"}
              </span>
              <span className="mono">
                {money(entry.total_debit)} / {money(entry.total_credit)}
              </span>
            </div>
          </>
        )}
      </Async>
    </Modal>
  );
}

interface DraftLine {
  account_id: string;
  debit: string;
  credit: string;
  line_desc: string;
}

const EMPTY_LINE: DraftLine = { account_id: "", debit: "", credit: "", line_desc: "" };

function EntryForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const currencies = useApi(useCallback(() => api.get<Currency[]>("/api/currencies"), []), []);
  const accounts = useApi(
    useCallback(() => api.get<Page<Account>>("/api/accounts", { postable_only: true, limit: ALL_ROWS }), []),
    [],
  );

  const [header, setHeader] = useState({
    entry_date: today(),
    entry_type: "adjustment" as EntryType,
    currency_id: "",
    description: "",
  });
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const baseCurrency = currencies.data?.find((c) => c.is_base);
  const totalDebit = lines.reduce((sum, l) => sum + num(l.debit), 0);
  const totalCredit = lines.reduce((sum, l) => sum + num(l.credit), 0);
  const balanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.005;

  function update(index: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/journal", {
        entry_date: header.entry_date,
        entry_type: header.entry_type,
        description: header.description || null,
        currency_id: Number(header.currency_id || baseCurrency?.id),
        is_posted: true,
        lines: lines
          .filter((l) => l.account_id && (num(l.debit) > 0 || num(l.credit) > 0))
          .map((l) => ({
            account_id: Number(l.account_id),
            debit: l.debit || "0",
            credit: l.credit || "0",
            line_desc: l.line_desc || null,
          })),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر الحفظ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="قيد يومية يدوي"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn primary" onClick={save} disabled={busy || !balanced}>
            {busy ? "جارٍ الحفظ…" : "حفظ وترحيل"}
          </button>
          <button className="btn" onClick={onClose}>إلغاء</button>
        </>
      }
    >
      {error ? <ErrorNote message={error} /> : null}

      <div className="form-row">
        <Field label="التاريخ">
          <input className="mono-in" type="date" value={header.entry_date}
                 onChange={(e) => setHeader({ ...header, entry_date: e.target.value })} />
        </Field>
        <Field label="نوع القيد">
          <select value={header.entry_type}
                  onChange={(e) => setHeader({ ...header, entry_type: e.target.value as EntryType })}>
            {Object.entries(ENTRY_TYPE_AR).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="form-row">
        <Field label="العملة">
          <select value={header.currency_id}
                  onChange={(e) => setHeader({ ...header, currency_id: e.target.value })}>
            <option value="">{baseCurrency ? `${baseCurrency.name_ar} (أساسية)` : "—"}</option>
            {(currencies.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name_ar}</option>
            ))}
          </select>
        </Field>
        <Field label="البيان">
          <input value={header.description}
                 onChange={(e) => setHeader({ ...header, description: e.target.value })} />
        </Field>
      </div>

      <div style={{ marginTop: 8, marginBottom: 6 }} className="sub">توزيع القيد</div>

      {lines.map((line, index) => (
        <div className="je-line" key={index}>
          <select value={line.account_id} onChange={(e) => update(index, { account_id: e.target.value })}>
            <option value="">— حساب —</option>
            {(accounts.data?.items ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.code} — {a.name_ar}</option>
            ))}
          </select>
          <input
            className="mono-in"
            type="number"
            step="0.01"
            placeholder="مدين"
            value={line.debit}
            onChange={(e) => update(index, { debit: e.target.value, credit: "" })}
          />
          <input
            className="mono-in"
            type="number"
            step="0.01"
            placeholder="دائن"
            value={line.credit}
            onChange={(e) => update(index, { credit: e.target.value, debit: "" })}
          />
          <button
            className="btn sm"
            onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
            disabled={lines.length <= 2}
            aria-label="حذف السطر"
          >
            ×
          </button>
        </div>
      ))}

      <button className="btn sm" style={{ marginTop: 10 }} onClick={() => setLines((p) => [...p, { ...EMPTY_LINE }])}>
        + سطر
      </button>

      <div className={`je-bal${balanced ? "" : " off"}`}>
        <span>{balanced ? "القيد متوازن" : "القيد غير متوازن"}</span>
        <span className="mono">
          {money(totalDebit)} / {money(totalCredit)}
        </span>
      </div>
    </Modal>
  );
}
