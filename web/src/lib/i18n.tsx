import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { t as pick, type Lang, type Localized } from "@pho0m/content";

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (v: Localized | undefined) => string };
const LangContext = createContext<Ctx | null>(null);

type Loc = { pathname: string; search: string; hash: string };

const EN_PATH = /^\/en(?:\/|$)/i;

/**
 * Language a URL asks for. English has its own page, /en/ (the SEO post-step writes
 * dist/en/index.html); the old ?lang=en|th links still work. Null → the default page.
 */
export function langFromUrl(loc: Pick<Loc, "pathname" | "search"> | undefined = currentLocation()): Lang | null {
  if (!loc) return null;
  if (EN_PATH.test(loc.pathname)) return "en";
  try {
    const v = new URLSearchParams(loc.search).get("lang");
    return v === "th" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

/** Path of the page for a language: English at /en/, everything else at /. */
export function langPath(l: Lang): string {
  return l === "en" ? "/en/" : "/";
}

/**
 * The URL of the same place in another language: that language's path, the query
 * without ?lang, the hash kept. ?lang is only added back when the path alone would
 * not give that language (a site whose default language is English).
 */
export function urlForLang(l: Lang, loc: Loc, defaultLang: Lang = "th"): string {
  const path = langPath(l);
  const params = new URLSearchParams(loc.search);
  params.delete("lang");
  if ((langFromUrl({ pathname: path, search: "" }) ?? defaultLang) !== l) params.set("lang", l);
  const q = params.toString();
  return `${path}${q ? `?${q}` : ""}${loc.hash}`;
}

function currentLocation(): Loc | undefined {
  return typeof window === "undefined" ? undefined : window.location;
}

/** Move the address bar to `url` without a reload or a scroll (no-op when it is already there). */
function replaceUrl(url: string) {
  try {
    const loc = window.location;
    if (`${loc.pathname}${loc.search}${loc.hash}` !== url) window.history.replaceState(window.history.state, "", url);
  } catch {
    /* sandboxed / file: URL: keep the current address */
  }
}

/**
 * Language for the site. It comes from the URL (/en/ → English, else the default
 * language, ?lang= still honoured). With `routing` (the default) choosing a language
 * moves the address bar between / and /en/ (hash kept, ?lang dropped), so the URL,
 * a reload and a shared link all agree with what is on screen.
 */
export function LangProvider({
  children,
  defaultLang = "th",
  routing = true,
}: {
  children: ReactNode;
  defaultLang?: Lang;
  routing?: boolean;
}) {
  const [lang, setLangState] = useState<Lang>(() => langFromUrl() ?? defaultLang);
  const setLang = useCallback(
    (l: Lang) => {
      setLangState(l);
      const loc = currentLocation();
      if (routing && loc) replaceUrl(urlForLang(l, loc, defaultLang));
    },
    [routing, defaultLang],
  );

  useEffect(() => {
    if (!routing) return;
    const loc = currentLocation();
    // An old ?lang= link: show the clean URL of that language's page.
    if (loc && new URLSearchParams(loc.search).has("lang")) replaceUrl(urlForLang(langFromUrl(loc) ?? defaultLang, loc, defaultLang));
    const onPop = () => setLangState(langFromUrl() ?? defaultLang);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [routing, defaultLang]);

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
