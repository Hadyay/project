"use client";

/* Light / dark / follow Windows.
 *
 * The theme is a data-theme="light|dark" attribute on <html>; every colour in
 * app/theme.css is a token that the dark block redefines. "auto" follows the
 * operating system (prefers-color-scheme) and keeps following it while the
 * page is open.
 *
 * THEME_BOOT runs in <head> before the first paint (app/layout.tsx), so a
 * dark-mode user never sees a white flash while React loads. It also applies
 * the remembered language direction for the same reason.
 *
 * Remembered per browser in localStorage (erp.theme). Once the user's saved
 * preferences arrive with /api/auth/me they win: see lib/prefs.tsx.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemePref = "light" | "dark" | "auto";
export type Theme = "light" | "dark";

const STORAGE_KEY = "erp.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Inline script for <head>: same resolution as below, before React exists. */
export const THEME_BOOT = `(function(){try{var h=document.documentElement,t=localStorage.getItem("${STORAGE_KEY}");var d=t==="dark"||(t==="auto"&&window.matchMedia("${DARK_QUERY}").matches);h.setAttribute("data-theme",d?"dark":"light");if(localStorage.getItem("erp.lang")==="en"){h.lang="en";h.dir="ltr"}}catch(e){}})();`;

function systemTheme(): Theme {
  try {
    return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function apply(theme: Theme) {
  const html = document.documentElement;
  if (html.getAttribute("data-theme") === theme) return;
  // Without this every transition on the page (buttons, borders) animates
  // the switch, and the page shimmers for a fifth of a second.
  html.classList.add("theme-switching");
  html.setAttribute("data-theme", theme);
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => html.classList.remove("theme-switching")));
}

interface ThemeState {
  /** What the user chose. */
  theme: ThemePref;
  /** What is on screen now ("auto" resolved). */
  resolved: Theme;
  setTheme: (theme: ThemePref) => void;
}

const ThemeContext = createContext<ThemeState>({ theme: "light", resolved: "light", setTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePref>("light");
  const [system, setSystem] = useState<Theme>("light");

  useEffect(() => {
    setSystem(systemTheme());
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "dark" || saved === "auto") setThemeState(saved);
    } catch {
      /* storage blocked - light */
    }
    let media: MediaQueryList;
    try {
      media = window.matchMedia(DARK_QUERY);
    } catch {
      return;
    }
    const onChange = () => setSystem(media.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const resolved: Theme = theme === "auto" ? system : theme;
  useEffect(() => apply(resolved), [resolved]);

  const setTheme = useCallback((next: ThemePref) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* not remembered - still applies now */
    }
  }, []);

  return <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  return useContext(ThemeContext);
}
