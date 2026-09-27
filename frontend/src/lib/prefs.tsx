"use client";

/* The user's interface choices: theme, language and simple mode.
 *
 * Saved on the user (PUT /api/auth/preferences, returned by /api/auth/me), so
 * they follow the person to any PC; also kept in this browser (theme and
 * language in their own providers, simple mode here) so the screen is right
 * before /me answers, and still right if saving fails.
 *
 * The server's copy is applied whenever it CHANGES — at sign-in, or when the
 * same user changed something on another PC — never merely because /me was
 * re-read, so a periodic refresh cannot undo a choice made a second ago.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang, type Lang } from "@/lib/i18n";
import { useTheme, type ThemePref } from "@/lib/theme";
import type { Preferences } from "@/lib/types";

const SIMPLE_KEY = "erp.simple";

interface PrefsState {
  prefs: Preferences;
  /** Applies at once, then saves on the user. True when the server kept it;
   *  false when it only applies in this browser. */
  update: (patch: Partial<Preferences>) => Promise<boolean>;
}

const PrefsContext = createContext<PrefsState>({
  prefs: { theme: "light", lang: "ar", simple_mode: false },
  update: async () => false,
});

const keyOf = (p: Preferences) => `${p.theme}|${p.lang}|${p.simple_mode}`;

export function PrefsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const { lang, setLang } = useLang();
  const [simple, setSimpleState] = useState(false);
  const applied = useRef<string | null>(null);

  const setSimple = useCallback((next: boolean) => {
    setSimpleState(next);
    try {
      window.localStorage.setItem(SIMPLE_KEY, next ? "1" : "0");
    } catch {
      /* not remembered here - still saved on the user */
    }
  }, []);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(SIMPLE_KEY) === "1") setSimpleState(true);
    } catch {
      /* storage blocked */
    }
  }, []);

  const server = user?.preferences;
  useEffect(() => {
    if (!server) return; // a backend without saved preferences: local only
    const key = keyOf(server);
    if (applied.current === key) return;
    applied.current = key;
    setTheme(server.theme);
    setLang(server.lang);
    setSimple(server.simple_mode);
  }, [server, setTheme, setLang, setSimple]);

  const update = useCallback(
    async (patch: Partial<Preferences>) => {
      if (patch.theme) setTheme(patch.theme as ThemePref);
      if (patch.lang) setLang(patch.lang as Lang);
      if (patch.simple_mode !== undefined) setSimple(patch.simple_mode);
      if (!user) return false;
      try {
        const saved = await api.put<Preferences>("/api/auth/preferences", patch);
        applied.current = keyOf(saved);
        return true;
      } catch {
        return false; // applies in this browser only
      }
    },
    [user, setTheme, setLang, setSimple],
  );

  return (
    <PrefsContext.Provider value={{ prefs: { theme, lang, simple_mode: simple }, update }}>
      {children}
    </PrefsContext.Provider>
  );
}

export function usePrefs(): PrefsState {
  return useContext(PrefsContext);
}
