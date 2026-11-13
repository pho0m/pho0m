import { useRef } from "react";
import { canvaEmbedUrl, type DocumentItem } from "@pho0m/content";
import { ui, useLang } from "../../lib/i18n.tsx";
import { A, LinkRow, SectionHead } from "../ui/bits.tsx";
import { useNearViewport } from "../hooks.ts";

/**
 * Canva designs among the documents are shown in place (Canva's embed player) like a slide projector;
 * any other document with a link is a plain button under it. Hidden when no document has a link.
 */
export function Documents({ documents }: { documents: DocumentItem[] }) {
  const { lang, t } = useLang();
  const docs = documents.filter((d) => d.url.trim());
  const slides = docs.flatMap((d) => {
    const embed = canvaEmbedUrl(d.url);
    return embed ? [{ doc: d, embed }] : [];
  });
  const others = docs
    .filter((d) => !canvaEmbedUrl(d.url))
    .map((d) => ({ kind: "document" as const, label: t(d.title), url: d.url }));
  if (docs.length === 0) return null;
  const first = slides[0]?.doc;

  return (
    <section id="documents" className="sec documents" aria-labelledby="documents-title">
      <div className="wrap">
        <SectionHead
          no="06"
          kicker={ui(lang, "ฉายสไลด์ · CANVA", "SLIDE SHOW · CANVA")}
          title={first ? t(first.title) : ui(lang, "เอกสาร", "Documents")}
          id="documents-title"
          lead={first ? t(first.description) : undefined}
        />
        {slides.map(({ doc, embed }, i) => (
          <Slide key={doc.id} doc={doc} embed={embed} index={i} />
        ))}
        {others.length ? (
          <div className="slides-more">
            <LinkRow links={others} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** One Canva design under the enlarger: the lamp comes on and the slide comes into focus once it is on screen. */
function Slide({ doc, embed, index }: { doc: DocumentItem; embed: string; index: number }) {
  const { lang, t } = useLang();
  const ref = useRef<HTMLElement>(null);
  const seen = useNearViewport(ref, "0px 0px -20% 0px");
  return (
    <figure ref={ref} className={`slides ${seen ? "is-in" : "is-out"}`}>
      {index > 0 ? <h3 className="sub-title">{t(doc.title)}</h3> : null}
      <div className="slides-screen px">
        <span className="slides-lamp" aria-hidden="true" />
        <iframe
          className="slides-frame"
          src={embed}
          title={t(doc.title)}
          loading="lazy"
          allow="fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <figcaption className="slides-cap lcd">
        <span aria-hidden="true">▸ SLIDE {String(index + 1).padStart(2, "0")}</span>
        <A href={doc.url} className="tlink">
          {ui(lang, "เปิดใน Canva", "Open in Canva")} <span className="sr-only">{t(doc.title)}</span> ↗
        </A>
      </figcaption>
    </figure>
  );
}
