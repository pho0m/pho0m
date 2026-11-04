import {
  absoluteUrl,
  frameDateLabel,
  frameDateLong,
  isSafeImageUrl,
  isSafeUrl,
  PROJECT_GROUPS,
  publicProjection,
  t,
  timelineFrames,
  type Content,
  type Lang,
  type Localized,
  type Project,
} from "@pho0m/content";

/**
 * Build-time SEO + AI-crawler output. Everything here is pure (string in → string out)
 * so it is unit-tested; web/src/seo/postbuild.ts writes the results into web/dist.
 *
 * Why: the site is a React SPA, and most AI crawlers (GPTBot, ClaudeBot, PerplexityBot…)
 * do not run JavaScript. We therefore ship the full content as static, semantic HTML
 * inside #root (React replaces it on mount), plus JSON-LD, robots.txt, sitemap.xml,
 * llms.txt and llms-full.txt.
 *
 * Two prerendered pages: "/" (Thai first) and "/en/" (English first). Each has its own canonical,
 * og:url and og:locale, and both list each other as hreflang alternates.
 *
 * Rules every builder here follows:
 *  - Only the public projection of the content is baked (buildSiteFiles/injectIntoHtml apply
 *    publicProjection), so drafts, hidden items and hidden contact details never reach dist/.
 *  - Every href/src taken from the content goes through isSafeUrl/isSafeImageUrl; unsafe ones
 *    (javascript:, data:, …) are dropped and only their text is kept.
 *  - Content never becomes String.replace replacement text ("$&", "$`" … would be expanded);
 *    replacer functions insert it literally.
 */

/** Crawlers we explicitly welcome (search, AI training, AI answer engines, user-triggered fetchers). */
export const AI_USER_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "GoogleOther",
  "Googlebot",
  "Bingbot",
  "Applebot",
  "Applebot-Extended",
  "Amazonbot",
  "meta-externalagent",
  "meta-externalfetcher",
  "FacebookBot",
  "CCBot",
  "cohere-ai",
  "DuckAssistBot",
  "YouBot",
  "MistralAI-User",
  "Bytespider",
] as const;

export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const siteUrl = (c: Content): string => c.site.url.replace(/\/+$/, "");
const abs = (c: Content, url: string) => absoluteUrl(url, siteUrl(c));

/** Absolute URL of the prerendered page for a language: Thai at "/", English at "/en/". */
export const pageUrl = (c: Content, lang: Lang): string => `${siteUrl(c)}/${lang === "en" ? "en/" : ""}`;
/** hreflang → URL, the same on both pages and in the sitemap. */
export const hreflangs = (c: Content): [string, string][] => [
  ["th", pageUrl(c, "th")],
  ["en", pageUrl(c, "en")],
  ["x-default", pageUrl(c, "th")],
];

/** Absolute link target for a content URL, or "" when it is not safe to link (javascript:, data:, …). */
export function safeHref(c: Content, url: string | undefined): string {
  if (!url || !isSafeUrl(url)) return "";
  const out = abs(c, url);
  return isSafeUrl(out) ? out : "";
}

/** Absolute image URL (http(s) or a site path), or "" when it is not safe. */
export function safeImage(c: Content, url: string | undefined): string {
  if (!url || !isSafeImageUrl(url)) return "";
  const out = abs(c, url);
  return isSafeImageUrl(out) ? out : "";
}
const both = (l: Localized | undefined): { th: string; en: string } => ({ th: t(l, "th"), en: t(l, "en") });
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/** Join sentences with ". " without doubling punctuation ("Ltd." + "From…" → "Ltd. From…"). */
export const sentences = (...parts: string[]): string =>
  parts
    .map((x) => oneLine(x))
    .filter(Boolean)
    .map((x) => (/[.!?…:]$/.test(x) ? x : `${x}.`))
    .join(" ");
const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…");

export function ogImageUrl(c: Content): string {
  return safeImage(c, c.site.ogImage?.url) || abs(c, "/og.png");
}

export function pageTitle(c: Content, lang: Lang = c.site.defaultLang): string {
  return t(c.site.title, lang) || `${t(c.profile.name, "en")} (${c.profile.handle})`;
}

export function pageDescription(c: Content, lang: Lang = c.site.defaultLang): string {
  const base = t(c.site.description, lang);
  const headline = t(c.profile.headline, lang);
  return clip(base && base !== headline ? sentences(base, headline) : sentences(headline), 300);
}

/* ------------------------------------------------------------------ facts derived from the content */

/** Same labels as the site's project filter, so crawlers see the same words as visitors. */
const GROUP_LABEL: Record<string, { th: string; en: string }> = {
  utotech: { th: "Utotech", en: "Utotech" },
  client: { th: "งานลูกค้า", en: "Client work" },
  personal: { th: "ส่วนตัว", en: "Personal" },
  teaching: { th: "งานสอน", en: "Teaching" },
  school: { th: "สมัยเรียน", en: "School" },
  coop: { th: "สหกิจ", en: "Co-op" },
};

export function groupLabel(group: string): { th: string; en: string } {
  const known = Object.hasOwn(GROUP_LABEL, group) ? GROUP_LABEL[group] : undefined;
  if (known) return known;
  const words = group.replace(/[-_]+/g, " ").trim();
  const en = words ? words[0]!.toUpperCase() + words.slice(1) : "Other";
  return { th: en, en };
}

export type ProjectGroup = { group: string; label: { th: string; en: string }; items: Project[] };

/** Published projects by group, in contract order (utotech, client, personal, teaching, school, coop). */
export function projectGroups(c: Content): ProjectGroup[] {
  const published = c.projects.filter((x) => x.published);
  const order: string[] = [...PROJECT_GROUPS];
  for (const x of published) if (!order.includes(x.group)) order.push(x.group);
  return order
    .map((group) => ({ group, label: groupLabel(group), items: published.filter((x) => x.group === group) }))
    .filter((g) => g.items.length > 0);
}

/** Client work is shown as text only (often under NDA): no screenshots, no links unless the owner adds one. */
const isClient = (x: Project) => x.group === "client";

