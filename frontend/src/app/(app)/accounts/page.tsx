"use client";

import { useCallback, useMemo, useState, type ReactElement } from "react";

import { ExportButtons, PrintFooter, ResultCount } from "@/components/Filters";
import { SearchPanel, type SearchSpec, type SearchValues } from "@/components/SearchPanel";
import { useToast } from "@/components/Toast";
import { Async, Card, Doc, Empty, ErrorNote, Field, Head, Modal, Pill } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ACCOUNT_TYPE_AR, isoDate, money, num } from "@/lib/format";
import { downloadCsv, exportName } from "@/lib/export";
import type { AccountLedger, AccountTreeNode, AccountType } from "@/lib/types";
import { useApi } from "@/lib/useApi";

/** Depth-first walk, parents before children — the order the table shows. */
function flatten(nodes: AccountTreeNode[], depth = 0): { node: AccountTreeNode; depth: number }[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)]);
}

/** Keep the accounts that match, and every ancestor that leads to one — a
 *  chart pruned to its matches still has to be a tree, or the indentation
 *  stops meaning anything. */
function pruneTree(
  nodes: AccountTreeNode[],
  matches: (node: AccountTreeNode) => boolean,
): AccountTreeNode[] {
  return nodes
    .map((node) => ({ ...node, children: pruneTree(node.children, matches) }))
    .filter((node) => node.children.length > 0 || matches(node));
}

export default function AccountsPage() {
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const [ledgerFor, setLedgerFor] = useState<AccountTreeNode | null>(null);
  const [accountEdit, setAccountEdit] = useState<AccountTreeNode | null>(null);
  const toast = useToast();
  const [q, setQ] = useState("");
  const [accountType, setAccountType] = useState("");
  const [kind, setKind] = useState("");

  const state = useApi(useCallback(() => api.get<AccountTreeNode[]>("/api/accounts/tree"), []), []);

  const full = state.data ?? [];
  const tree = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle && !accountType && !kind) return full;
    return pruneTree(full, (node) => {
      if (accountType && node.account_type !== accountType) return false;
      if (kind === "client" && !node.is_client) return false;
      if (kind === "cash" && !node.is_cash_bank) return false;
      if (kind === "postable" && !node.is_postable) return false;
      if (!needle) return true;
      return (
        node.code.toLowerCase().includes(needle) ||
        node.name_ar.toLowerCase().includes(needle) ||
        (node.name_en ?? "").toLowerCase().includes(needle)
      );
    });
  }, [full, q, accountType, kind]);

  const KIND_AR: Record<string, string> = {
    client: "ذمم عملاء",
    cash: "صناديق ومصارف",
    postable: "قابلة للقيد",
  };


  // The search box: typed code or name, plus type and property under فلاتر.
  const searchValues: SearchValues = { q, account_type: accountType, kind };
  const searchSpecs: SearchSpec[] = [
    { kind: "text", key: "q", label: "رمز الحساب أو اسمه" },
    {
      kind: "choice", key: "account_type", label: "النوع",
      options: Object.entries(ACCOUNT_TYPE_AR).map(([value, label]) => ({ value, label })),
    },
    {
      kind: "choice", key: "kind", label: "الخاصية",
      options: Object.entries(KIND_AR).map(([value, label]) => ({ value, label })),
    },
  ];
  function onSearch(patch: SearchValues) {
    const setters: Record<string, (value: string) => void> = {
      q: setQ, account_type: setAccountType, kind: setKind,
    };
    for (const [key, value] of Object.entries(patch)) setters[key]?.(value);
  }

  return (
    <>
      <Head
        title="دليل الحسابات"
        subtitle="شجرة الحسابات المحاسبية"
        actions={
          can("accounts.create") ? (
            <button className="btn primary" onClick={() => setCreating(true)}>+ حساب جديد</button>
          ) : null
        }
      />

      <SearchPanel
        specs={searchSpecs}
        values={searchValues}
        onChange={onSearch}
        placeholder="ابحث برمز الحساب أو اسمه…"
        summary={<ResultCount shown={flatten(tree).length} total={flatten(full).length} noun="حساب" />}
        actions={
          <ExportButtons
            filename="chart-of-accounts"
            headers={["الرمز", "الحساب", "الاسم بالإنجليزية", "النوع", "المستوى", "قابل للقيد", "ذمم عميل", "صندوق/مصرف"]}
            disabled={tree.length === 0}
            rows={() =>
              flatten(tree).map(({ node, depth }) => [
                node.code,
                node.name_ar,
                node.name_en,
                ACCOUNT_TYPE_AR[node.account_type] ?? node.account_type,
                depth + 1,
                node.is_postable ? "نعم" : "لا",
                node.is_client ? "نعم" : "لا",
                node.is_cash_bank ? "نعم" : "لا",
              ])
            }
          />
        }
      />

      <Async state={state}>
        {() => (
          <Card>
            {tree.length === 0 ? (
              <Empty
                title={full.length ? "لا حسابات مطابقة" : "لا حسابات"}
                hint={full.length ? "جرّب مسح الفلاتر." : "شغّل سكربت التهيئة لإنشاء الشجرة الأساسية."}
              />
            ) : (
              <>
                <div className="tbl-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>الرمز</th>
                        <th>الحساب</th>
                        <th>النوع</th>
                        <th>الخصائص</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {tree.flatMap((node) =>
                        renderNode(node, 0, setLedgerFor, can("accounts.edit") ? setAccountEdit : undefined),
                      )}
                    </tbody>
                  </table>
                </div>
                <PrintFooter title="دليل الحسابات" />
              </>
            )}
          </Card>
        )}
      </Async>

      {creating || accountEdit ? (
        <AccountForm
          key={accountEdit?.id ?? "new"}
          account={accountEdit ?? undefined}
          onClose={() => {
            setCreating(false);
            setAccountEdit(null);
          }}
          onSaved={(message) => {
            setCreating(false);
            setAccountEdit(null);
            toast.ok(message);
            state.reload();
          }}
        />
      ) : null}

      {ledgerFor ? <LedgerModal account={ledgerFor} onClose={() => setLedgerFor(null)} /> : null}
    </>
  );
}

