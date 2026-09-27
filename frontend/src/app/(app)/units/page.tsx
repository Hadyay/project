"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";

import { useConfirm } from "@/components/Confirm";
import { ExportButtons, PrintFooter, ResultCount, useClampedOffset } from "@/components/Filters";
import { SearchPanel, type SearchSpec, type SearchValues } from "@/components/SearchPanel";
import { usePageSize } from "@/lib/paging";
import { useToast } from "@/components/Toast";
import { Amount, Async, Card, Doc, Empty, ErrorNote, Field, Head, Modal, Pager, Pill } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { UNIT_STATUS_AR, UNIT_TYPE_AR, count, money, unitPill } from "@/lib/format";
import type {
  ApartmentStatus,
  ApartmentType,
  ApartmentWithBuilding,
  BuildingWithCounts,
  Currency,
  Page,
} from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function UnitsPage() {
  return (
    <Suspense fallback={<div className="loading">جارٍ التحميل…</div>}>
      <UnitsInner />
    </Suspense>
  );
}

function UnitsInner() {
  const params = useSearchParams();
  const { can } = useAuth();

  const [buildingId, setBuildingId] = useState(params.get("building_id") ?? "");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = usePageSize("units");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ApartmentWithBuilding | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  async function remove(unit: ApartmentWithBuilding) {
    const ok = await confirm({
      title: `حذف الوحدة ${unit.unit_no}؟`,
      body: (
        <p>
          {unit.status === "sold" || unit.status === "rented"
            ? "هذه الوحدة مباعة أو مؤجّرة — احذفها فقط إذا سُجّلت بالخطأ، فالعقد المرتبط بها يبقى كما هو."
            : "الحذف دفتري: تختفي الوحدة من الجرد ولا تتأثّر أي قيود."}
        </p>
      ),
      confirmLabel: "حذف",
      danger: true,
    });
    if (!ok) return;

    try {
      await api.del(`/api/apartments/${unit.id}`);
      toast.ok(`حُذفت الوحدة ${unit.unit_no}`);
      state.reload();
    } catch (err) {
      toast.err(err instanceof Error ? err.message : "تعذّر الحذف");
    }
  }

  const buildingsFetcher = useCallback(
    () => api.get<Page<BuildingWithCounts>>("/api/buildings", { limit: 200 }),
    [],
  );
  const buildings = useApi(buildingsFetcher, []);

  const fetcher = useCallback(
    () =>
      api.get<Page<ApartmentWithBuilding>>("/api/apartments", {
        building_id: buildingId || undefined,
        unit_status: status || undefined,
        q: q || undefined,
        limit,
        offset,
      }),
    [buildingId, status, q, offset, limit],
  );
  const state = useApi(fetcher, [buildingId, status, q, offset, limit]);

  useClampedOffset(state.data?.total, offset, limit, setOffset);

  const buildingOptions = buildings.data?.items ?? [];

  // The search box: typed text, a building by name, and status under فلاتر.
  const searchValues: SearchValues = { q, building_id: buildingId, status };
  const searchSpecs: SearchSpec[] = [
    { kind: "text", key: "q", label: "رقم الوحدة / البناء" },
    {
      kind: "choice", key: "building_id", label: "البناء",
      options: buildingOptions.map((b) => ({ value: String(b.id), label: b.name, hint: b.code })),
    },
    {
      kind: "choice", key: "status", label: "الحالة",
      options: Object.entries(UNIT_STATUS_AR).map(([value, label]) => ({ value, label })),
    },
  ];
  function onSearch(patch: SearchValues) {
    const setters: Record<string, (value: string) => void> = {
      q: setQ, building_id: setBuildingId, status: setStatus,
    };
    for (const [key, value] of Object.entries(patch)) setters[key]?.(value);
    setOffset(0);
  }

  return (
    <>
      <Head
        title="الشقق والوحدات"
        subtitle="جرد المجمّع وحالة كل وحدة"
        actions={
          can("units.create") ? (
            <button className="btn primary" onClick={() => setCreating(true)}>
              + وحدة جديدة
            </button>
          ) : null
        }
      />

      <SearchPanel
        specs={searchSpecs}
        values={searchValues}
        onChange={onSearch}
        placeholder="ابحث برقم الوحدة أو اسم البناء…"
        summary={<ResultCount shown={state.data?.items.length ?? 0} total={state.data?.total ?? 0} noun="وحدة" />}
        actions={
          <ExportButtons
            filename="units"
            headers={["الوحدة", "البناء", "الطابق", "النوع", "المساحة", "الحالة", "السعر المعروض", "العملة"]}
            disabled={!state.data?.items.length}
            rows={() =>
              (state.data?.items ?? []).map((unit) => [
                unit.unit_no,
                unit.building_name,
                unit.floor,
                UNIT_TYPE_AR[unit.unit_type] ?? unit.unit_type,
                unit.area_m2,
                UNIT_STATUS_AR[unit.status],
                unit.listed_price,
                unit.price_currency_code,
              ])
            }
          />
        }
      />

      <Async state={state}>
        {(page) => (
          <Card>
            {page.items.length === 0 ? (
              <Empty title="لا وحدات مطابقة" hint="جرّب تغيير الفلاتر أو أضف وحدة جديدة." />
            ) : (
              <>
                <div className="tbl-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>الوحدة</th>
                        <th>البناء</th>
                        <th>الطابق</th>
                        <th>النوع</th>
                        <th className="num">المساحة</th>
                        <th>الحالة</th>
                        <th className="num">السعر المعروض</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {page.items.map((unit) => (
                        <tr key={unit.id}>
                          <td>
                            <Doc>{unit.unit_no}</Doc>
                          </td>
                          <td className="nm">{unit.building_name ?? "—"}</td>
                          <td>
                            <span className="mono">{unit.floor ?? "—"}</span>
                          </td>
                          <td className="sub">{UNIT_TYPE_AR[unit.unit_type] ?? unit.unit_type}</td>
                          <td className="num">
                            <span className="mono">{unit.area_m2 ? money(unit.area_m2, 0) : "—"}</span>
                          </td>
                          <td>
                            <Pill tone={unitPill(unit.status)}>{UNIT_STATUS_AR[unit.status]}</Pill>
                          </td>
                          <td className="num">
                            {unit.listed_price ? (
                              <Amount value={unit.listed_price} sub={unit.price_currency_code ?? undefined} />
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="num no-print">
                            {can("units.edit") ? (
                              <button className="btn sm" onClick={() => setEditing(unit)}>
                                تعديل
                              </button>
                            ) : null}
                            {can("units.delete") ? (
                              <button className="btn sm danger" onClick={() => remove(unit)}>
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
                <PrintFooter title="جرد الوحدات" />
              </>
            )}
          </Card>
        )}
      </Async>

      {creating || editing ? (
        <UnitForm
          key={editing?.id ?? "new"}
          unit={editing ?? undefined}
          buildings={buildingOptions}
          defaultBuildingId={buildingId}
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

function UnitForm({
  unit,
  buildings,
  defaultBuildingId,
  onClose,
  onSaved,
}: {
  unit?: ApartmentWithBuilding;
  buildings: BuildingWithCounts[];
  defaultBuildingId: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = unit !== undefined;
  const currencies = useApi(useCallback(() => api.get<Currency[]>("/api/currencies"), []), []);
  const [form, setForm] = useState({
    building_id: String(unit?.building_id ?? defaultBuildingId ?? buildings[0]?.id ?? ""),
    unit_no: unit?.unit_no ?? "",
    floor: unit?.floor != null ? String(unit.floor) : "",
    area_m2: unit?.area_m2 ?? "",
    unit_type: unit?.unit_type ?? "apartment",
    status: (unit?.status ?? "available") as ApartmentStatus,
    listed_price: unit?.listed_price ?? "",
    price_currency_id: unit?.price_currency_id != null ? String(unit.price_currency_id) : "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const baseCurrency = useMemo(
    () => currencies.data?.find((c) => c.is_base),
    [currencies.data],
  );

  async function save() {
    setBusy(true);
    setError(null);
    const body = {
      building_id: Number(form.building_id),
      unit_no: form.unit_no,
      floor: form.floor ? Number(form.floor) : null,
      area_m2: form.area_m2 || null,
      unit_type: form.unit_type,
      status: form.status,
      listed_price: form.listed_price || null,
      price_currency_id: form.price_currency_id
        ? Number(form.price_currency_id)
        : (baseCurrency?.id ?? null),
    };
    try {
      if (editing) await api.patch(`/api/apartments/${unit.id}`, body);
      else await api.post("/api/apartments", body);
      onSaved(editing ? `حُفظت الوحدة ${form.unit_no}` : `أُضيفت الوحدة ${form.unit_no}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر الحفظ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={editing ? `تعديل الوحدة ${unit.unit_no}` : "وحدة جديدة"}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn primary"
            onClick={save}
            disabled={busy || !form.unit_no.trim() || !form.building_id}
          >
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
        <Field label="البناء">
          <select value={form.building_id} onChange={(e) => setForm({ ...form, building_id: e.target.value })}>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="رقم الوحدة">
          <input
            className="mono-in"
            value={form.unit_no}
            onChange={(e) => setForm({ ...form, unit_no: e.target.value })}
            autoFocus
          />
        </Field>
      </div>

      <div className="form-row">
        <Field label="الطابق">
          <input
            className="mono-in"
            type="number"
            value={form.floor}
            onChange={(e) => setForm({ ...form, floor: e.target.value })}
          />
        </Field>
        <Field label="المساحة (م²)">
          <input
            className="mono-in"
            type="number"
            step="0.01"
            value={form.area_m2}
            onChange={(e) => setForm({ ...form, area_m2: e.target.value })}
          />
        </Field>
      </div>

      <div className="form-row">
        <Field label="النوع">
          <select
            value={form.unit_type}
            onChange={(e) => setForm({ ...form, unit_type: e.target.value as ApartmentType })}
          >
            {Object.entries(UNIT_TYPE_AR).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="الحالة">
          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as ApartmentStatus })}
          >
            {Object.entries(UNIT_STATUS_AR).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="form-row">
        <Field label="السعر المعروض">
          <input
            className="mono-in"
            type="number"
            step="0.01"
            value={form.listed_price}
            onChange={(e) => setForm({ ...form, listed_price: e.target.value })}
          />
        </Field>
        <Field label="العملة">
          <select
            value={form.price_currency_id}
            onChange={(e) => setForm({ ...form, price_currency_id: e.target.value })}
          >
            <option value="">{baseCurrency ? `${baseCurrency.name_ar} (أساسية)` : "—"}</option>
            {(currencies.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name_ar}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
