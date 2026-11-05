import { useEffect, useMemo, useState } from "react";
import { timelineFrames, type Content, type Lang } from "@pho0m/content";
import { LangProvider, ui, useLang } from "../lib/i18n.tsx";
import { fetchLiveContent, isNewerContent } from "../lib/content.ts";
import { pageDescription, pageTitle, pageUrl } from "../seo/build.ts";
import { useHashLanding, useReducedMotion } from "./hooks.ts";
import { FilmTimeline } from "./film/FilmTimeline.tsx";
import { TopBar } from "./sections/TopBar.tsx";
import { Hero } from "./sections/Hero.tsx";
import { Utotech } from "./sections/Utotech.tsx";
import { Projects } from "./sections/Projects.tsx";
import { Skills } from "./sections/Skills.tsx";
import { Diary } from "./sections/Diary.tsx";
import { Documents } from "./sections/Documents.tsx";
import { Footer } from "./sections/Footer.tsx";

/**
 * Starts from the content the build baked into the page (else the seed, see main.tsx), so
 * the first paint already shows the published content. The live JSON is still fetched
 * in the background and only replaces it when it was saved later (newer updatedAt).
 */
export function App({ initial }: { initial: Content }) {
  const [content, setContent] = useState<Content>(initial);
  useEffect(() => {
    const ac = new AbortController();
    void fetchLiveContent(ac.signal).then((live) => {
      if (live) setContent((cur) => (isNewerContent(live, cur) ? live : cur));
    });
    return () => ac.abort();
  }, []);
  useEffect(() => {
    // Tells the inline head script that React is up, so it keeps the static snapshot hidden.
    document.getElementById("root")?.setAttribute("data-mounted", "1");
  }, []);
  return (
    <LangProvider defaultLang={content.site.defaultLang}>
      <Site content={content} />
    </LangProvider>
  );
}

/**
 * Update a head tag in place. In production the SEO post-step (web/src/seo/postbuild.ts)
 * has already written every tag, so this never adds a second copy; a tag is only
 * created when it is missing (dev server, no post-step).
 */
function setMeta(attr: "name" | "property", key: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  if (el.content !== value) el.content = value;
}

/** Same as setMeta for a <link rel> (canonical). */
function setLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.rel = rel;
    document.head.appendChild(el);
  }
  if (el.getAttribute("href") !== href) el.setAttribute("href", href);
}

/**
 * Keep the language-dependent head tags in step with the chosen language, using the
 * same title/description builders as the SEO post-step. The canonical URL and og:url
 * follow the language's page (/ or /en/); the static tags it owns (alternates,
 * og:image, JSON-LD) are left as written.
 */
function useDocumentMeta(content: Content, lang: Lang) {
  useEffect(() => {
    const url = pageUrl(content, lang);
    setLink("canonical", url);
    setMeta("property", "og:url", url);
    const title = pageTitle(content, lang);
    const description = pageDescription(content, lang);
    if (title && document.title !== title) document.title = title;
    if (title) {
      setMeta("property", "og:title", title);
      setMeta("name", "twitter:title", title);
    }
    if (description) {
      setMeta("name", "description", description);
      setMeta("property", "og:description", description);
      setMeta("name", "twitter:description", description);
    }
    setMeta("property", "og:locale", lang === "th" ? "th_TH" : "en_US");
    setMeta("property", "og:locale:alternate", lang === "th" ? "en_US" : "th_TH");
  }, [content, lang]);
}

function Site({ content }: { content: Content }) {
  const { lang } = useLang();
  useDocumentMeta(content, lang);
  useHashLanding(content, useReducedMotion());
  const frames = useMemo(() => timelineFrames(content), [content]);
  // Remount the film when the set of frames (or their pictures) changes.
  const filmKey = frames.map((f) => `${f.id}:${f.icon}:${f.images[0]?.url ?? ""}`).join("|");

  return (
    <>
      <a className="skip" href="#main">
        {ui(lang, "ข้ามไปที่เนื้อหา", "Skip to content")}
      </a>
      <TopBar />
      <main id="main" tabIndex={-1}>
        <Hero content={content} frameCount={frames.length} />
        {frames.length > 0 ? <FilmTimeline key={filmKey} frames={frames} /> : null}
        <Utotech company={content.company} profile={content.profile} />
        <Projects projects={content.projects} />
        <Skills skills={content.skills} />
        <Diary diary={content.diary} profile={content.profile} />
        <Documents documents={content.documents} />
      </main>
      <Footer content={content} />
    </>
  );
}
