"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AlertsSummary } from "@/lib/types";

/** How often the bell re-counts. A receipt clears an alert at once on the
 *  server; the bell catches up within this, or when the window regains focus. */
const REFRESH_MS = 5 * 60_000;

/** The reminder count for the top-bar bell, the menu badge and the alarm.
 *  Null while loading, when switched off, or when the role cannot see alerts. */
export function useAlertSummary(): { summary: AlertsSummary | null; reload: () => void } {
  const { can, user } = useAuth();
  const allowed = can("alerts.view", "dashboard.view");
  const [summary, setSummary] = useState<AlertsSummary | null>(null);

  const reload = useCallback(() => {
    if (!allowed) return;
    api
      .get<AlertsSummary>("/api/alerts/summary")
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [allowed]);

  useEffect(() => {
    if (!user || !allowed) {
      setSummary(null);
      return;
    }
    reload();
    const timer = window.setInterval(reload, REFRESH_MS);
    window.addEventListener("focus", reload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", reload);
    };
  }, [user, allowed, reload]);

  return { summary: summary?.enabled ? summary : null, reload };
}

/** "لم يدفع منذ ٣ أشهر" style label for months without a payment. */
export function monthsLabel(months: number | null): string {
  if (months === null) return "لم يدفع أبداً";
  if (months === 0) return "دفع أقل من القسط";
  if (months === 1) return "لم يدفع هذا الشهر";
  return `متأخر ${months} أشهر`;
}
