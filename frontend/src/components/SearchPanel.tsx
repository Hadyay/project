"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/* One search box per screen, in the manner of Odoo's control panel.
 *
 * Every filter a screen offers is a *spec*. Typing proposes "search <field>
 * for …" for the text specs and lists matching options for the choice specs
 * (a client by name, an account, a status); Enter or a click turns the pick
 * into a facet — a removable tag inside the box. The فلاتر menu holds what is
 * better chosen than typed: short option lists, date presets, ranges.
 *
 * The component owns no filter state. The screen passes `values` (keyed by the
 * query parameter each spec drives) and receives `onChange(patch)`, so the
 * server-side filtering, paging rewinds and URL presets stay where they were. */

export interface SearchOption {
  value: string;
  label: string;
  /** Secondary text in suggestions, e.g. an account code beside a name. */
  hint?: string | null;
}

export type SearchSpec =
  /** Free text sent as-is — the screen's `q`, a document number… */
  | { kind: "text"; key: string; label: string }
  /** One value out of a list. `suggest` offers matches while typing (default
   *  on); `menu` lists them under فلاتر (default on for short lists). */
  | { kind: "choice"; key: string; label: string; options: SearchOption[]; suggest?: boolean; menu?: boolean }
  /** A period, from presets or two dates. */
  | { kind: "dates"; from: string; to: string; label: string }
  /** A numeric range. */
  | { kind: "range"; min: string; max: string; label: string }
  /** One date or number typed in the فلاتر menu — "as of", "at least N days". */
  | { kind: "input"; key: string; label: string; type: "date" | "number"; placeholder?: string };

export type SearchValues = Record<string, string>;

interface Facet {
  id: string;
  label: string;
  value: string;
  clear: SearchValues;
}

interface Suggestion {
  id: string;
  label: string;
  value: string;
  hint?: string | null;
  patch: SearchValues;
}

const MENU_LIMIT = 30;
const SUGGEST_PER_SPEC = 6;