/** The honours part of an education program: "…, Computer Technology · First Class Honors · GPA 3.63" → "First Class Honors". */
export function honorsIn(program: string): string | null {
  for (const part of program.split(/\s*[·•|;,]\s*/)) {
    if (/\bhonou?rs\b/i.test(part)) return part.trim();
  }
  return null;
}

/** Timeline tags (any case) that mark a frame as an award or a competition result. */
export const AWARD_TAGS = ["award", "awards", "prize", "competition", "contest", "hackathon", "ctf", "scholarship"] as const;

/**
 * Awards the content states, in English: honours named in an education program and published
 * timeline frames tagged with one of AWARD_TAGS (title, plus its summary as written).
 * Nothing is inferred beyond that.
 */
export function awardsOf(c: Content): string[] {
  const out: string[] = [];
  for (const e of c.profile.education) {
    const honors = honorsIn(t(e.program, "en"));
    const school = t(e.school, "en");
    if (honors) out.push(school ? `${honors}, ${school}` : honors);
  }
  const tags = new Set<string>(AWARD_TAGS);
  for (const f of timelineFrames(c)) {
    if (!f.tags.some((x) => tags.has(x.trim().toLowerCase()))) continue;
    const title = oneLine(t(f.title, "en"));
    if (!title) continue;
    const year = f.date.slice(0, 4);
    const when = title.includes(year) ? "" : ` (${frameDateLong(f)})`;
    const summary = oneLine(t(f.summary, "en"));
    out.push(`${title}${when}${summary ? ` — ${summary}` : ""}`);
  }
  return [...new Set(out)];
}

/** "May to October 2023" from the diary entries' month names and periods ("" when it cannot tell). */
export function diaryRange(c: Content): string {
  const entries = c.diary.entries;
  const first = entries[0];
  const last = entries[entries.length - 1];
  if (!first || !last) return "";
  const yearOf = (period: string) => period.match(/\b(?:19|20)\d{2}\b(?!.*\b(?:19|20)\d{2}\b)/)?.[0] ?? "";
  const m1 = t(first.month, "en");
  const m2 = t(last.month, "en");
  const y1 = yearOf(first.period);
  const y2 = yearOf(last.period);
  if (!m1 || !m2) return "";
  if (first === last) return `${m1}${y1 ? ` ${y1}` : ""}`;
  return `${m1}${y1 && y1 !== y2 ? ` ${y1}` : ""} to ${m2}${y2 ? ` ${y2}` : ""}`;
}

/** Parse "Package from 20,000 THB" → 20000 (null when no number). */
export function parsePrice(text: string): number | null {
  const m = text.replace(/,/g, "").match(/(\d{3,})/);
  return m ? Number(m[1]) : null;
}

/* ------------------------------------------------------------------ robots / sitemap */

export function buildRobots(c: Content): string {
  const rules = ["Allow: /", "Allow: /llms.txt", "Allow: /llms-full.txt", "Disallow: /admin", "Disallow: /admin.html"];
  const lines = [
    "# Everyone is welcome to read and index this portfolio, including AI crawlers and assistants.",
    "# Plain-text versions for language models: /llms.txt and /llms-full.txt",
    "",
    ...AI_USER_AGENTS.map((ua) => `User-agent: ${ua}`),
    ...rules,
    "",
    "User-agent: *",
    ...rules,
    "",
    `Sitemap: ${siteUrl(c)}/sitemap.xml`,
    "",
  ];
  return lines.join("\n");
}

