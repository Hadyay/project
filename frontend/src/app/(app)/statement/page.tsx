"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fold } from "@/components/SearchPanel";
import { Statement } from "@/components/Statement";
import { Empty, Head } from "@/components/ui";
import { monthsLabel } from "@/lib/alerts";
import { api } from "@/lib/api";
import { count, money, num } from "@/lib/format";
import { ALL_ROWS } from "@/lib/paging";
import type { ClientListItem, Page } from "@/lib/types";
import { useApi } from "@/lib/useApi";

type Show = "all" | "owes" | "late" | "credit";

const SHOW: { key: Show; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "owes", label: "مدين" },
  { key: "late", label: "متأخر" },
  { key: "credit", label: "دائن" },
];

export default function StatementPage() {
  return (
    <Suspense fallback={<div className="loading">جارٍ التحميل…</div>}>
      <StatementInner />
    </Suspense>
  );
}

/** كشف حساب: every client on one side — searchable, filterable, balance and
 *  late mark on each — and the chosen client's statement on the other. The
 *  choice lives in the URL (?client=ID), so a statement can be linked to,
 *  reloaded and reached with the browser's back button. */
function StatementInner() {
  const router = useRouter();
  const clientId = useSearchParams().get("client") ?? "";
  const clients = useApi(
    useCallback(() => api.get<Page<ClientListItem>>("/api/clients", { limit: ALL_ROWS }), []),
    [],
  );

  const [q, setQ] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [sort, setSort] = useState<"name" | "balance">("name");
  const listRef = useRef<HTMLDivElement>(null);

  const all = clients.data?.items ?? [];
  const counts: Record<Show, number> = {
    all: all.length,
    owes: all.filter((c) => num(c.balance_base) > 0.005).length,
    late: all.filter((c) => c.late).length,
    credit: all.filter((c) => num(c.balance_base) < -0.005).length,
  };

  const rows = useMemo(() => {
    const needle = fold(q);
    const hit = all.filter((c) => {
      const bal = num(c.balance_base);
      if (show === "owes" && !(bal > 0.005)) return false;
      if (show === "late" && !c.late) return false;
      if (show === "credit" && !(bal < -0.005)) return false;
      if (!needle) return true;
      return [c.name_ar, c.name_en, c.code, c.phone, c.phone2, c.project, c.block].some(
        (v) => v && fold(v).includes(needle),
      );
    });
    if (sort === "balance") hit.sort((a, b) => num(b.balance_base) - num(a.balance_base));
    return hit;
  }, [all, q, show, sort]);

  const selected = all.find((c) => String(c.id) === clientId);

  function pick(id: number) {
    router.replace(`/statement?client=${id}`, { scroll: false });
  }

  // Keep the chosen client in view in the list (after a reload, a link) —
  // by scrolling the list alone: scrollIntoView would scroll the page too.
  useEffect(() => {
    const list = listRef.current;
    const on = list?.querySelector<HTMLElement>(".st-item.on");
    if (!list || !on) return;
    const offset = on.getBoundingClientRect().top - list.getBoundingClientRect().top;
    if (offset < 0 || offset > list.clientHeight - on.offsetHeight) list.scrollTop += offset - list.clientHeight / 2;
  }, [clientId, rows.length]);

  return (
    <>
      <Head
        title="كشف حساب"
        subtitle={
          selected ? `${selected.name_ar} — ${selected.code ?? ""}` : "اختر عميلاً من القائمة، أو ابحث بالاسم أو الرمز أو الهاتف"
        }
      />

      <div className={`st-layout${clientId ? " picked" : ""}`}>
        <aside className="st-list card no-print" aria-label="العملاء">
          <div className="st-tools">
            <input
              className="st-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                // Enter opens the first match: type a name, press Enter, read.
                if (e.key === "Enter" && rows[0]) pick(rows[0].id);
              }}
              placeholder="ابحث بالاسم، الرمز، الهاتف، المشروع…"
              autoFocus={!clientId}
            />
            <div className="st-chips" role="tablist">
              {SHOW.map((s) => (
                <button
                  key={s.key}
                  role="tab"
                  aria-selected={show === s.key}
                  className={`st-chip${show === s.key ? " on" : ""}${s.key === "late" ? " red" : ""}`}
                  onClick={() => setShow(s.key)}
                >
                  {s.label} <span className="mono">{count(counts[s.key])}</span>
                </button>
              ))}
            </div>
            <div className="st-sort">
              <span className="sub">{`${count(rows.length)} عميل`}</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as "name" | "balance")}>
                <option value="name">ترتيب بالاسم</option>
                <option value="balance">الأكبر رصيداً أولاً</option>
              </select>
            </div>
          </div>

          <div className="st-items" ref={listRef}>
            {clients.loading && !clients.data ? (
              <div className="loading">جارٍ التحميل…</div>
            ) : rows.length === 0 ? (
              <div className="st-none sub">لا عملاء مطابقون</div>
            ) : (
              rows.map((c) => {
                const bal = num(c.balance_base);
                return (
                  <button
                    key={c.id}
                    className={`st-item${String(c.id) === clientId ? " on" : ""}${c.late ? " late" : ""}`}
                    onClick={() => pick(c.id)}
                  >
                    <span className="st-nm" translate="no">
                      {c.name_ar}
                    </span>
                    <span className={`st-bal mono${bal > 0.005 ? " dr" : bal < -0.005 ? " cr" : ""}`}>
                      {money(Math.abs(bal))}
                    </span>
                    <span className="st-meta">
                      <span className="mono">{c.code}</span>
                      {c.project ? <span translate="no">{` · ${c.project}`}</span> : null}
                    </span>
                    {c.late ? (
                      <span className="st-late">🔔 {monthsLabel(c.months_unpaid)}</span>
                    ) : (
                      <span className="st-side sub">{bal > 0.005 ? "مدين" : bal < -0.005 ? "دائن" : "مسدّد"}</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="st-main">
          {clientId ? (
            <>
              <button className="btn sm st-back no-print" onClick={() => router.replace("/statement", { scroll: false })}>
                → كل العملاء
              </button>
              <Statement key={clientId} clientId={Number(clientId)} />
            </>
          ) : (
            <div className="card">
              <Empty
                title="اختر عميلاً"
                hint={`${count(all.length)} عميل في السجل — اختر من القائمة، أو اكتب الاسم واضغط Enter.`}
              />
            </div>
          )}
        </section>
      </div>
    </>
  );
}
