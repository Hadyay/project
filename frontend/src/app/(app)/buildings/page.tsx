"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { useConfirm } from "@/components/Confirm";
import { ExportButtons, PrintFooter, ResultCount } from "@/components/Filters";
import { SearchPanel, type SearchSpec, type SearchValues } from "@/components/SearchPanel";
import { useToast } from "@/components/Toast";
import { Async, Card, Empty, ErrorNote, Field, Head, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { count } from "@/lib/format";
import { ALL_ROWS } from "@/lib/paging";
import type { BuildingWithCounts, Page } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function BuildingsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BuildingWithCounts | null>(null);

  // Every building, not a first page: the city filter and its list of cities
  // are worked out from what was fetched, so a cap would silently drop some.
  const fetcher = useCallback(
    () => api.get<Page<BuildingWithCounts>>("/api/buildings", { q, limit: ALL_ROWS }),
    [q],
  );
  const state = useApi(fetcher, [q]);

  const all = state.data?.items ?? [];
  const cities = Array.from(new Set(all.map((b) => b.city).filter(Boolean))) as string[];
  const shown = city ? all.filter((b) => b.city === city) : all;
  const filtered = Boolean(q.trim() || city);

  // The search box: typed text plus a city, picked by name or from فلاتر.
  const searchValues: SearchValues = { q, city };
  const searchSpecs: SearchSpec[] = [
    { kind: "text", key: "q", label: "اسم البناء / الرمز" },
    { kind: "choice", key: "city", label: "المدينة", options: cities.map((name) => ({ value: name, label: name })) },
  ];
  function onSearch(patch: SearchValues) {
    if ("q" in patch) setQ(patch.q);
    if ("city" in patch) setCity(patch.city);
  }

  async function remove(building: BuildingWithCounts) {
    const ok = await confirm({
      title: `حذف البناء ${building.name}؟`,
      body: (
        <p>
          {building.units.total > 0
            ? `في هذا البناء ${building.units.total} وحدة — ستبقى مسجّلة تحته بعد الحذف.`
            : "لا وحدات مسجّلة تحت هذا البناء."}
        </p>
      ),
      confirmLabel: "حذف",
      danger: true,
    });
    if (!ok) return;

    try {
      await api.del(`/api/buildings/${building.id}`);
      toast.ok(`حُذف البناء ${building.name}`);
      state.reload();
    } catch (err) {
      toast.err(err instanceof Error ? err.message : "تعذّر الحذف");
    }
  }

  return (
    <>
      <Head
        title="الأبنية"
        subtitle="المجمّع وتوزيع وحداته"
        actions={
          can("buildings.create") ? (
            <button className="btn primary" onClick={() => setCreating(true)}>
              + بناء جديد
            </button>
          ) : null
        }
      />

      <SearchPanel
        specs={searchSpecs}
        values={searchValues}
        onChange={onSearch}
        placeholder="ابحث باسم البناء أو رمزه أو المدينة…"
        summary={<ResultCount shown={shown.length} total={state.data?.total ?? 0} noun="بناء" />}
        actions={
          <ExportButtons
            filename="buildings"
            headers={["الاسم", "الرمز", "المدينة", "العنوان", "الطوابق", "الوحدات", "مباعة", "مؤجّرة", "محجوزة", "متاحة"]}
            disabled={shown.length === 0}
            rows={() =>
              shown.map((b) => [
                b.name,
                b.code,
                b.city,
                b.address,
                b.floors_count,
                b.units.total,
                b.units.sold,
                b.units.rented,
                b.units.reserved,
                b.units.available,
              ])
            }
          />
        }
      />

      <Async state={state}>
        {() =>
          shown.length === 0 ? (
            <div className="card">
              {/* `q` is a server-side filter, so page.total is already the
                  filtered count and cannot tell "none exist" from "none match".
                  The filters themselves can. */}
              <Empty
                title={filtered ? "لا أبنية مطابقة" : "لا أبنية بعد"}
                hint={
                  filtered
                    ? "جرّب مسح الفلاتر."
                    : "أضف أول بناء لتبدأ بتسجيل الوحدات والعقود."
                }
                action={
                  filtered ? null : can("buildings.create") ? (
                    <button className="btn primary" onClick={() => setCreating(true)}>
                      + بناء جديد
                    </button>
                  ) : null
                }
              />
            </div>
          ) : (
            <Card>
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>البناء</th>
                      <th>الرمز</th>
                      <th>المدينة</th>
                      <th>العنوان</th>
                      <th className="num">الطوابق</th>
                      <th className="num">الوحدات</th>
                      <th className="num">مباعة</th>
                      <th className="num">مؤجّرة</th>
                      <th className="num">محجوزة</th>
                      <th className="num">متاحة</th>
                      <th>التوزيع</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((building) => (
                      <BuildingRow
                        key={building.id}
                        building={building}
                        onEdit={can("buildings.edit") ? () => setEditing(building) : undefined}
                        onDelete={can("buildings.delete") ? () => remove(building) : undefined}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <PrintFooter title="الأبنية" />
            </Card>
          )
        }
      </Async>

      {creating || editing ? (
        <BuildingForm
          key={editing?.id ?? "new"}
          building={editing ?? undefined}
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

function BuildingRow({
  building,
  onEdit,
  onDelete,
}: {
  building: BuildingWithCounts;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const { units } = building;
  const total = units.total || 1;
  const unitsHref = `/units?building_id=${building.id}`;

  return (
    <tr>
      <td className="nm">
        <Link href={unitsHref}>{building.name}</Link>
      </td>
      <td>
        <span className="mono">{building.code ?? "—"}</span>
      </td>
      <td>{building.city ?? "—"}</td>
      <td className="sub">{building.address ?? "—"}</td>
      <td className="num">
        <span className="mono">{building.floors_count ?? "—"}</span>
      </td>
      <td className="num">
        <b className="mono">{count(units.total)}</b>
      </td>
      <td className="num">
        <span className="mono">{count(units.sold)}</span>
      </td>
      <td className="num">
        <span className="mono">{count(units.rented)}</span>
      </td>
      <td className="num">
        <span className="mono">{count(units.reserved)}</span>
      </td>
      <td className="num">
        <span className="mono">{count(units.available)}</span>
      </td>
      <td className="bld-bar">
        {units.total > 0 ? (
          <div className="bar">
            <i className="s" style={{ width: `${(units.sold / total) * 100}%` }} />
            <i className="r" style={{ width: `${(units.rented / total) * 100}%` }} />
            <i className="v" style={{ width: `${(units.available / total) * 100}%` }} />
          </div>
        ) : (
          <span className="sub">لا وحدات</span>
        )}
      </td>
      <td className="num no-print" style={{ whiteSpace: "nowrap" }}>
        <Link className="btn sm" href={unitsHref}>
          الوحدات
        </Link>{" "}
        {onEdit ? (
          <button className="btn sm" onClick={onEdit}>
            تعديل
          </button>
        ) : null}{" "}
        {onDelete ? (
          <button className="btn sm danger" onClick={onDelete}>
            حذف
          </button>
        ) : null}
      </td>
    </tr>
  );
}

function BuildingForm({
  building,
  onClose,
  onSaved,
}: {
  building?: BuildingWithCounts;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = building !== undefined;
  const [form, setForm] = useState({
    name: building?.name ?? "",
    code: building?.code ?? "",
    city: building?.city ?? "",
    address: building?.address ?? "",
    floors_count: building?.floors_count != null ? String(building.floors_count) : "",
    description: building?.description ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    const body = {
      name: form.name,
      code: form.code || null,
      city: form.city || null,
      address: form.address || null,
      floors_count: form.floors_count ? Number(form.floors_count) : null,
      description: form.description || null,
    };
    try {
      if (editing) await api.patch(`/api/buildings/${building.id}`, body);
      else await api.post("/api/buildings", body);
      onSaved(editing ? `حُفظ البناء ${form.name}` : `أُضيف البناء ${form.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر الحفظ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={editing ? `تعديل — ${building.name}` : "بناء جديد"}
      onClose={onClose}
      footer={
        <>
          <button className="btn primary" onClick={save} disabled={busy || !form.name.trim()}>
            {busy ? "جارٍ الحفظ…" : "حفظ"}
          </button>
          <button className="btn" onClick={onClose}>
            إلغاء
          </button>
        </>
      }
    >
      {error ? <ErrorNote message={error} /> : null}

      <div className="form-row">
        <Field label="اسم البناء">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </Field>
        <Field label="الرمز">
          <input
            className="mono-in"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
        </Field>
      </div>

      <div className="form-row">
        <Field label="المدينة">
          <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </Field>
        <Field label="عدد الطوابق">
          <input
            className="mono-in"
            type="number"
            min={0}
            value={form.floors_count}
            onChange={(e) => setForm({ ...form, floors_count: e.target.value })}
          />
        </Field>
      </div>

      <Field label="العنوان">
        <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </Field>

      <Field label="ملاحظات">
        <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
    </Modal>
  );
}