function renderNode(
  node: AccountTreeNode,
  depth: number,
  openLedger: (node: AccountTreeNode) => void,
  openEdit?: (node: AccountTreeNode) => void,
): ReactElement[] {
  const row = (
    <tr key={node.id}>
      <td>
        <Doc>{node.code}</Doc>
      </td>
      <td>
        {/* Indentation carries the hierarchy; RTL means padding on the right. */}
        <span style={{ paddingRight: depth * 18 }} className={node.is_postable ? "" : "nm"}>
          {node.name_ar}
        </span>
        {node.name_en ? <div className="sub" style={{ paddingRight: depth * 18 }}>{node.name_en}</div> : null}
      </td>
      <td className="sub">{ACCOUNT_TYPE_AR[node.account_type] ?? node.account_type}</td>
      <td>
        {!node.is_postable ? <Pill tone="gray">رئيسي</Pill> : null}
        {node.is_client ? <Pill tone="wait">ذمم عميل</Pill> : null}
        {node.is_cash_bank ? <Pill tone="ok">صندوق / مصرف</Pill> : null}
      </td>
      <td className="num no-print">
        {node.is_postable ? (
          <button className="btn sm" onClick={() => openLedger(node)}>الأستاذ</button>
        ) : null}
        {openEdit ? (
          <button className="btn sm" onClick={() => openEdit(node)}>تعديل</button>
        ) : null}
      </td>
    </tr>
  );

  return [
    row,
    ...node.children.flatMap((child) => renderNode(child, depth + 1, openLedger, openEdit)),
  ];
}

