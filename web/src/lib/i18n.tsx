import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { t as pick, type Lang, type Localized } from "@pho0m/content";

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (v: Localized | undefined) => string };
const LangContext = createContext<Ctx | null>(null);
const KEY = "pho0m.lang";

/** ?lang=en|th in the URL wins (shareable, used by hreflang links), then the stored choice. */
function readUrl(): Lang | null {
  try {
    const v = new URLSearchParams(window.location.search).get("lang");
    return v === "th" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

function readStored(): Lang | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "th" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

export function LangProvider({ children, defaultLang = "th" }: { children: ReactNode; defaultLang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => readUrl() ?? readStored() ?? defaultLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* storage blocked: keep in memory only */
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const value = useMemo<Ctx>(() => ({ lang, setLang, t: (v) => pick(v, lang) }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): Ctx {
  const c = useContext(LangContext);
  if (!c) throw new Error("useLang must be used inside <LangProvider>");
  return c;
}

/** Inline UI strings that are not part of the editable content. */
export function ui(lang: Lang, th: string, en: string): string {
  return lang === "th" ? th : en;
}
