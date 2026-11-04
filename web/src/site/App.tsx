import { useEffect, useMemo, useState } from "react";
import { absoluteUrl, timelineFrames, type Content, type Lang } from "@pho0m/content";
import { LangProvider, ui, useLang } from "../lib/i18n.tsx";
import { fetchLiveContent, seed } from "../lib/content.ts";
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

function setMeta(selector: string, attr: "name" | "property", key: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = value;
}

function useDocumentMeta(content: Content, lang: Lang, t: (v: Content["site"]["title"]) => string) {
  useEffect(() => {
    const title = t(content.site.title);
    const description = t(content.site.description);
    if (title) document.title = title;
    if (description) {
      setMeta('meta[name="description"]', "name", "description", description);
      setMeta('meta[property="og:description"]', "property", "og:description", description);
    }
    if (title) setMeta('meta[property="og:title"]', "property", "og:title", title);
    setMeta('meta[property="og:locale"]', "property", "og:locale", lang === "th" ? "th_TH" : "en_US");
    if (content.site.url) setMeta('meta[property="og:url"]', "property", "og:url", absoluteUrl("/", content.site.url));
    const og = content.site.ogImage ?? content.profile.avatar;
    if (og && content.site.url)
      setMeta('meta[property="og:image"]', "property", "og:image", absoluteUrl(og.url, content.site.url));
  }, [content, lang, t]);
}

function Site({ content }: { content: Content }) {
  const { lang, t } = useLang();
  useDocumentMeta(content, lang, t);
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