function LedgerModal({ account, onClose }: { account: AccountTreeNode; onClose: () => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const state = useApi(
    useCallback(
      () =>
        api.get<AccountLedger>(`/api/reports/account-ledger/${account.id}`, {
          date_from: from || undefined,
          date_to: to || undefined,
        }),
      [account.id, from, to],
    ),
    [account.id, from, to],
  );

  return (
    <Modal
      title={`دفتر الأستاذ — ${account.name_ar}`}
      wide
      onClose={onClose}
      footer={
        <>
          <button
            className="btn"
            disabled={!state.data?.rows.length}
            onClick={() =>
              downloadCsv(
                exportName(`ledger-${account.code}`),
                ["التاريخ", "المستند", "البيان", "مدين", "دائن", "الرصيد"],
                (state.data?.rows ?? []).map((row) => [
                  isoDate(row.entry_date),
                  row.entry_no,
                  row.line_desc,
                  row.debit_base,
                  row.credit_base,
                  row.running_balance_base,
                ]),
              )
            }
          >
            ⤓ تصدير CSV
          </button>
          <button className="btn" onClick={onClose}>إغلاق</button>
        </>
      }
    >
      <div className="filters">
        <Field label="من تاريخ">
          <input className="mono-in" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="إلى تاريخ">
          <input className="mono-in" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>

      <Async state={state}>
        {(ledger) =>
          ledger.rows.length === 0 ? (
            <Empty title="لا حركات" hint="لا قيود على هذا الحساب في الفترة المحددة." />
          ) : (
            <>
              <div className="tbl-wrap">
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>المستند</th>
                      <th>البيان</th>
                      <th className="num">مدين</th>
                      <th className="num">دائن</th>
                      <th className="num">الرصيد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.rows.map((row, index) => (
                      <tr key={`${row.entry_no}-${index}`}>
                        <td><Doc>{isoDate(row.entry_date)}</Doc></td>
                        <td><Doc>{row.entry_no}</Doc></td>
                        <td className="sub">{row.line_desc ?? "—"}</td>
                        <td className="num mono" style={{ color: "var(--debit)" }}>
                          {num(row.debit_base) ? money(row.debit_base) : "—"}
                        </td>
                        <td className="num mono" style={{ color: "var(--credit)" }}>
                          {num(row.credit_base) ? money(row.credit_base) : "—"}
                        </td>
                        <td className="bal-col">{money(row.running_balance_base)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="je-bal" style={{ justifyContent: "space-between" }}>
                <span>الرصيد الختامي</span>
                <span className="mono">{money(ledger.closing_balance)}</span>
              </div>
            </>
          )
        }
      </Async>
    </Modal>
  );
}

/** New account, or an existing one being renamed/reclassified.
 *
 *  The code is not editable: it is the key every posting, every report and the
 *  configured special accounts refer to, and the API's update schema leaves it
 *  out for that reason. */
function AccountForm({
  account,
  onClose,
  onSaved,
}: {
  account?: AccountTreeNode;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = account !== undefined;
  const [form, setForm] = useState({
    code: account?.code ?? "",
    name_ar: account?.name_ar ?? "",
    name_en: account?.name_en ?? "",
    account_type: (account?.account_type ?? "asset") as AccountType,
    is_cash_bank: account?.is_cash_bank ?? false,
    is_postable: account?.is_postable ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await api.patch(`/api/accounts/${account.id}`, {
          name_ar: form.name_ar,
          name_en: form.name_en || null,
          account_type: form.account_type,
          is_cash_bank: form.is_cash_bank,
          is_postable: form.is_postable,
        });
      } else {
        await api.post("/api/accounts", {
          code: form.code,
          name_ar: form.name_ar,
          name_en: form.name_en || null,
          account_type: form.account_type,
          is_cash_bank: form.is_cash_bank,
          is_postable: form.is_postable,
          is_client: false,
          parent_id: null,
        });
      }
      onSaved(editing ? `حُفظ الحساب ${form.code}` : `أُضيف الحساب ${form.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر الحفظ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={editing ? `تعديل الحساب ${account.code}` : "حساب جديد"}
      onClose={onClose}
      footer={
        <>
          <button className="btn primary" onClick={save} disabled={busy || !form.code.trim() || !form.name_ar.trim()}>
            {busy ? "جارٍ الحفظ…" : "حفظ"}
          </button>
          <button className="btn" onClick={onClose}>إلغاء</button>
        </>
      }
    >
      {error ? <ErrorNote message={error} /> : null}

      <div className="note">
        <span>◈</span>
        <span>الحساب الأب يُشتق من الرمز — مثلاً ١١٢٠٠٠٠٣ يقع تحت ١١٢٠.</span>
      </div>

      <div className="form-row">
        <Field label="الرمز">
          <input
            className="mono-in"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            disabled={editing}
            autoFocus={!editing}
          />
        </Field>
        <Field label="النوع">
          <select value={form.account_type}
                  onChange={(e) => setForm({ ...form, account_type: e.target.value as AccountType })}>
            {Object.entries(ACCOUNT_TYPE_AR).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="form-row">
        <Field label="الاسم بالعربية">
          <input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} />
        </Field>
        <Field label="الاسم بالإنجليزية">
          <input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
        </Field>
      </div>

      <div className="form-row">
        <Field label="حساب صندوق / مصرف">
          <select value={String(form.is_cash_bank)}
                  onChange={(e) => setForm({ ...form, is_cash_bank: e.target.value === "true" })}>
            <option value="false">لا</option>
            <option value="true">نعم</option>
          </select>
        </Field>
        <Field label="يقبل القيود" hint="الحسابات الرئيسية لا تقبل قيوداً مباشرة">
          <select value={String(form.is_postable)}
                  onChange={(e) => setForm({ ...form, is_postable: e.target.value === "true" })}>
            <option value="true">نعم</option>
            <option value="false">لا — حساب رئيسي</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}