/** Arabic-insensitive matching: diacritics, hamza forms of alef, taa marbuta
 *  and alef maqsura are how the same name gets typed three different ways. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .trim();
}

function iso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function datePresets(): { label: string; from: string; to: string }[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  return [
    { label: "اليوم", from: iso(now), to: iso(now) },
    { label: "هذا الشهر", from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) },
    { label: "الشهر الماضي", from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) },
    { label: "هذه السنة", from: `${y}-01-01`, to: `${y}-12-31` },
    { label: "السنة الماضية", from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
  ];
}

function rangeText(a: string, b: string): string {
  if (a && b) return `${a} ← ${b}`;
  if (a) return `من ${a}`;
  return `حتى ${b}`;
}

function facetsOf(specs: SearchSpec[], values: SearchValues): Facet[] {
  const out: Facet[] = [];
  for (const spec of specs) {
    if (spec.kind === "text" && values[spec.key]) {
      out.push({ id: spec.key, label: spec.label, value: values[spec.key], clear: { [spec.key]: "" } });
    } else if (spec.kind === "choice" && values[spec.key]) {
      const option = spec.options.find((o) => o.value === values[spec.key]);
      out.push({
        id: spec.key,
        label: spec.label,
        value: option?.label ?? values[spec.key],
        clear: { [spec.key]: "" },
      });
    } else if (spec.kind === "dates" && (values[spec.from] || values[spec.to])) {
      const preset = datePresets().find((p) => p.from === values[spec.from] && p.to === values[spec.to]);
      out.push({
        id: `${spec.from}:${spec.to}`,
        label: spec.label,
        value: preset?.label ?? rangeText(values[spec.from], values[spec.to]),
        clear: { [spec.from]: "", [spec.to]: "" },
      });
    } else if (spec.kind === "input" && values[spec.key]) {
      out.push({ id: spec.key, label: spec.label, value: values[spec.key], clear: { [spec.key]: "" } });
    } else if (spec.kind === "range" && (values[spec.min] || values[spec.max])) {
      out.push({
        id: `${spec.min}:${spec.max}`,
        label: spec.label,
        value: rangeText(values[spec.min], values[spec.max]),
        clear: { [spec.min]: "", [spec.max]: "" },
      });
    }
  }
  return out;
}

function suggestionsFor(specs: SearchSpec[], typed: string): Suggestion[] {
  const text = typed.trim();
  if (!text) return [];
  const needle = fold(text);
  const out: Suggestion[] = [];

  for (const spec of specs) {
    if (spec.kind === "text") {
      out.push({ id: `t:${spec.key}`, label: spec.label, value: text, patch: { [spec.key]: text } });
    }
  }
  for (const spec of specs) {
    if (spec.kind !== "choice" || spec.suggest === false) continue;
    const hits = spec.options
      .filter((o) => fold(o.label).includes(needle) || (o.hint ? fold(o.hint).includes(needle) : false))
      .slice(0, SUGGEST_PER_SPEC);
    for (const option of hits) {
      out.push({
        id: `c:${spec.key}:${option.value}`,
        label: spec.label,
        value: option.label,
        hint: option.hint,
        patch: { [spec.key]: option.value },
      });
    }
  }
  return out;
}

export function SearchPanel({
  specs,
  values,
  onChange,
  placeholder = "بحث…",
  summary,
  actions,
}: {
  specs: SearchSpec[];
  values: SearchValues;
  onChange: (patch: SearchValues) => void;
  placeholder?: string;
  summary?: ReactNode;
  actions?: ReactNode;
}) {
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [menu, setMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const facets = useMemo(() => facetsOf(specs, values), [specs, values]);
  const suggestions = useMemo(() => suggestionsFor(specs, typed), [specs, typed]);

  // Close either dropdown on a click anywhere else.
  useEffect(() => {
    function onDown(event: MouseEvent) {
      const target = event.target as Node;
      if (boxRef.current && !boxRef.current.contains(target)) setOpen(false);
      if (menuRef.current && !menuRef.current.contains(target)) setMenu(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function pick(suggestion: Suggestion) {
    onChange(suggestion.patch);
    setTyped("");
    setOpen(false);
    setActive(0);
    inputRef.current?.focus();
  }

  function onKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = suggestions[active] ?? suggestions[0];
      if (chosen) pick(chosen);
    } else if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "Backspace" && typed === "" && facets.length) {
      onChange(facets[facets.length - 1].clear);
    }
  }

  const clearAll = () => onChange(Object.assign({}, ...facets.map((f) => f.clear)));

  return (
    <div className="sp no-print">
      <div className="sp-row">
        <div className="sp-box" ref={boxRef} onClick={() => inputRef.current?.focus()}>
          <span className="sp-icon" aria-hidden>
            ⌕
          </span>
          {facets.map((facet) => (
            <span key={facet.id} className="sp-facet">
              <span className="sp-facet-l">{facet.label}</span>
              <span className="sp-facet-v">{facet.value}</span>
              <button
                type="button"
                aria-label={`إزالة ${facet.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onChange(facet.clear);
                }}
              >
                ×
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            value={typed}
            placeholder={facets.length ? "" : placeholder}
            onChange={(event) => {
              setTyped(event.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => typed && setOpen(true)}
            onKeyDown={onKey}
            aria-label={placeholder}
            aria-expanded={open && suggestions.length > 0}
          />
          {facets.length ? (
            <button type="button" className="sp-clear" onClick={clearAll} title="مسح كل الفلاتر">
              ×
            </button>
          ) : null}

          {open && suggestions.length ? (
            <ul className="sp-drop" role="listbox">
              {suggestions.map((s, i) => (
                <li
                  key={s.id}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? "on" : undefined}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(s);
                  }}
                >
                  {s.id.startsWith("t:") ? (
                    <>
                      بحث في <b>{s.label}</b> عن: <i>{s.value}</i>
                    </>
                  ) : (
                    <>
                      <span className="sp-drop-l">{s.label}:</span> <b>{s.value}</b>
                      {s.hint ? <span className="sp-drop-h mono">{s.hint}</span> : null}
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <FiltersMenu specs={specs} values={values} onChange={onChange} open={menu} setOpen={setMenu} menuRef={menuRef} />

        {actions ? <div className="sp-actions">{actions}</div> : null}
      </div>
      {summary ? <div className="sp-sub">{summary}</div> : null}
    </div>
  );
}

function FiltersMenu({
  specs,
  values,
  onChange,
  open,
  setOpen,
  menuRef,
}: {
  specs: SearchSpec[];
  values: SearchValues;
  onChange: (patch: SearchValues) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  menuRef: React.RefObject<HTMLDivElement | null>;
}) {
  const sections = specs.filter(
    (spec) =>
      spec.kind === "dates" ||
      spec.kind === "range" ||
      spec.kind === "input" ||
      (spec.kind === "choice" && (spec.menu ?? spec.options.length <= MENU_LIMIT) && spec.options.length > 0),
  );
  if (!sections.length) return null;
  const activeCount = facetsOf(sections, values).length;

  return (
    <div className="sp-menu-wrap" ref={menuRef}>
      <button type="button" className={`btn${activeCount ? " on" : ""}`} onClick={() => setOpen(!open)}>
        ⛉ فلاتر{activeCount ? ` (${activeCount})` : ""} ▾
      </button>
      {open ? (
        <div className="sp-menu">
          {sections.map((spec) => (
            <MenuSection key={spec.kind === "dates" ? spec.from : spec.kind === "range" ? spec.min : spec.key} spec={spec} values={values} onChange={onChange} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MenuSection({
  spec,
  values,
  onChange,
}: {
  spec: SearchSpec;
  values: SearchValues;
  onChange: (patch: SearchValues) => void;
}) {
  if (spec.kind === "choice") {
    return (
      <div className="sp-sec">
        <h5>{spec.label}</h5>
        {spec.options.map((option) => {
          const on = values[spec.key] === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className={`sp-item${on ? " on" : ""}`}
              onClick={() => onChange({ [spec.key]: on ? "" : option.value })}
            >
              <span className="sp-check">{on ? "✓" : ""}</span>
              {option.label}
            </button>
          );
        })}
      </div>
    );
  }
  if (spec.kind === "dates") return <DatesSection spec={spec} values={values} onChange={onChange} />;
  if (spec.kind === "range") return <RangeSection spec={spec} values={values} onChange={onChange} />;
  if (spec.kind === "input") return <InputSection spec={spec} values={values} onChange={onChange} />;
  return null;
}

function DatesSection({
  spec,
  values,
  onChange,
}: {
  spec: Extract<SearchSpec, { kind: "dates" }>;
  values: SearchValues;
  onChange: (patch: SearchValues) => void;
}) {
  const [from, setFrom] = useState(values[spec.from] ?? "");
  const [to, setTo] = useState(values[spec.to] ?? "");
  useEffect(() => {
    setFrom(values[spec.from] ?? "");
    setTo(values[spec.to] ?? "");
  }, [values, spec.from, spec.to]);

  return (
    <div className="sp-sec">
      <h5>{spec.label}</h5>
      {datePresets().map((preset) => {
        const on = values[spec.from] === preset.from && values[spec.to] === preset.to;
        return (
          <button
            key={preset.label}
            type="button"
            className={`sp-item${on ? " on" : ""}`}
            onClick={() => onChange(on ? { [spec.from]: "", [spec.to]: "" } : { [spec.from]: preset.from, [spec.to]: preset.to })}
          >
            <span className="sp-check">{on ? "✓" : ""}</span>
            {preset.label}
          </button>
        );
      })}
      <div className="sp-custom">
        <label>
          من
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          إلى
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="button" className="btn sm" onClick={() => onChange({ [spec.from]: from, [spec.to]: to })}>
          تطبيق
        </button>
      </div>
    </div>
  );
}

function RangeSection({
  spec,
  values,
  onChange,
}: {
  spec: Extract<SearchSpec, { kind: "range" }>;
  values: SearchValues;
  onChange: (patch: SearchValues) => void;
}) {
  const [min, setMin] = useState(values[spec.min] ?? "");
  const [max, setMax] = useState(values[spec.max] ?? "");
  useEffect(() => {
    setMin(values[spec.min] ?? "");
    setMax(values[spec.max] ?? "");
  }, [values, spec.min, spec.max]);

  return (
    <div className="sp-sec">
      <h5>{spec.label}</h5>
      <div className="sp-custom">
        <label>
          من
          <input className="mono-in" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder="0.00" />
        </label>
        <label>
          إلى
          <input className="mono-in" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} placeholder="—" />
        </label>
        <button type="button" className="btn sm" onClick={() => onChange({ [spec.min]: min.trim(), [spec.max]: max.trim() })}>
          تطبيق
        </button>
      </div>
    </div>
  );
}

function InputSection({
  spec,
  values,
  onChange,
}: {
  spec: Extract<SearchSpec, { kind: "input" }>;
  values: SearchValues;
  onChange: (patch: SearchValues) => void;
}) {
  const [value, setValue] = useState(values[spec.key] ?? "");
  useEffect(() => setValue(values[spec.key] ?? ""), [values, spec.key]);

  return (
    <div className="sp-sec">
      <h5>{spec.label}</h5>
      <div className="sp-custom">
        <input
          className="mono-in"
          type={spec.type}
          min={spec.type === "number" ? 0 : undefined}
          value={value}
          placeholder={spec.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onChange({ [spec.key]: value.trim() });
          }}
        />
        <button type="button" className="btn sm" onClick={() => onChange({ [spec.key]: value.trim() })}>
          تطبيق
        </button>
      </div>
    </div>
  );
}

/** Screen-side state for a SearchPanel: one object instead of a useState per
 *  filter. `onChange` runs after every patch — screens use it to rewind paging. */
export function useSearchValues<T extends SearchValues>(
  initial: T,
  onChange?: () => void,
): [T, (patch: SearchValues) => void, () => void] {
  const [values, setValues] = useState<T>(initial);
  const initialRef = useRef(initial);
  const patch = (next: SearchValues) => {
    setValues((current) => ({ ...current, ...next }));
    onChange?.();
  };
  const reset = () => {
    setValues(initialRef.current);
    onChange?.();
  };
  return [values, patch, reset];
}
