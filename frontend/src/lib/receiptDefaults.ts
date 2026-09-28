"use client";

import { useCallback } from "react";

import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";

export interface ReceiptDefaults {
  /** The configured till (DEFAULT_CASH_CODE); null when it is not set up. */
  cash_account_id: number | null;
  currency_id: number | null;
}

/** Where a new receipt or payment goes unless the clerk picks otherwise —
 *  from the server's configuration, never the first account in the list
 *  (which is the starter chart's till, not the one the office uses). */
export function useReceiptDefaults(): ReceiptDefaults | null {
  const state = useApi(
    useCallback(() => api.get<ReceiptDefaults>("/api/receipts/defaults").catch(() => null), []),
    [],
  );
  return state.data ?? null;
}