export function buildSitemap(c: Content): string {
  const base = siteUrl(c);
  const lastmod = (c.updatedAt || "").slice(0, 10);
  const lm = /^\d{4}-\d{2}-\d{2}$/.test(lastmod) ? `\n    <lastmod>${lastmod}</lastmod>` : "";
  const alts = hreflangs(c)
    .map(([lang, href]) => `\n    <xhtml:link rel="alternate" hreflang="${lang}" href="${esc(href)}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>${esc(pageUrl(c, "th"))}</loc>${lm}${alts}
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${esc(pageUrl(c, "en"))}</loc>${lm}${alts}
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${esc(base)}/llms-full.txt</loc>${lm}
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>
</urlset>
`;
}

/* ------------------------------------------------------------------ JSON-LD */

/** JSON-LD graph for the page in `lang` ("/" or "/en/"). The entities (person, Utotech, projects) share @ids across both pages. */
export function buildJsonLd(c: Content, lang: Lang = "th"): Record<string, unknown> {
  const base = siteUrl(c);
  const p = c.profile;
  const co = c.company;
  const personId = `${base}/#person`;
  const orgId = `${base}/#utotech`;
  const siteId = `${base}/#website`;
  const sameAs = p.links
    .filter((l) => /^https?:/i.test(l.url) && l.kind !== "website")
    .map((l) => safeHref(c, l.url))
    .filter(Boolean);
  const knowsAbout = c.skills
    .filter((g) => g.level >= 2)
    .flatMap((g) => g.items.map((i) => i.name));

  const person: Record<string, unknown> = {
    "@type": "Person",
    "@id": personId,
    name: t(p.name, "en"),
    alternateName: [p.handle, p.nickname, t(p.name, "th")].filter(Boolean),
    jobTitle: t(co.role, "en") || t(p.role, "en"),
    description: oneLine(t(p.bio, "en")),
    url: `${base}/`,
    worksFor: { "@id": orgId },
    knowsAbout,
    knowsLanguage: ["th", "en"],
    sameAs,
  };
  const avatar = safeImage(c, p.avatar?.url);
  if (avatar) person.image = avatar;
  if (p.email.visible && p.email.value && isSafeUrl(`mailto:${p.email.value}`)) person.email = `mailto:${p.email.value}`;
  if (p.phone.visible && p.phone.value) person.telephone = p.phone.value;

  const school = (l: Localized) => {
    const en = t(l, "en");
    const th = t(l, "th");
    return { "@type": "CollegeOrUniversity", name: en, ...(th && th !== en ? { alternateName: th } : {}) };
  };
  const schools = p.education.filter((e) => t(e.school, "en"));
  if (schools.length) person.alumniOf = schools.map((e) => school(e.school));
  const credentials = schools
    .filter((e) => t(e.program, "en"))
    .map((e) => {
      const program = oneLine(t(e.program, "en"));
      const name = program.split(/\s*·\s*/)[0] || program;
      return {
        "@type": "EducationalOccupationalCredential",
        name,
        ...(name !== program ? { description: program } : {}),
        ...(/\b(bachelor|master|doctor|ph\.?\s?d|degree)\b/i.test(program) ? { credentialCategory: "degree" } : {}),
        recognizedBy: school(e.school),
      };
    });
  if (credentials.length) person.hasCredential = credentials;
  const awards = awardsOf(c);
  if (awards.length) person.award = awards;

  const location = t(p.location, "en");
  const occupationName = t(co.role, "en") || t(p.role, "en");
  if (occupationName) {
    const roleText = t(p.role, "en");
    const workReady = c.skills.filter((g) => g.level === 3).flatMap((g) => g.items.map((i) => i.name));
    person.hasOccupation = {
      "@type": "Occupation",
      name: occupationName,
      ...(roleText && roleText !== occupationName ? { description: roleText } : {}),
      ...(location ? { occupationLocation: { "@type": "Country", name: location } } : {}),
      ...(workReady.length ? { skills: workReady } : {}),
    };
  }
  if (location) person.homeLocation = { "@type": "Country", name: location };

  const offers = co.services.map((s) => {
    const priceText = t(s.price, "en");
    const price = parsePrice(priceText);
    const offer: Record<string, unknown> = {
      "@type": "Offer",
      itemOffered: {
        "@type": "Service",
        name: t(s.title, "en"),
        description: sentences(t(s.subtitle, "en"), t(s.description, "en")),
        provider: { "@id": orgId },
      },
      description: priceText,
    };
    if (price !== null) offer.priceSpecification = { "@type": "PriceSpecification", minPrice: price, priceCurrency: "THB" };
    return offer;
  });

  const org: Record<string, unknown> = {
    "@type": "Organization",
    "@id": orgId,
    name: t(co.name, "en"),
    legalName: t(co.name, "en"),
    alternateName: [t(co.name, "th"), co.shortName].filter(Boolean),
    description: oneLine(t(co.about, "en")),
    slogan: t(co.slogan, "en") || undefined,
    url: safeHref(c, co.links.find((l) => l.kind === "website")?.url) || undefined,
    email: co.contact.email || undefined,
    telephone: co.contact.phone || undefined,
    taxID: co.contact.taxId || undefined,
    foundingDate: co.founded || undefined,
    numberOfEmployees: co.teamSize ? { "@type": "QuantitativeValue", minValue: Number.parseInt(co.teamSize, 10) || undefined, description: co.teamSize } : undefined,
    address: t(co.contact.officeAddress, "en")
      ? { "@type": "PostalAddress", streetAddress: t(co.contact.officeAddress, "en"), addressCountry: "TH" }
      : undefined,
    employee: { "@id": personId },
    makesOffer: offers,
  };
  const logo = safeImage(c, co.logo?.url);
  if (logo) org.logo = logo;

  const coProjects = co.projects.filter((x) => x.published);
  const portfolio = {
    "@type": "ItemList",
    "@id": `${base}/#utotech-projects`,
    name: `${t(co.name, "en")} projects`,
    numberOfItems: coProjects.length,
    itemListElement: coProjects.map((x, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "CreativeWork",
        name: x.name,
        genre: x.category,
        description: oneLine(t(x.description, "en") || t(x.summary, "en")),
        creator: { "@id": orgId },
        url: safeHref(c, x.url) || undefined,
        image: safeImage(c, x.cover?.url) || undefined,
      },
    })),
  };

  // Every published project, grouped like the site. Code with a public repository is
  // SoftwareSourceCode; everything else (client work, products) is a plain CreativeWork.
  const own = projectGroups(c).flatMap((g) => g.items.map((x) => ({ x, label: g.label.en })));
  const projects = {
    "@type": "ItemList",
    "@id": `${base}/#projects`,
    name: `${t(p.name, "en")} projects`,
    numberOfItems: own.length,
    itemListElement: own.map(({ x, label }, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": safeHref(c, x.repo) ? "SoftwareSourceCode" : "CreativeWork",
        name: x.name,
        description: oneLine(t(x.description, "en")),
        genre: label,
        // Utotech products are the company's; the rest is the owner's own work or work for clients.
        creator: { "@id": x.group === "utotech" ? orgId : personId },
        ...(x.tags.length ? { keywords: x.tags.join(", ") } : {}),
        codeRepository: safeHref(c, x.repo) || undefined,
        url: safeHref(c, x.url) || undefined,
        ...(x.year ? { dateCreated: x.year } : {}),
        image: (!isClient(x) && safeImage(c, x.image?.url)) || undefined,
      },
    })),
  };

  const page = {
    "@type": "ProfilePage",
    "@id": `${pageUrl(c, lang)}#page`,
    url: pageUrl(c, lang),
    name: pageTitle(c, lang),
    description: pageDescription(c, lang),
    // Both pages carry both languages; the page's own language comes first.
    inLanguage: lang === "en" ? ["en", "th"] : ["th", "en"],
    isPartOf: { "@id": siteId },
    mainEntity: { "@id": personId },
    about: [{ "@id": personId }, { "@id": orgId }],
    hasPart: [
      ...(coProjects.length ? [{ "@id": `${base}/#utotech-projects` }] : []),
      ...(own.length ? [{ "@id": `${base}/#projects` }] : []),
    ],
    primaryImageOfPage: ogImageUrl(c),
    ...(c.updatedAt ? { dateModified: c.updatedAt } : {}),
  };

  const website = {
    "@type": "WebSite",
    "@id": siteId,
    url: `${base}/`,
    name: pageTitle(c, "en"),
    inLanguage: ["th", "en"],
    publisher: { "@id": personId },
  };

  const graph = [website, page, person, org, ...(coProjects.length ? [portfolio] : []), ...(own.length ? [projects] : [])];
  // Round-trip drops the `undefined` fields left by optional values.
  return JSON.parse(JSON.stringify({ "@context": "https://schema.org", "@graph": graph })) as Record<string, unknown>;
}

