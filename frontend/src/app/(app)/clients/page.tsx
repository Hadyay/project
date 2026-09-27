"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { useConfirm } from "@/components/Confirm";
import { ExportButtons, PrintFooter, ResultCount, useClampedOffset } from "@/components/Filters";
import { SearchPanel, type SearchSpec, type SearchValues } from "@/components/SearchPanel";
import { usePageSize } from "@/lib/paging";
import { useToast } from "@/components/Toast";
import { Amount, Async, Card, Doc, Empty, ErrorNote, Field, Head, Modal, Pager, Pill } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { num } from "@/lib/format";
import type { Client, ClientListItem, Page } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { monthsLabel } from "@/lib/alerts";

/** Receivable balance: positive means the client owes. */
const BALANCE_AR: Record<string, string> = {
  debit: "مدين — عليه رصيد",
  credit: "دائن — دفع مقدّماً",
  zero: "مسدّد — رصيد صفر",
};

const SORT_AR: Record<string, string> = {
  name: "الاسم",
  balance_desc: "الأعلى رصيداً",
  balance_asc: "الأدنى رصيداً",
};

export default function ClientsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [balance, setBalance] = useState("");
  const [sort, setSort] = useState("name");
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = usePageSize("clients");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);

  const fetcher = useCallback(
    () =>
      api.get<Page<ClientListItem>>("/api/clients", {
        q: q || undefined,
        balance: balance || undefined,
        sort,
        limit,
        offset,
      }),
    [q, balance, sort, offset, limit],
  );
  const state = useApi(fetcher, [q, balance, sort, offset, limit]);
  // Filters run on the server, so an empty page means "nothing matched" only
  // when one is set; sorting never empties a page.
  const filtered = Boolean(q.trim() || balance);

  useClampedOffset(state.data?.total, offset, limit, setOffset);

  async function remove(client: Client) {
    const ok = await confirm({
      title: `حذف العميل ${client.name_ar}؟`,
      body: (
        <>
          <p>
            الحذف دفتري: يختفي العميل من السجل ويبقى حسابه وكل حركاته في دفتر الأستاذ كما هي، فلا
            يتغيّر ميزان المراجعة.
          </p>
          <p className="sub" style={{ marginTop: 8 }}>
            رقم الحساب <span className="mono">{client.code ?? client.account_id ?? "—"}</span>
          </p>
        </>
      ),
      confirmLabel: "حذف",
      danger: true,
    });
    if (!ok) return;

    try {
      await api.del(`/api/clients/${client.id}`);
      toast.ok(`حُذف العميل ${client.name_ar}`);
      state.reload();
    } catch (err) {
      toast.err(err instanceof Error ? err.message : "تعذّر الحذف");
    }
  }

  // The search box: typed text plus balance and ordering under فلاتر.
  const searchValues: SearchValues = { q, balance, sort: sort === "name" ? "" : sort };
  const searchSpecs: SearchSpec[] = [
    { kind: "text", key: "q", label: "الاسم / رقم الحساب / الهاتف / المشروع / البلوك" },
    {
      kind: "choice", key: "balance", label: "الرصيد", suggest: false,
      options: Object.entries(BALANCE_AR).map(([value, label]) => ({ value, label })),
    },
    {
      kind: "choice", key: "sort", label: "الترتيب", suggest: false,
      options: Object.entries(SORT_AR).filter(([value]) => value !== "name").map(([value, label]) => ({ value, label })),
    },
  ];
  function onSearch(patch: SearchValues) {
    const setters: Record<string, (value: string) => void> = {
      q: setQ, balance: setBalance, sort: (value) => setSort(value || "name"),
    };
    for (const [key, value] of Object.entries(patch)) setters[key]?.(value);
    setOffset(0);
  }

  return (
    <>
      <Head
        title="العملاء"
        subtitle="سجل العملاء وحساباتهم"
        actions={
          can("clients.create") ? (
            <button className="btn primary" onClick={() => setCreating(true)}>
              + عميل جديد
            </button>
          ) : null
        }
      />

      <SearchPanel
        specs={searchSpecs}
        values={searchValues}
        onChange={onSearch}
        placeholder="ابحث بالاسم، رقم الحساب، الهاتف، المشروع أو البلوك…"
        summary={<ResultCount shown={state.data?.items.length ?? 0} total={state.data?.total ?? 0} noun="عميل" />}
        actions={
          <ExportButtons
            filename="clients"
            headers={["الاسم", "رقم الحساب", "الرصيد ($)", "الهاتف", "هاتف ٢", "المشروع والعقار", "بلوك", "طابق / جهة", "رقم الهوية", "البريد", "العنوان", "ملاحظات"]}
            disabled={!state.data?.items.length}
            rows={() =>
              (state.data?.items ?? []).map((client) => [
                client.name_ar,
                client.code ?? client.account_id,
                client.balance_base,
                client.phone,
                client.phone2,
                client.project,
                client.block,
                client.floor_side,
                client.national_id,
                client.email,
                client.address,
                client.notes,
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
                title={filtered ? "لا عملاء مطابقين" : "لا عملاء"}
                hint={
                  filtered
                    ? "لا عميل يطابق هذه الفلاتر — جرّب اسماً آخر أو امسح الفلاتر."
                    : "أضف عميلاً ليُفتح له حساب ذمم في دفتر الأستاذ تلقائياً."
                }
                action={
                  !filtered && can("clients.create") ? (
                    <button className="btn primary" onClick={() => setCreating(true)}>
                      + عميل جديد
                    </button>
                  ) : null
                }
              />
            ) : (
              <>
                <div className="tbl-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>الاسم</th>
                        <th>رقم الحساب</th>
                        <th className="num">الرصيد</th>
                        <th>الهاتف</th>
                        <th>المشروع والعقار</th>
                        <th>بلوك</th>
                        <th>طابق / جهة</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {page.items.map((client) => (
                        <tr key={client.id} className={client.late ? "late" : undefined}>
                          <td>
                            <div className="nm">
                              <Link href={`/clients/${client.id}`}>{client.name_ar}</Link>
                            </div>
                            {client.name_en ? <div className="sub">{client.name_en}</div> : null}
                            {/* The monthly reminder: owes and has not paid this month. */}
                            {client.late ? (
                              <Pill tone="late-pill">🔔 {monthsLabel(client.months_unpaid)}</Pill>
                            ) : null}
                          </td>
                          <td>
                            <Doc>{client.code ?? client.account_id ?? "—"}</Doc>
                          </td>
                          <td className="num">
                            {/* Sign as a word, not a minus: "دائن 300" reads right to
                                an accountant; "-300.00" in RTL text does not. */}
                            <Amount
                              value={Math.abs(num(client.balance_base))}
                              tone={num(client.balance_base) > 0 ? "dr" : num(client.balance_base) < 0 ? "cr" : undefined}
                              sub={num(client.balance_base) > 0 ? "مدين" : num(client.balance_base) < 0 ? "دائن" : "مسدّد"}
                            />
                          </td>
                          <td>
                            <Doc>{client.phone ?? "—"}</Doc>
                          </td>
                          <td translate="no">{client.project ?? "—"}</td>
                          <td className="nw" translate="no">
                            {client.block ?? "—"}
                          </td>
                          <td className="sub" translate="no">
                            {client.floor_side ?? "—"}
                          </td>
                          <td className="num no-print" style={{ whiteSpace: "nowrap" }}>
                            {/* The name opens the statement; the row keeps only edit and delete. */}
                            {can("clients.edit") ? (
                              <button className="btn sm" onClick={() => setEditing(client)}>
                                تعديل
                              </button>
                            ) : null}
                            {can("clients.delete") ? (
                              <button className="btn sm danger" onClick={() => remove(client)}>
                                حذف
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager total={page.total} limit={limit} offset={offset} onChange={setOffset} onLimitChange={setLimit} />
                <PrintFooter title="سجل العملاء" />
              </>
            )}
          </Card>
        )}
      </Async>

      {creating || editing ? (
        <ClientForm
          key={editing?.id ?? "new"}
          client={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(message) => {
            setCreating(false);
            setEditing(null);
            toast.ok(message);
            state.reload();
          }}
        />
      ) : null}
    </>
  );
}

/** New client, or an existing one being edited.
 *
 *  The same fields either way — a client record has no "creation-only" part —
 *  so one form serves both and the verb changes with `client`. */
function ClientForm({
  client,
  onClose,
  onSaved,
}: {
  client?: Client;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = client !== undefined;
  const [form, setForm] = useState({
    name_ar: client?.name_ar ?? "",
    name_en: client?.name_en ?? "",
    national_id: client?.national_id ?? "",
    phone: client?.phone ?? "",
    phone2: client?.phone2 ?? "",
    email: client?.email ?? "",
    address: client?.address ?? "",
    project: client?.project ?? "",
    block: client?.block ?? "",
    floor_side: client?.floor_side ?? "",
    monthly_installment: client?.monthly_installment ? String(Number(client.monthly_installment)) : "",
    notes: client?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    const body = {
      name_ar: form.name_ar,
      name_en: form.name_en || null,
      national_id: form.national_id || null,
      phone: form.phone || null,
      phone2: form.phone2 || null,
      email: form.email || null,
      address: form.address || null,
      project: form.project || null,
      block: form.block || null,
      floor_side: form.floor_side || null,
      monthly_installment: form.monthly_installment.trim() || null,
      notes: form.notes || null,
    };
    try {
      if (editing) {
        await api.patch(`/api/clients/${client.id}`, body);
      } else {
        await api.post("/api/clients", { ...body, create_account: true });
      }
      onSaved(editing ? `حُفظت بيانات ${form.name_ar}` : `أُضيف العميل ${form.name_ar}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر الحفظ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={editing ? `تعديل — ${client.name_ar}` : "عميل جديد"}
      onClose={onClose}
      footer={
        <>
          <button className="btn primary" onClick={save} disabled={busy || !form.name_ar.trim()}>
            {busy ? "جارٍ الحفظ…" : "حفظ"}
          </button>
          <button className="btn" onClick={onClose}>
            إلغاء
          </button>
        </>
      }
    >
      {error ? <ErrorNote message={error} /> : null}

      <div className="note">
        <span>◈</span>
        {editing ? (
          <span>
            رقم الحساب <b className="mono">{client.code ?? client.account_id ?? "—"}</b> وحركته في دفتر
            الأستاذ لا يتغيّران بتعديل البيانات هنا.
          </span>
        ) : (
          /* The parent account is configured server-side (RECEIVABLE_PARENT_CODE),
             so the number is deliberately not spelled out here. */
          <span>سيُفتح للعميل حساب ذمم فرعي تلقائياً ضمن حسابات العملاء.</span>
        )}
      </div>

      <div className="form-row">
        <Field label="الاسم بالعربية">
          <input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} autoFocus />
        </Field>
        <Field label="الاسم بالإنجليزية">
          <input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
        </Field>
      </div>

      <div className="form-row">
        <Field label="الهاتف">
          <input
            className="mono-in"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </Field>
        <Field label="هاتف إضافي">
          <input
            className="mono-in"
            value={form.phone2}
            onChange={(e) => setForm({ ...form, phone2: e.target.value })}
          />
        </Field>
      </div>

      <div className="form-row">
        <Field label="رقم الهوية">
          <input
            className="mono-in"
            value={form.national_id}
            onChange={(e) => setForm({ ...form, national_id: e.target.value })}
          />
        </Field>
        <Field label="البريد الإلكتروني">
          <input
            className="mono-in"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
      </div>

      <div className="form-row">
        <Field label="المشروع والعقار" hint="مثلاً: الهدفة 432">
          <input value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} />
        </Field>
        <Field label="بلوك" hint="مثلاً: بلوك B3">
          <input value={form.block} onChange={(e) => setForm({ ...form, block: e.target.value })} />
        </Field>
        <Field label="طابق / جهة" hint="مثلاً: اول غربي">
          <input value={form.floor_side} onChange={(e) => setForm({ ...form, floor_side: e.target.value })} />
        </Field>
      </div>

      <Field label="القسط الشهري ($)" hint="اختياري — إن دفع العميل أقل منه في الشهر يظهر متأخراً في التنبيهات">
        <input
          className="mono-in"
          inputMode="decimal"
          value={form.monthly_installment}
          onChange={(e) => setForm({ ...form, monthly_installment: e.target.value })}
          placeholder="0.00"
        />
      </Field>

      <Field label="العنوان">
        <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </Field>

      <Field label="ملاحظات">
        <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </Field>
    </Modal>
  );
}
