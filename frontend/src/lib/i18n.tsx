"use client";

/* Arabic / English.
 *
 * The interface is written in Arabic, straight in the JSX of every screen.
 * Rather than threading t() through ~800 strings, English is a translation
 * layer over the rendered page: while English is on, a MutationObserver
 * replaces every text node and placeholder/title/aria-label whose whole text
 * is a known Arabic UI string with its English entry (lib/i18n-en.ts), and
 * restores the Arabic when switched back.
 *
 * Safe with React because it only ever rewrites a node's value in place - it
 * never adds, removes or wraps nodes, which is what breaks React under browser
 * translators. React writes a new value when state changes; the observer sees
 * that write and translates it again.
 *
 * Only exact matches are translated (plus the templated entries, which match
 * as patterns), so data - client names, descriptions, amounts in words -
 * passes through untouched. Anything under translate="no" is skipped.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { EN } from "@/lib/i18n-en";

export type Lang = "ar" | "en";

const STORAGE_KEY = "erp.lang";
const ARABIC = /[؀-ۿ]/;
const ATTRS = ["placeholder", "title", "aria-label"] as const;

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- dictionary
const exact = new Map<string, string>();
const patterns: { re: RegExp; en: string }[] = [];
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

for (const [ar, en] of Object.entries(EN)) {
  if (ar.includes("${")) {
    // "إلغاء الوصل ${no}؟" -> /^إلغاء الوصل (.+?)؟$/ ; English uses {0}, {1}…
    const parts = norm(ar).split(/\$\{[^}]*\}/);
    patterns.push({ re: new RegExp("^" + parts.map(escape).join("(.+?)") + "$"), en });
  } else {
    exact.set(norm(ar), en);
  }
}
// Longest pattern first: the most specific template wins.
patterns.sort((a, b) => b.re.source.length - a.re.source.length);

/** English for one Arabic UI string, or null when it is not a known one. */
export function translate(text: string): string | null {
  const key = norm(text);
  if (!key || !ARABIC.test(key)) return null;
  const hit = exact.get(key);
  if (hit !== undefined) return hit;
  for (const { re, en } of patterns) {
    const m = re.exec(key);
    if (m) {
      // A captured value can itself be a label ("عقد بيع — S-1" -> "Sale contract — S-1").
      return en.replace(/\{(\d)\}/g, (_, i) => {
        const value = m[Number(i) + 1] ?? "";
        return exact.get(norm(value)) ?? value;
      });
    }
  }
  return null;
}

// ---------------------------------------------------------------- DOM layer
function skip(el: Element | null): boolean {
  for (let node = el; node; node = node.parentElement) {
    if (node.getAttribute("translate") === "no") return true;
    const tag = node.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA") return true;
  }
  return false;
}

function startTranslator(root: HTMLElement): () => void {
  const original = new Map<Text, string>();
  const written = new WeakMap<Text, string>();
  const attrOriginal = new Map<Element, Map<string, string>>();
  const attrWritten = new WeakMap<Element, Map<string, string>>();

  const doText = (node: Text) => {
    const value = node.nodeValue ?? "";
    if (written.get(node) === value) return;
    if (!ARABIC.test(value) || skip(node.parentElement)) return;
    const en = translate(value);
    if (en === null) return;
    const lead = value.match(/^\s*/)?.[0] ?? "";
    const trail = value.match(/\s*$/)?.[0] ?? "";
    const next = lead + en + trail;
    original.set(node, value);
    written.set(node, next);
    node.nodeValue = next;
  };

  const doAttrs = (el: Element) => {
    for (const attr of ATTRS) {
      const value = el.getAttribute(attr);
      if (!value || !ARABIC.test(value)) continue;
      if (attrWritten.get(el)?.get(attr) === value) continue;
      if (skip(el)) return;
      const en = translate(value);
      if (en === null) continue;
      if (!attrOriginal.has(el)) attrOriginal.set(el, new Map());
      if (!attrWritten.has(el)) attrWritten.set(el, new Map());
      attrOriginal.get(el)!.set(attr, value);
      attrWritten.get(el)!.set(attr, en);
      el.setAttribute(attr, en);
    }
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) return doText(node as Text);
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (skip(el)) return;
    doAttrs(el);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
      else doAttrs(n as Element);
    }
  };

  walk(root);
  // The tab title lives in <head>, and Next.js rewrites it on navigation.
  const originalTitle = document.title;
  const doTitle = () => {
    const en = translate(document.title);
    if (en) document.title = en; // English has no Arabic, so this cannot loop
  };
  doTitle();
  const titleObserver = new MutationObserver(doTitle);
  titleObserver.observe(document.head, { subtree: true, childList: true, characterData: true });

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "characterData") doText(m.target as Text);
      else if (m.type === "attributes") doAttrs(m.target as Element);
      else m.addedNodes.forEach(walk);
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRS],
  });

  return () => {
    observer.disconnect();
    titleObserver.disconnect();
    original.forEach((ar, node) => {
      if (node.isConnected && written.get(node) === node.nodeValue) node.nodeValue = ar;
    });
    attrOriginal.forEach((attrs, el) => {
      attrs.forEach((ar, attr) => {
        if (el.isConnected && attrWritten.get(el)?.get(attr) === el.getAttribute(attr)) el.setAttribute(attr, ar);
      });
    });
    document.title = originalTitle;
  };
}

// ---------------------------------------------------------------- context
interface LangState {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** For strings built in code rather than rendered (confirm() text, titles). */
  t: (ar: string) => string;
}

const LangContext = createContext<LangState>({ lang: "ar", setLang: () => {}, t: (ar) => ar });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ar");

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "en") setLangState("en");
    } catch {
      /* storage blocked - stay in Arabic */
    }
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    html.lang = lang;
    html.dir = lang === "en" ? "ltr" : "rtl";
    if (lang !== "en") return;
    return startTranslator(document.body);
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* not remembered - still applies now */
    }
  }, []);

  const t = useCallback((ar: string) => (lang === "en" ? (translate(ar) ?? ar) : ar), [lang]);

  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

export function useLang(): LangState {
  return useContext(LangContext);
}