/** JSON for a <script> tag: escape "<" so "</script>" can never close it early. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/* ------------------------------------------------------------------ <head> */

/** <head> tags for the page in `lang`: "th" is "/" (canonical, x-default), "en" is "/en/". */
export function buildHead(c: Content, lang: Lang = "th"): string {
  const url = pageUrl(c, lang);
  const title = pageTitle(c, lang);
  const desc = pageDescription(c, lang);
  const img = ogImageUrl(c);
  const imgAlt = t(c.site.ogImage?.alt, lang) || `${t(c.profile.name, "en")} · ${t(c.profile.role, lang)}`;
  // The default /og.png is 1200×630; a custom image only gets a size when the content gives one.
  const og = c.site.ogImage;
  const imgSize = safeImage(c, og?.url) ? (og?.width && og.height ? [og.width, og.height] : null) : [1200, 630];
  const keywords = [
    c.profile.handle,
    t(c.profile.name, "en"),
    t(c.company.name, "en"),
    t(c.company.name, "th"),
    "software house Thailand",
    ...c.skills.filter((g) => g.level === 3).flatMap((g) => g.items.map((i) => i.name)),
  ];
  const m = (name: string, content: string) => `<meta name="${name}" content="${esc(content)}" />`;
  const pr = (property: string, content: string) => `<meta property="${property}" content="${esc(content)}" />`;
  return [
    `<title>${esc(title)}</title>`,
    m("description", desc),
    m("author", t(c.profile.name, "en")),
    m("keywords", [...new Set(keywords.filter(Boolean))].join(", ")),
    m("robots", "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"),
    m("googlebot", "index, follow, max-image-preview:large, max-snippet:-1"),
    `<link rel="canonical" href="${esc(url)}" />`,
    ...hreflangs(c).map(([hl, href]) => `<link rel="alternate" hreflang="${hl}" href="${esc(href)}" />`),
    `<link rel="alternate" type="text/plain" title="LLM summary (llms.txt)" href="/llms.txt" />`,
    `<link rel="alternate" type="text/plain" title="Full content for language models" href="/llms-full.txt" />`,
    `<link rel="sitemap" type="application/xml" href="/sitemap.xml" />`,
    pr("og:type", "profile"),
    pr("og:site_name", c.profile.handle || title),
    pr("og:title", title),
    pr("og:description", desc),
    pr("og:url", url),
    pr("og:image", img),
    pr("og:image:alt", imgAlt),
    ...(imgSize ? [pr("og:image:width", String(imgSize[0])), pr("og:image:height", String(imgSize[1]))] : []),
    pr("og:locale", lang === "th" ? "th_TH" : "en_US"),
    pr("og:locale:alternate", lang === "th" ? "en_US" : "th_TH"),
    pr("profile:username", c.profile.handle),
    m("twitter:card", "summary_large_image"),
    m("twitter:title", title),
    m("twitter:description", desc),
    m("twitter:image", img),
    m("twitter:image:alt", imgAlt),
    `<script type="application/ld+json">${jsonForScript(buildJsonLd(c, lang))}</script>`,
  ].join("\n    ");
}

/* ------------------------------------------------------------------ static HTML snapshot */

