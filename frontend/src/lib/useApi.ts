"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError } from "./api";

interface Result<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Fetch on mount and whenever `deps` change, with a manual `reload()`.
 *
 *  A request that is superseded (deps changed mid-flight, or the component
 *  unmounted) is dropped rather than written into state, so a slow filter
 *  cannot overwrite a newer one's results. */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[]): Result<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);

    fetcher()
      .then((result) => {
        if (!live) return;
        setData(result);
      })
      .catch((err: unknown) => {
        if (!live) return;
        // A 401 already redirects to /login; surfacing it here just flashes.
        if (err instanceof ApiError && err.status === 401) return;
        setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع");
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, error, loading, reload };
}
