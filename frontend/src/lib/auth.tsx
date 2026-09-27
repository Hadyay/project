"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { api, getToken, setToken } from "./api";
import type { Me, Permission } from "./types";

interface AuthState {
  user: Me | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  /** True when the user holds ANY of `permissions` — the same rule as the
   *  backend's require_perm(). The API still checks every request; this only
   *  decides what the screen offers. */
  can: (...permissions: Permission[]) => boolean;
  /** Re-read the user and their permissions (after editing roles, say). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** How often an open screen re-reads its user's permissions, so a change the
 *  administrator makes reaches everyone's menus within a minute — and at once
 *  when a window regains focus. The server enforces it immediately anyway. */
const REFRESH_MS = 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    if (!getToken()) return;
    try {
      setUser(await api.get<Me>("/api/auth/me"));
    } catch {
      /* a 401 already sends the browser to /login */
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .get<Me>("/api/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [user, refresh]);

  const login = useCallback(async (username: string, password: string) => {
    await api.login(username, password);
    setUser(await api.get<Me>("/api/auth/me"));
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    router.push("/login");
  }, [router]);

  const can = useCallback(
    (...permissions: Permission[]) => {
      if (!user) return false;
      return permissions.some((permission) => user.permissions.includes(permission));
    },
    [user],
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, can, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
