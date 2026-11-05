import type { ReactNode } from "react";
import type { Link } from "@pho0m/content";
import { isExternal, linkCode, linkLabel } from "../util.ts";

/** Section heading: LED kicker + title + optional lead. */
export function SectionHead({
  no,
  kicker,
  title,
  lead,
  id,
}: {
  no: string;
  kicker: string;
  title: string;
  lead?: string;
  id: string;
}) {
  return (
    <header className="sec-head">
      <p className="sec-kicker lcd">
        <span aria-hidden="true">▸ {no}</span> {kicker}
      </p>
      <h2 id={id} className="sec-title">
        {title}
      </h2>
      {lead ? <p className="sec-lead">{lead}</p> : null}
    </header>
  );
}

/** External-aware anchor. */
export function A({ href, className, children, label }: { href: string; className?: string; children: ReactNode; label?: string }) {
  const ext = isExternal(href);
  return (
    <a
      href={href}
      className={className}
      aria-label={label}
      {...(ext ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

/** A link rendered as a pixel button with an LED kind code. */
export function LinkButton({ link, small = false }: { link: Link; small?: boolean }) {
  return (
    <A href={link.url} className={`linkbtn px${small ? " linkbtn--sm" : ""}`}>
      <span className="linkbtn-code lcd" aria-hidden="true">
        {linkCode(link.kind)}
      </span>
      <span className="linkbtn-label">{linkLabel(link)}</span>
      {isExternal(link.url) ? (
        <span className="linkbtn-ext" aria-hidden="true">
          ↗
        </span>
      ) : null}
    </A>
  );
}

export function LinkRow({ links, small }: { links: Link[]; small?: boolean }) {
  if (links.length === 0) return null;
  return (
    <ul className="linkrow" role="list">
      {links.map((l, i) => (
        <li key={`${l.url}-${i}`}>
          <LinkButton link={l} small={small} />
        </li>
      ))}
    </ul>
  );
}

export function Tags({ tags, label }: { tags: string[]; label?: string }) {
  if (tags.length === 0) return null;
  return (
    <ul className="tags" role="list" aria-label={label}>
      {tags.map((tag) => (
        <li key={tag} className="tag">
          {tag}
        </li>
      ))}
    </ul>
  );
}
