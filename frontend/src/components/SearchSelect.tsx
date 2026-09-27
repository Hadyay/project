"use client";

import { useId, useMemo } from "react";

export interface Option {
  id: number | string;
  label: string;
  /** Shown after the label to tell two identical names apart. */
  hint?: string | null;
}

/**
 * A select you can type into.
 *
 * A `<select>` of 189 clients is a scroll-and-squint exercise: the office knows
 * the name, not the position in an alphabetical list. This is an `<input>`
 * backed by a native `<datalist>`, so typing filters and the browser does the
 * rendering, the keyboard handling and the RTL text — no popup to re-implement
 * and nothing to get wrong on a phone.
 *
 * The catch with `datalist` is that the input yields *text*, not a value, so
 * the text has to map back to exactly one option. Each option is rendered as
 * `label — hint` (name — account number), which is unique even when two
 * clients share a name, and an entry that matches nothing resolves to "no
 * selection" rather than silently keeping the previous one.
 */
export function SearchSelect({
  options,
  value,
  onChange,
  placeholder,
  allLabel = "الكل",
  disabled = false,
}: {
  options: Option[];
  /** The selected id as a string, or "" for none. */
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  allLabel?: string;
  disabled?: boolean;
}) {
  const listId = useId();

  const { textOf, idOf } = useMemo(() => {
    const textOf = new Map<string, string>();
    const idOf = new Map<string, string>();
    for (const option of options) {
      const text = option.hint ? `${option.label} — ${option.hint}` : option.label;
      textOf.set(String(option.id), text);
      idOf.set(text, String(option.id));
    }
    return { textOf, idOf };
  }, [options]);

  return (
    <>
      <input
        list={listId}
        // Controlled by the id, displayed as the text: picking from the list
        // and typing the name by hand both land in the same place.
        value={value ? (textOf.get(value) ?? "") : ""}
        placeholder={placeholder ?? `${allLabel} — اكتب للبحث`}
        disabled={disabled}
        onChange={(event) => {
          const text = event.target.value.trim();
          if (text === "") {
            onChange("");
            return;
          }
          const exact = idOf.get(text);
          if (exact !== undefined) onChange(exact);
        }}
        // A click on a filled box should let you retype rather than making you
        // clear it first.
        onFocus={(event) => event.target.select()}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option
            key={option.id}
            value={option.hint ? `${option.label} — ${option.hint}` : option.label}
          />
        ))}
      </datalist>
    </>
  );
}
