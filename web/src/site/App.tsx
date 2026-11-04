import { useEffect, useMemo, useState } from "react";
import { timelineFrames, type Content, type Lang } from "@pho0m/content";
import { LangProvider, ui, useLang } from "../lib/i18n.tsx";
import { fetchLiveContent, seed } from "../lib/content.ts";
import { pageDescription, pageTitle } from "../seo/build.ts";
import { FilmTimeline } from "./film/FilmTimeline.tsx";
import { TopBar } from "./sections/TopBar.tsx";
import { Hero } from "./sections/Hero.tsx";
import { Utotech } from "./sections/Utotech.tsx";
import { Projects } from "./sections/Projects.tsx";
import { Skills } from "./sections/Skills.tsx";
import { Diary } from "./sections/Diary.tsx";
import { Documents } from "./sections/Documents.tsx";
import { Footer } from "./sections/Footer.tsx";

/** Starts from the built-in seed (instant first paint) and swaps in the live content when it arrives. */
export function App() {
  const [content, setContent] = useState<Content>(seed);
  useEffect(() => {
    const ac = new AbortController();
    void fetchLiveContent(ac.signal).then((live) => {
      if (live) setContent(live);
    });
    return () => ac.abort();
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

/**
 * Keep the language-dependent head tags in step with the chosen language, using the
 * same title/description builders as the SEO post-step. Static tags it owns
 * (canonical, alternates, og:url, og:image, JSON-LD) are left as written.
 */
function useDocumentMeta(content: Content, lang: Lang) {
  useEffect(() => {
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
