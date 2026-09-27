"use client";

import { useState } from "react";

/** "الكل" — asks the API for everything. Must equal MAX_PAGE_SIZE in
 *  backend/app/api/common.py, which rejects anything larger with a 422. */
export const ALL_ROWS = 10_000;

/** Rows-per-page choices offered under every paged table. */
export const PAGE_SIZES = [50, 100, 250, 500, ALL_ROWS] as const;

const DEFAULT_SIZE = 50;
const storageKey = (screen: string) => `erp.pageSize.${screen}`;

/** Rows per page for one screen, remembered in this browser.
 *
 *  Per screen, because the choice differs: all 189 clients on one page is
 *  handy, all 2,231 journal entries is a deliberate act. Storage is only a
 *  convenience — a private window or blocked storage falls back to 50. */
export function usePageSize(screen: string): [number, (size: number) => void] {
  const [size, setSize] = useState<number>(() => {
    try {
      const saved = Number(window.localStorage.getItem(storageKey(screen)));
      return (PAGE_SIZES as readonly number[]).includes(saved) ? saved : DEFAULT_SIZE;
    } catch {
      return DEFAULT_SIZE;
    }
  });

  function update(next: number) {
    setSize(next);
    try {
      window.localStorage.setItem(storageKey(screen), String(next));
    } catch {
      /* not persisted — still applies for this visit */
    }
  }

  return [size, update];
}