/** Both languages of a value, the page's language first (only one when they are the same). */
function ordered(l: Localized | undefined, first: Lang): [Lang, string][] {
  const { th, en } = both(l);
  if (!th && !en) return [];
  if (th === en || !th) return [["en", en]];
  if (!en) return [["th", th]];
  return first === "en" ? [["en", en], ["th", th]] : [["th", th], ["en", en]];
}
/** <a> for a link target the caller already made safe (constants, safeHref output). */
const A = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`;

/**
 * Full content as semantic HTML. Shown until React mounts and to crawlers that don't run JS.
 * `lang` is the page's language: its text comes first wherever both languages are shown.
 */
export function buildSnapshot(c: Content, lang: Lang = "th"): string {
  const T = (l: Localized | undefined, tag = "span"): string =>
    ordered(l, lang)
      .map(([hl, text]) => `<${tag} lang="${hl}">${esc(text)}</${tag}>`)
      .join(" ");
  const P = (l: Localized | undefined) =>
    ordered(l, lang)
      .map(([hl, text]) => `<p lang="${hl}">${esc(text)}</p>`)
      .join("");
  /** Link to a content URL; an unsafe one (javascript:, data:, …) keeps only its text. */
  const link = (url: string | undefined, text: string) => {
    const href = safeHref(c, url);
    return href ? A(href, text) : esc(text);
  };
  const base = siteUrl(c);
  const p = c.profile;
  const co = c.company;
  const frames = timelineFrames(c);
  const out: string[] = [];
  out.push(`<div class="seo-static">`);
  const kicker = [p.handle && `@${esc(p.handle)}`, p.nickname && esc(p.nickname), T(p.location)].filter(Boolean).join(" · ");
  out.push(`<header><p class="seo-handle">${kicker}</p><h1>${esc(t(p.name, "en"))}${t(p.name, "th") ? ` <span lang="th">(${esc(t(p.name, "th"))})</span>` : ""}</h1>`);
  out.push(`<p>${T(p.role)}</p>`);
  for (const e of p.education) {
    out.push(`<p>${[T(e.school), T(e.program), e.period && esc(e.period)].filter(Boolean).join(" · ")}</p>`);
  }
  out.push(`${P(p.headline)}${P(p.bio)}${P(p.dream)}`);
  out.push(`<nav aria-label="Sections"><ul>${[["#film", "Timeline"], ["#utotech", "Utotech"], ["#projects", "Projects"], ["#skills", "Skills"], ["#diary", "Co-op diary"], ["#contact", "Contact"]].map(([h, l]) => `<li>${A(h!, l!)}</li>`).join("")}</ul></nav></header>`);

  out.push(`<main>`);
  // Timeline
  out.push(`<section id="film"><h2>Timeline · ไทม์ไลน์</h2><ol>`);
  for (const f of frames) {
    out.push(`<li><article><h3>${T(f.title)}</h3><p><time datetime="${esc(f.date)}">${esc(frameDateLabel(f))}</time></p>${P(f.summary)}${P(f.body)}`);
    if (f.tags.length) out.push(`<p>Tags: ${esc(f.tags.join(", "))}</p>`);
    if (f.links.length) out.push(`<ul>${f.links.map((l) => `<li>${link(l.url, l.label || l.url)}</li>`).join("")}</ul>`);
    out.push(`</article></li>`);
  }
  out.push(`</ol></section>`);

  // Utotech
  out.push(`<section id="utotech"><h2>${T(co.name)}</h2>`);
  out.push(`<p>${T(co.role)} · ${T(co.tagline)}</p>`);
  if (co.slogan.en || co.slogan.th) out.push(`<p>${T(co.slogan)}</p>`);
  const facts: string[] = [];
  if (co.founded) facts.push(`Founded: ${esc(co.founded)}`);
  if (co.teamSize) facts.push(`Team: ${esc(co.teamSize)} people`);
  facts.push(`Projects: ${co.projects.filter((x) => x.published).length}`, `Customers: ${co.customers.length}`);
  out.push(`<p>${facts.join(" · ")}</p>`);
  out.push(`<h3>About · เกี่ยวกับเรา</h3>${P(co.about)}<h3>Mission · ภารกิจ</h3>${P(co.mission)}<h3>Vision · วิสัยทัศน์</h3>${P(co.vision)}<h3>Story · เรื่องราว</h3>${P(co.story)}`);
  if (co.highlights.length) out.push(`<ul>${co.highlights.map((h) => `<li><strong>${T(h.title)}</strong> ${T(h.description)}</li>`).join("")}</ul>`);
  if (co.workWithUs.length) {
    out.push(`<h3>Working with us · ทำงานกับเรา</h3>`);
    for (const w of co.workWithUs) out.push(`<h4>${T(w.title)}</h4><p><strong>${T(w.heading)}</strong></p>${P(w.description)}`);
  }
  if (co.services.length) {
    out.push(`<h3>Services and prices · บริการและราคา</h3><table><thead><tr><th>Service</th><th>Scope</th><th>Description</th><th>Price</th></tr></thead><tbody>`);
    for (const s of co.services) out.push(`<tr><td>${T(s.title)}</td><td>${T(s.subtitle)}</td><td>${T(s.description)}</td><td>${T(s.price)}</td></tr>`);
    out.push(`</tbody></table>`);
  }
  const ups = co.projects.filter((x) => x.published);
  if (ups.length) {
    out.push(`<h3>Projects · ผลงาน</h3>`);
    for (const x of ups) {
      out.push(`<article><h4>${link(x.url, x.name)}</h4><p>${esc(x.category)} · ${T(x.summary)}</p>${P(x.description)}`);
      if (x.features.length) out.push(`<ul>${x.features.map((f) => `<li><strong>${T(f.title)}</strong>: ${T(f.description)}</li>`).join("")}</ul>`);
      out.push(`</article>`);
    }
  }
  if (co.customers.length) out.push(`<h3>Customers · ลูกค้า</h3><ul>${co.customers.map((x) => `<li>${link(x.url, x.name)}</li>`).join("")}</ul>`);
  const ct = co.contact;
  out.push(`<h3>Contact · ติดต่อ</h3><address>`);
  if (ct.email) out.push(`<p>Email: ${link(`mailto:${ct.email}`, ct.email)}</p>`);
  if (ct.ceoEmail) out.push(`<p>CEO: ${link(`mailto:${ct.ceoEmail}`, ct.ceoEmail)}</p>`);
  if (ct.phone) out.push(`<p>Phone: ${link(`tel:${ct.phone.replace(/[^+\d]/g, "")}`, ct.phone)}</p>`);
  if (ct.officeAddress.en || ct.officeAddress.th) out.push(`<p>Office: ${T(ct.officeAddress)}</p>`);
  if (ct.registeredAddress.en || ct.registeredAddress.th) out.push(`<p>Registered: ${T(ct.registeredAddress)}</p>`);
  if (ct.taxId) out.push(`<p>Tax ID: ${esc(ct.taxId)}</p>`);
  out.push(`</address>`);
  if (co.links.length) out.push(`<ul>${co.links.map((l) => `<li>${link(l.url, l.label || l.url)}</li>`).join("")}</ul>`);
  out.push(`</section>`);

  // Projects, grouped like the site's filter (Utotech, client work, personal, teaching, school, co-op)
  const groups = projectGroups(c);
  if (groups.length) {
    out.push(`<section id="projects"><h2>Projects · โปรเจกต์</h2>`);
    for (const g of groups) {
      out.push(`<h3>${T(g.label)}</h3><ul>`);
      for (const x of g.items) {
        // "source"/"demo" alone mean nothing without the link, so an unsafe one is left out entirely.
        const repo = safeHref(c, x.repo);
        const demo = safeHref(c, x.url);
        const links = [repo && A(repo, "source"), demo && A(demo, "demo")].filter(Boolean).join(" · ");
        out.push(`<li><strong>${esc(x.name)}</strong>${x.year ? ` (${esc(x.year)})` : ""}: ${T(x.description)}${x.tags.length ? ` [${esc(x.tags.join(", "))}]` : ""}${links ? ` ${links}` : ""}</li>`);
      }
      out.push(`</ul>`);
    }
    out.push(`</section>`);
  }

  // Skills
  if (c.skills.length) {
    out.push(`<section id="skills"><h2>Skills · ทักษะ</h2>`);
    for (const g of [...c.skills].sort((a, b) => b.level - a.level)) {
      out.push(`<h3>${T(g.title)} (${"■".repeat(g.level)}${"□".repeat(3 - g.level)})</h3>${P(g.description)}<p>${esc(g.items.map((i) => i.name).join(", "))}</p>`);
    }
    out.push(`</section>`);
  }

  // Diary
  const d = c.diary;
  out.push(`<section id="diary"><h2>${T(d.title)}</h2>${P(d.intro)}`);
  out.push(`<h3>${T(d.company.name)}${d.company.legalName ? ` · ${esc(d.company.legalName)}` : ""}</h3>${P(d.company.about)}`);
  if (d.company.address.en || d.company.address.th) out.push(`<p>${T(d.company.address)}</p>`);
  if (d.company.website) out.push(`<p>${link(d.company.website, d.company.website)}</p>`);
  if (d.duties.length) out.push(`<ul>${d.duties.map((x) => `<li><strong>${T(x.title)}</strong>: ${T(x.description)}</li>`).join("")}</ul>`);
  for (const e of d.entries) out.push(`<article><h4>${T(e.month)} · ${esc(e.period)}</h4><p>${T(e.title)}</p>${P(e.body)}</article>`);
  out.push(`</section>`);

  // Documents
  const docs = c.documents.filter((x) => safeHref(c, x.url));
  if (docs.length) out.push(`<section id="documents"><h2>Documents · เอกสาร</h2><ul>${docs.map((x) => `<li>${link(x.url, t(x.title, lang))} ${T(x.description)}</li>`).join("")}</ul></section>`);
  out.push(`</main>`);

  // Contact
  out.push(`<footer id="contact"><h2>Contact · ติดต่อ</h2><ul>`);
  for (const l of p.links) out.push(`<li>${link(l.url, l.label || l.url)}</li>`);
  if (p.email.visible && p.email.value) out.push(`<li>${link(`mailto:${p.email.value}`, p.email.value)}</li>`);
  if (p.phone.visible && p.phone.value) out.push(`<li>${link(`tel:${p.phone.value.replace(/[^+\d]/g, "")}`, p.phone.value)}</li>`);
  out.push(`</ul><p>${A(`${base}/llms-full.txt`, "Plain-text version for AI assistants")}</p></footer>`);
  out.push(`</div>`);
  return out.join("");
}

/** Small stylesheet for the snapshot (dark, readable) so the pre-JS paint matches the darkroom look. */
export const SNAPSHOT_CSS =
  ".seo-static{max-width:72ch;margin:0 auto;padding:32px max(16px,env(safe-area-inset-left,0px));color:#efe2d6;font:16px/1.65 'Chakra Petch',system-ui,sans-serif}" +
  ".seo-static h1,.seo-static h2{font-family:'Pixelify Sans','Chakra Petch',monospace;line-height:1.1}" +
  ".seo-static a{color:#ff8a76}.seo-static table{border-collapse:collapse;display:block;overflow-x:auto}" +
  ".seo-static td,.seo-static th{border:1px solid #4a1812;padding:6px 8px;vertical-align:top}" +
  ".seo-handle{font-family:VT323,monospace;color:#ff8a76;letter-spacing:.1em}";

/* ------------------------------------------------------------------ llms.txt */

/** Markdown link when the URL is safe, else the label alone. */
const mdLink = (c: Content, label: string, url: string | undefined): string => {
  const href = safeHref(c, url);
  return href ? `[${label}](${href})` : label;
};

export function buildLlmsTxt(c: Content): string {
  const base = siteUrl(c);
  const p = c.profile;
  const co = c.company;
  const L: string[] = [];
  L.push(`# ${t(p.name, "en")} (${p.handle})`);
  L.push("");
  const team = co.teamSize ? ` with a ${co.teamSize} person team` : "";
  const tagline = t(co.tagline, "en").replace(/^A /, "a ");
  L.push(`> ${sentences(t(p.role, "en"), t(p.headline, "en"), tagline ? `${t(co.name, "en")} is ${tagline}${team}` : "")}`);
  L.push("");
  L.push(oneLine(t(p.bio, "en")));
  L.push("");
  L.push("This site is bilingual (Thai and English). Everyone, including AI crawlers and assistants, may read, index and cite it.");
  L.push("");
  L.push("## Portfolio");
  L.push(`- [Full content as plain text](${base}/llms-full.txt): every section below in one file, Thai and English`);
  L.push(`- [Portfolio home](${base}/): film-strip timeline, Utotech, projects, skills, co-op diary`);
  L.push(`- [English version](${pageUrl(c, "en")}): the same page with English first`);
  L.push("");
  L.push("## Timeline");
  for (const f of timelineFrames(c)) L.push(`- ${frameDateLong(f)} · ${t(f.title, "en")}: ${oneLine(t(f.summary, "en"))}`);
  L.push("");
  L.push(`## ${t(co.name, "en")}`);
  const web = safeHref(c, co.links.find((l) => l.kind === "website")?.url);
  if (web) L.push(`- [${t(co.name, "en")} website](${web}): ${oneLine(t(co.about, "en"))}`);
  for (const s of co.services) L.push(`- Service · ${t(s.title, "en")}: ${t(s.subtitle, "en")} (${t(s.price, "en")})`);
  for (const x of co.projects.filter((y) => y.published)) {
    L.push(`- ${mdLink(c, `Project · ${x.name}`, x.url)}: ${t(x.summary, "en")}`);
  }
  if (co.contact.email) L.push(`- Contact: ${co.contact.email}${co.contact.phone ? `, ${co.contact.phone}` : ""}`);
  L.push("");
  L.push("## Projects");
  for (const g of projectGroups(c)) {
    for (const x of g.items) {
      const name = mdLink(c, x.name, safeHref(c, x.url) ? x.url : x.repo);
      const meta = [g.label.en, x.year].filter(Boolean).join(", ");
      L.push(`- ${name} (${meta}): ${oneLine(t(x.description, "en"))}`);
    }
  }
  L.push("");
  L.push("## Optional");
  const range = diaryRange(c);
  L.push(`- [Co-op diary at ${t(c.diary.company.name, "en")}](${base}/#diary): monthly notes${range ? `, ${range}` : ""}`);
  for (const l of p.links) {
    const href = safeHref(c, l.url);
    if (href) L.push(`- [${l.label || l.kind}](${href})`);
  }
  L.push("");
  return L.join("\n");
}

/** "- label: https://…" lines for the safe URLs only (unsafe or empty ones are left out). */
function urlList(c: Content, items: [string, string | undefined][]): string {
  return items
    .map(([label, url]) => [label, safeHref(c, url)] as const)
    .filter(([, href]) => href)
    .map(([label, href]) => `- ${label}: ${href}`)
    .join("\n");
}

function md(l: Localized | undefined): string {
  const { th, en } = both(l);
  if (!th || th === en) return en;
  if (!en) return th;
  return `${en}\n\n${th}`;
}

export function buildLlmsFull(c: Content): string {
  const base = siteUrl(c);
  const p = c.profile;
  const co = c.company;
  const L: string[] = [];
  const h = (n: number, s: string) => L.push(`${"#".repeat(n)} ${s}`, "");
  const para = (s: string) => {
    if (s.trim()) L.push(s.trim(), "");
  };
  h(1, `${t(p.name, "en")} (${p.handle})`);
  para(`> ${t(p.role, "en")} · ${t(p.role, "th")}`);
  // deploy.yml's daily run reads "Last updated: <updatedAt> " from here to skip rebuilding unchanged content.
  para(`Source: ${base}/ · Last updated: ${c.updatedAt || "unknown"} · Languages: Thai and English. AI crawlers and assistants are welcome to read and cite this content.`);
  h(2, "Profile");
  para(
    [
      p.nickname && `- Nickname: ${p.nickname}`,
      t(p.location, "en") && `- Location: ${t(p.location, "en")}`,
      p.codingSince && `- Coding since: ${p.codingSince}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  para(md(p.headline));
  para(md(p.bio));
  para(md(p.dream));
  if (p.education.length) para(p.education.map((e) => `- Education: ${t(e.school, "en")} · ${t(e.program, "en")}${e.period ? ` (${e.period})` : ""}`).join("\n"));
  const awards = awardsOf(c);
  if (awards.length) para(awards.map((a) => `- Award: ${a}`).join("\n"));
  para(urlList(c, p.links.map((l) => [l.label || l.kind, l.url])));
  if (p.email.visible && p.email.value) para(`- Email: ${p.email.value}`);

  h(2, "Timeline");
  for (const f of timelineFrames(c)) {
    h(3, `${frameDateLong(f)} · ${t(f.title, "en")}${t(f.title, "th") && t(f.title, "th") !== t(f.title, "en") ? ` · ${t(f.title, "th")}` : ""}`);
    para(md(f.summary));
    para(md(f.body));
    if (f.tags.length) para(`Tags: ${f.tags.join(", ")}`);
    para(urlList(c, f.links.map((l) => [l.label || l.kind, l.url])));
  }

  h(2, `${t(co.name, "en")} · ${t(co.name, "th")}`);
  para(sentences(`${t(p.name, "en")} is ${t(co.role, "en")} of ${t(co.name, "en")}`));
  para(
    [
      co.tagline.en && `- Tagline: ${t(co.tagline, "en")}`,
      co.slogan.en && `- Slogan: ${t(co.slogan, "en")}`,
      co.founded && `- Founded: ${co.founded}${t(co.foundedNote, "en") ? ` (${t(co.foundedNote, "en")})` : ""}`,
      co.teamSize && `- Team size: ${co.teamSize}`,
      co.links.some((l) => safeHref(c, l.url)) && `- Links: ${co.links.map((l) => safeHref(c, l.url)).filter(Boolean).join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  h(3, "About");
  para(md(co.about));
  h(3, "Mission");
  para(md(co.mission));
  h(3, "Vision");
  para(md(co.vision));
  h(3, "Story");
  para(md(co.story));
  if (co.highlights.length) {
    h(3, "Highlights");
    para(co.highlights.map((x) => `- ${t(x.title, "en")}: ${oneLine(t(x.description, "en"))}`).join("\n"));
  }
  if (co.workWithUs.length) {
    h(3, "Working with us");
    for (const w of co.workWithUs) para(`**${t(w.title, "en")} · ${t(w.heading, "en")}**\n\n${md(w.description)}`);
  }
  if (co.services.length) {
    h(3, "Services and prices");
    para(
      [
        "| Service | Scope | Description | Price |",
        "| --- | --- | --- | --- |",
        ...co.services.map((s) =>
          `| ${t(s.title, "en")} | ${t(s.subtitle, "en")} | ${oneLine(t(s.description, "en"))} | ${t(s.price, "en")} |`.replace(/\n/g, " "),
        ),
      ].join("\n"),
    );
  }
  const ups = co.projects.filter((x) => x.published);
  if (ups.length) {
    h(3, "Portfolio");
    for (const x of ups) {
      h(4, `${x.name} (${x.category})`);
      para(md(x.summary));
      para(md(x.description));
      if (safeHref(c, x.url)) para(`Demo: ${safeHref(c, x.url)}`);
      if (x.features.length) para(x.features.map((f) => `- ${t(f.title, "en")}: ${oneLine(t(f.description, "en"))}`).join("\n"));
    }
  }
  if (co.customers.length) {
    h(3, "Customers");
    para(co.customers.map((x) => `- ${x.name}${safeHref(c, x.url) ? ` (${safeHref(c, x.url)})` : ""}`).join("\n"));
  }
  h(3, "Contact");
  const ct = co.contact;
  para(
    [
      ct.email && `- Email: ${ct.email}`,
      ct.ceoEmail && `- CEO email: ${ct.ceoEmail}`,
      ct.phone && `- Phone: ${ct.phone}`,
      (ct.officeAddress.en || ct.officeAddress.th) && `- Office: ${t(ct.officeAddress, "en")} / ${t(ct.officeAddress, "th")}`,
      (ct.registeredAddress.en || ct.registeredAddress.th) && `- Registered address: ${t(ct.registeredAddress, "en")} / ${t(ct.registeredAddress, "th")}`,
      ct.taxId && `- Tax ID: ${ct.taxId}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const groups = projectGroups(c);
  if (groups.length) {
    h(2, "Projects");
    for (const g of groups) {
      h(3, g.label.th !== g.label.en ? `${g.label.en} · ${g.label.th}` : g.label.en);
      if (g.group === "client") para("Work for clients, described in text only.");
      for (const x of g.items) {
        h(4, `${x.name}${x.year ? ` (${x.year})` : ""}`);
        para(md(x.description));
        const repo = safeHref(c, x.repo);
        const demo = safeHref(c, x.url);
        para([x.tags.length && `Tags: ${x.tags.join(", ")}`, repo && `Source: ${repo}`, demo && `Demo: ${demo}`].filter(Boolean).join("\n"));
      }
    }
  }

  h(2, "Skills");
  for (const g of [...c.skills].sort((a, b) => b.level - a.level)) {
    h(3, `${t(g.title, "en")} (level ${g.level} of 3)`);
    para(md(g.description));
    para(g.items.map((i) => i.name).join(", "));
  }

  const d = c.diary;
  h(2, t(d.title, "en") || "Co-op diary");
  para(md(d.intro));
  para(
    [
      `- Company: ${t(d.company.name, "en")}${d.company.legalName ? ` (${d.company.legalName})` : ""}`,
      (d.company.address.en || d.company.address.th) && `- Address: ${t(d.company.address, "en")}`,
      safeHref(c, d.company.website) && `- Website: ${safeHref(c, d.company.website)}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  para(md(d.company.about));
  for (const x of d.duties) para(`**${t(x.title, "en")}**: ${t(x.description, "en")}`);
  for (const e of d.entries) {
    h(3, `${t(e.month, "en")} · ${e.period}`);
    para(md(e.title));
    para(md(e.body));
  }

  const docs = urlList(c, c.documents.map((x) => [t(x.title, "en"), x.url]));
  if (docs) {
    h(2, "Documents");
    para(docs);
  }
  return L.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/* ------------------------------------------------------------------ HTML injection */

/** id of the <script type="application/json"> that carries the baked public content for the app. */
export const CONTENT_SCRIPT_ID = "pho0m-content";

/**
 * First thing in the injected <head>: adds the "js" class to <html>, which hides the snapshot
 * (NO_FLASH_CSS) while the app loads, so visitors do not see it flash before React mounts.
 * If #root is not marked data-mounted="1" after 4 s (script error, very old browser), the class
 * is removed again and the snapshot shows. Without JavaScript the class is never added.
 */
export const NO_FLASH_SCRIPT =
  '(function(d){var h=d.documentElement;h.classList.add("js");setTimeout(function(){var r=d.getElementById("root");' +
  'if(!r||r.getAttribute("data-mounted")!=="1")h.classList.remove("js")},4000)})(document);';
export const NO_FLASH_CSS = ".js .seo-static{display:none}";

const STRIP = [
  /\s*<title>[\s\S]*?<\/title>/gi,
  /\s*<meta\s+(?:name|property)="(?:description|author|keywords|robots|googlebot|og:[^"]*|twitter:[^"]*|profile:[^"]*)"[^>]*>/gi,
  /\s*<link\s+rel="(?:canonical|sitemap)"[^>]*>/gi,
  /\s*<link\s+rel="alternate"[^>]*>/gi,
  /\s*<script\s+type="application\/ld\+json"[\s\S]*?<\/script>/gi,
  /\s*<script data-seo>[\s\S]*?<\/script>/gi,
  /\s*<style data-seo>[\s\S]*?<\/style>/gi,
  // Its JSON has every "<" escaped, so the first "</script>" is its own.
  new RegExp(`\\s*<script type="application/json" id="${CONTENT_SCRIPT_ID}">[\\s\\S]*?</script>`, "gi"),
];
const SNAP_START = "<!--seo-snapshot-->";
const SNAP_END = "<!--/seo-snapshot-->";

/**
 * The page for `lang` ("th" → "/", "en" → "/en/") from the app shell: SEO head tags, the static
 * snapshot inside <div id="root"> and the public content as JSON before </body>.
 * Works on the plain Vite output and on an already injected page (re-runs give the same result).
 * Only publicProjection(content) is used.
 */
export function injectIntoHtml(html: string, content: Content, lang: Lang = "th"): string {
  const c = publicProjection(content);
  let out = html;
  for (const re of STRIP) out = out.replace(re, "");
  if (!/<\/head>/i.test(out)) throw new Error("index.html has no </head>");
  if (!/<\/body>/i.test(out)) throw new Error("index.html has no </body>");
  // Every insert below goes through a replacer function: content inside a replacement *string*
  // would have "$&", "$`", "$'" and "$$" expanded by String.prototype.replace.
  const head = `  <script data-seo>${NO_FLASH_SCRIPT}</script>\n    ${buildHead(c, lang)}\n    <style data-seo>${SNAPSHOT_CSS}${NO_FLASH_CSS}</style>\n  </head>`;
  out = out.replace(/<\/head>/i, () => head);
  const snap = `${SNAP_START}${buildSnapshot(c, lang)}${SNAP_END}`;
  const prev = out.indexOf(SNAP_START);
  if (prev !== -1) {
    // Already injected (re-run): swap the old snapshot for the new one.
    const end = out.indexOf(SNAP_END, prev);
    if (end === -1) throw new Error("index.html has a broken SEO snapshot marker");
    out = out.slice(0, prev) + snap + out.slice(end + SNAP_END.length);
  } else {
    const rootRe = /<div id="root">\s*<\/div>/i;
    if (!rootRe.test(out)) throw new Error('index.html has no empty <div id="root"></div>');
    out = out.replace(rootRe, () => `<div id="root">${snap}</div>`);
  }
  const data = `  <script type="application/json" id="${CONTENT_SCRIPT_ID}">${jsonForScript(c)}</script>\n  </body>`;
  out = out.replace(/<\/body>/i, () => data);
  out = /<html\s[^>]*\blang="/i.test(out)
    ? out.replace(/(<html\s[^>]*\blang=")[^"]*"/i, (_m, start: string) => `${start}${lang}"`)
    : out.replace(/<html\b/i, () => `<html lang="${lang}"`);
  return out;
}

/**
 * Every file the post-build step writes, by path inside web/dist. `html` is the built
 * index.html (the app shell); both pages are made from it. Bakes publicProjection(content) only.
 */
export function buildSiteFiles(html: string, content: Content): Record<string, string> {
  const c = publicProjection(content);
  return {
    "index.html": injectIntoHtml(html, c, "th"),
    "en/index.html": injectIntoHtml(html, c, "en"),
    "robots.txt": buildRobots(c),
    "sitemap.xml": buildSitemap(c),
    "llms.txt": buildLlmsTxt(c),
    "llms-full.txt": buildLlmsFull(c),
  };
}
