import {
  absoluteUrl,
  frameDateLabel,
  frameDateLong,
  t,
  timelineFrames,
  type Content,
  type Lang,
  type Localized,
} from "@pho0m/content";

/**
 * Build-time SEO + AI-crawler output. Everything here is pure (string in → string out)
 * so it is unit-tested; web/src/seo/postbuild.ts writes the results into web/dist.
 *
 * Why: the site is a React SPA, and most AI crawlers (GPTBot, ClaudeBot, PerplexityBot…)
 * do not run JavaScript. We therefore ship the full content as static, semantic HTML
 * inside #root (React replaces it on mount), plus JSON-LD, robots.txt, sitemap.xml,
 * llms.txt and llms-full.txt.
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
  return abs(c, c.site.ogImage?.url || "/og.png");
}

export function pageTitle(c: Content, lang: Lang = c.site.defaultLang): string {
  return t(c.site.title, lang) || `${t(c.profile.name, "en")} (${c.profile.handle})`;
}

export function pageDescription(c: Content, lang: Lang = c.site.defaultLang): string {
  const base = t(c.site.description, lang);
  const headline = t(c.profile.headline, lang);
  return clip(base && base !== headline ? sentences(base, headline) : sentences(headline), 300);
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
  const alt = (href: string, lang: string) => `\n    <xhtml:link rel="alternate" hreflang="${lang}" href="${esc(href)}"/>`;
  const alts = alt(`${base}/`, "th") + alt(`${base}/?lang=en`, "en") + alt(`${base}/`, "x-default");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>${esc(base)}/</loc>${lm}${alts}
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${esc(base)}/?lang=en</loc>${lm}${alts}
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

export function buildJsonLd(c: Content): Record<string, unknown> {
  const base = siteUrl(c);
  const p = c.profile;
  const co = c.company;
  const personId = `${base}/#person`;
  const orgId = `${base}/#utotech`;
  const siteId = `${base}/#website`;
  const sameAs = p.links.filter((l) => /^https?:/.test(l.url) && l.kind !== "website").map((l) => l.url);
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
  if (p.avatar) person.image = abs(c, p.avatar.url);
  if (p.email.visible && p.email.value) person.email = `mailto:${p.email.value}`;
  if (p.phone.visible && p.phone.value) person.telephone = p.phone.value;
  const edu = p.education.map((e) => ({ "@type": "CollegeOrUniversity", name: t(e.school, "en") }));
  if (edu.length) person.alumniOf = edu;

  const offers = co.services.map((s) => {
    const priceText = t(s.price, "en");
    const price = parsePrice(priceText);
    const offer: Record<string, unknown> = {
      "@type": "Offer",
      itemOffered: {
        "@type": "Service",
        name: t(s.title, "en"),
        description: oneLine(`${t(s.subtitle, "en")}. ${t(s.description, "en")}`),
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
    url: co.links.find((l) => l.kind === "website")?.url || undefined,
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
  if (co.logo) org.logo = abs(c, co.logo.url);

  const portfolio = {
    "@type": "ItemList",
    "@id": `${base}/#utotech-projects`,
    name: `${t(co.name, "en")} projects`,
    itemListElement: co.projects
      .filter((x) => x.published)
      .map((x, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "CreativeWork",
          name: x.name,
          genre: x.category,
          description: oneLine(t(x.description, "en") || t(x.summary, "en")),
          creator: { "@id": orgId },
          ...(x.url ? { url: x.url } : {}),
          ...(x.cover ? { image: abs(c, x.cover.url) } : {}),
        },
      })),
  };

  const projects = {
    "@type": "ItemList",
    "@id": `${base}/#projects`,
    name: `${t(p.name, "en")} projects`,
    itemListElement: c.projects
      .filter((x) => x.published)
      .map((x, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "SoftwareSourceCode",
          name: x.name,
          description: oneLine(t(x.description, "en")),
          author: { "@id": personId },
          keywords: x.tags.join(", "),
          ...(x.repo ? { codeRepository: x.repo } : {}),
          ...(x.url ? { url: x.url } : {}),
          ...(x.year ? { dateCreated: x.year } : {}),
        },
      })),
  };

  const page = {
    "@type": "ProfilePage",
    "@id": `${base}/#page`,
    url: `${base}/`,
    name: pageTitle(c, "en"),
    description: pageDescription(c, "en"),
    inLanguage: ["th", "en"],
    isPartOf: { "@id": siteId },
    mainEntity: { "@id": personId },
    about: [{ "@id": personId }, { "@id": orgId }],
    hasPart: [{ "@id": `${base}/#utotech-projects` }, { "@id": `${base}/#projects` }],
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

  return JSON.parse(
    JSON.stringify({ "@context": "https://schema.org", "@graph": [website, page, person, org, portfolio, projects] }),
  ) as Record<string, unknown>;
}

/** JSON for a <script> tag: escape "<" so "</script>" can never close it early. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/* ------------------------------------------------------------------ <head> */

export function buildHead(c: Content): string {
  const base = siteUrl(c);
  const lang = c.site.defaultLang;
  const title = pageTitle(c, lang);
  const desc = pageDescription(c, lang);
  const img = ogImageUrl(c);
  const imgAlt = `${t(c.profile.name, "en")} · ${t(c.profile.role, "en")}`;
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
    `<link rel="canonical" href="${esc(base)}/" />`,
    `<link rel="alternate" hreflang="th" href="${esc(base)}/" />`,
    `<link rel="alternate" hreflang="en" href="${esc(base)}/?lang=en" />`,
    `<link rel="alternate" hreflang="x-default" href="${esc(base)}/" />`,
    `<link rel="alternate" type="text/plain" title="LLM summary (llms.txt)" href="/llms.txt" />`,
    `<link rel="alternate" type="text/plain" title="Full content for language models" href="/llms-full.txt" />`,
    `<link rel="sitemap" type="application/xml" href="/sitemap.xml" />`,
    pr("og:type", "profile"),
    pr("og:site_name", c.profile.handle || title),
    pr("og:title", title),
    pr("og:description", desc),
    pr("og:url", `${base}/`),
    pr("og:image", img),
    pr("og:image:alt", imgAlt),
    pr("og:image:width", "1200"),
    pr("og:image:height", "630"),
    pr("og:locale", lang === "th" ? "th_TH" : "en_US"),
    pr("og:locale:alternate", lang === "th" ? "en_US" : "th_TH"),
    pr("profile:username", c.profile.handle),
    m("twitter:card", "summary_large_image"),
    m("twitter:title", title),
    m("twitter:description", desc),
    m("twitter:image", img),
    m("twitter:image:alt", imgAlt),
    `<script type="application/ld+json">${jsonForScript(buildJsonLd(c))}</script>`,
  ].join("\n    ");
}

/* ------------------------------------------------------------------ static HTML snapshot */

const T = (l: Localized | undefined, tag = "span"): string => {
  const { th, en } = both(l);
  if (!th && !en) return "";
  if (th === en || !th) return `<${tag} lang="en">${esc(en)}</${tag}>`;
  if (!en) return `<${tag} lang="th">${esc(th)}</${tag}>`;
  return `<${tag} lang="th">${esc(th)}</${tag}> <${tag} lang="en">${esc(en)}</${tag}>`;
};
const P = (l: Localized | undefined) => {
  const { th, en } = both(l);
  const out: string[] = [];
  if (th) out.push(`<p lang="th">${esc(th)}</p>`);
  if (en && en !== th) out.push(`<p lang="en">${esc(en)}</p>`);
  return out.join("");
};
const A = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`;

/** Full content as semantic HTML. Shown until React mounts and to crawlers that don't run JS. */
export function buildSnapshot(c: Content): string {
  const base = siteUrl(c);
  const p = c.profile;
  const co = c.company;
  const frames = timelineFrames(c);
  const out: string[] = [];
  out.push(`<div class="seo-static">`);
  out.push(`<header><p class="seo-handle">${esc(p.handle)}</p><h1>${esc(t(p.name, "en"))}${t(p.name, "th") ? ` <span lang="th">(${esc(t(p.name, "th"))})</span>` : ""}</h1>`);
  out.push(`<p>${T(p.role)}</p>${P(p.headline)}${P(p.bio)}${P(p.dream)}`);
  out.push(`<nav aria-label="Sections"><ul>${[["#film", "Timeline"], ["#utotech", "Utotech"], ["#projects", "Projects"], ["#skills", "Skills"], ["#diary", "Co-op diary"], ["#contact", "Contact"]].map(([h, l]) => `<li>${A(h!, l!)}</li>`).join("")}</ul></nav></header>`);

  out.push(`<main>`);
  // Timeline
  out.push(`<section id="film"><h2>Timeline · ไทม์ไลน์</h2><ol>`);
  for (const f of frames) {
    out.push(`<li><article><h3>${T(f.title)}</h3><p><time datetime="${esc(f.date)}">${esc(frameDateLabel(f))}</time></p>${P(f.summary)}${P(f.body)}`);
    if (f.tags.length) out.push(`<p>Tags: ${esc(f.tags.join(", "))}</p>`);
    if (f.links.length) out.push(`<ul>${f.links.map((l) => `<li>${A(abs(c, l.url), l.label || l.url)}</li>`).join("")}</ul>`);
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
      out.push(`<article><h4>${x.url ? A(x.url, x.name) : esc(x.name)}</h4><p>${esc(x.category)} · ${T(x.summary)}</p>${P(x.description)}`);
      if (x.features.length) out.push(`<ul>${x.features.map((f) => `<li><strong>${T(f.title)}</strong>: ${T(f.description)}</li>`).join("")}</ul>`);
      out.push(`</article>`);
    }
  }
  if (co.customers.length) out.push(`<h3>Customers · ลูกค้า</h3><ul>${co.customers.map((x) => `<li>${x.url ? A(x.url, x.name) : esc(x.name)}</li>`).join("")}</ul>`);
  const ct = co.contact;
  out.push(`<h3>Contact · ติดต่อ</h3><address>`);
  if (ct.email) out.push(`<p>Email: ${A(`mailto:${ct.email}`, ct.email)}</p>`);
  if (ct.ceoEmail) out.push(`<p>CEO: ${A(`mailto:${ct.ceoEmail}`, ct.ceoEmail)}</p>`);
  if (ct.phone) out.push(`<p>Phone: ${A(`tel:${ct.phone.replace(/[^+\d]/g, "")}`, ct.phone)}</p>`);
  if (ct.officeAddress.en || ct.officeAddress.th) out.push(`<p>Office: ${T(ct.officeAddress)}</p>`);
  if (ct.registeredAddress.en || ct.registeredAddress.th) out.push(`<p>Registered: ${T(ct.registeredAddress)}</p>`);
  if (ct.taxId) out.push(`<p>Tax ID: ${esc(ct.taxId)}</p>`);
  out.push(`</address>`);
  if (co.links.length) out.push(`<ul>${co.links.map((l) => `<li>${A(abs(c, l.url), l.label || l.url)}</li>`).join("")}</ul>`);
  out.push(`</section>`);

  // Personal projects
  const projects = c.projects.filter((x) => x.published);
  if (projects.length) {
    out.push(`<section id="projects"><h2>Projects · โปรเจกต์</h2><ul>`);
    for (const x of projects) {
      const links = [x.repo && A(x.repo, "source"), x.url && A(x.url, "demo")].filter(Boolean).join(" · ");
      out.push(`<li><strong>${esc(x.name)}</strong>${x.year ? ` (${esc(x.year)})` : ""}: ${T(x.description)}${x.tags.length ? ` [${esc(x.tags.join(", "))}]` : ""}${links ? ` ${links}` : ""}</li>`);
    }
    out.push(`</ul></section>`);
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
  if (d.company.website) out.push(`<p>${A(d.company.website, d.company.website)}</p>`);
  if (d.duties.length) out.push(`<ul>${d.duties.map((x) => `<li><strong>${T(x.title)}</strong>: ${T(x.description)}</li>`).join("")}</ul>`);
  for (const e of d.entries) out.push(`<article><h4>${T(e.month)} · ${esc(e.period)}</h4><p>${T(e.title)}</p>${P(e.body)}</article>`);
  out.push(`</section>`);

  // Documents
  const docs = c.documents.filter((x) => x.url);
  if (docs.length) out.push(`<section id="documents"><h2>Documents · เอกสาร</h2><ul>${docs.map((x) => `<li>${A(abs(c, x.url), t(x.title, "en"))} ${T(x.description)}</li>`).join("")}</ul></section>`);
  out.push(`</main>`);

  // Contact
  out.push(`<footer id="contact"><h2>Contact · ติดต่อ</h2><ul>`);
  for (const l of p.links) out.push(`<li>${A(abs(c, l.url), l.label || l.url)}</li>`);
  if (p.email.visible && p.email.value) out.push(`<li>${A(`mailto:${p.email.value}`, p.email.value)}</li>`);
  if (p.phone.visible && p.phone.value) out.push(`<li>${A(`tel:${p.phone.value.replace(/[^+\d]/g, "")}`, p.phone.value)}</li>`);
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
  L.push(`- [English version](${base}/?lang=en)`);
  L.push("");
  L.push("## Timeline");
  for (const f of timelineFrames(c)) L.push(`- ${frameDateLong(f)} · ${t(f.title, "en")}: ${oneLine(t(f.summary, "en"))}`);
  L.push("");
  L.push(`## ${t(co.name, "en")}`);
  const web = co.links.find((l) => l.kind === "website");
  if (web) L.push(`- [${t(co.name, "en")} website](${web.url}): ${oneLine(t(co.about, "en"))}`);
  for (const s of co.services) L.push(`- Service · ${t(s.title, "en")}: ${t(s.subtitle, "en")} (${t(s.price, "en")})`);
  for (const x of co.projects.filter((y) => y.published)) {
    const label = `Project · ${x.name}`;
    L.push(x.url ? `- [${label}](${x.url}): ${t(x.summary, "en")}` : `- ${label}: ${t(x.summary, "en")}`);
  }
  if (co.contact.email) L.push(`- Contact: ${co.contact.email}${co.contact.phone ? `, ${co.contact.phone}` : ""}`);
  L.push("");
  L.push("## Projects");
  for (const x of c.projects.filter((y) => y.published)) {
    const href = x.url || x.repo;
    L.push(href ? `- [${x.name}](${href}): ${oneLine(t(x.description, "en"))}` : `- ${x.name}: ${oneLine(t(x.description, "en"))}`);
  }
  L.push("");
  L.push("## Optional");
  L.push(`- [Co-op diary at ${t(c.diary.company.name, "en")}](${base}/#diary): monthly notes, May to October 2023`);
  for (const l of p.links) L.push(`- [${l.label || l.kind}](${l.url})`);
  L.push("");
  return L.join("\n");
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
  para(`Source: ${base}/ · Last updated: ${c.updatedAt || "unknown"} · Languages: Thai and English. AI crawlers and assistants are welcome to read and cite this content.`);
  h(2, "Profile");
  para(md(p.headline));
  para(md(p.bio));
  para(md(p.dream));
  if (p.education.length) para(p.education.map((e) => `- Education: ${t(e.school, "en")} · ${t(e.program, "en")}${e.period ? ` (${e.period})` : ""}`).join("\n"));
  para(p.links.map((l) => `- ${l.label || l.kind}: ${l.url}`).join("\n"));
  if (p.email.visible && p.email.value) para(`- Email: ${p.email.value}`);

  h(2, "Timeline");
  for (const f of timelineFrames(c)) {
    h(3, `${frameDateLong(f)} · ${t(f.title, "en")}${t(f.title, "th") && t(f.title, "th") !== t(f.title, "en") ? ` · ${t(f.title, "th")}` : ""}`);
    para(md(f.summary));
    para(md(f.body));
    if (f.tags.length) para(`Tags: ${f.tags.join(", ")}`);
    if (f.links.length) para(f.links.map((l) => `- ${l.label || l.kind}: ${abs(c, l.url)}`).join("\n"));
  }

  h(2, `${t(co.name, "en")} · ${t(co.name, "th")}`);
  para(`${t(p.name, "en")} is ${t(co.role, "en")} of ${t(co.name, "en")}.`);
  para(
    [
      co.tagline.en && `- Tagline: ${t(co.tagline, "en")}`,
      co.slogan.en && `- Slogan: ${t(co.slogan, "en")}`,
      co.founded && `- Founded: ${co.founded}${t(co.foundedNote, "en") ? ` (${t(co.foundedNote, "en")})` : ""}`,
      co.teamSize && `- Team size: ${co.teamSize}`,
      co.links.length && `- Links: ${co.links.map((l) => l.url).join(", ")}`,
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
    h(3, "Client projects");
    for (const x of ups) {
      h(4, `${x.name} (${x.category})`);
      para(md(x.summary));
      para(md(x.description));
      if (x.url) para(`Demo: ${x.url}`);
      if (x.features.length) para(x.features.map((f) => `- ${t(f.title, "en")}: ${oneLine(t(f.description, "en"))}`).join("\n"));
    }
  }
  if (co.customers.length) {
    h(3, "Customers");
    para(co.customers.map((x) => `- ${x.name}${x.url ? ` (${x.url})` : ""}`).join("\n"));
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

  h(2, "Personal projects");
  for (const x of c.projects.filter((y) => y.published)) {
    h(3, `${x.name}${x.year ? ` (${x.year})` : ""}`);
    para(md(x.description));
    para([x.tags.length && `Tags: ${x.tags.join(", ")}`, x.repo && `Source: ${x.repo}`, x.url && `Demo: ${x.url}`].filter(Boolean).join("\n"));
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
      d.company.website && `- Website: ${d.company.website}`,
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

  const docs = c.documents.filter((x) => x.url);
  if (docs.length) {
    h(2, "Documents");
    para(docs.map((x) => `- ${t(x.title, "en")}: ${abs(c, x.url)}`).join("\n"));
  }
  return L.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/* ------------------------------------------------------------------ HTML injection */

const STRIP = [
  /\s*<title>[\s\S]*?<\/title>/gi,
  /\s*<meta\s+(?:name|property)="(?:description|author|keywords|robots|googlebot|og:[^"]*|twitter:[^"]*|profile:[^"]*)"[^>]*>/gi,
  /\s*<link\s+rel="(?:canonical|sitemap)"[^>]*>/gi,
  /\s*<link\s+rel="alternate"[^>]*>/gi,
  /\s*<script\s+type="application\/ld\+json"[\s\S]*?<\/script>/gi,
  /\s*<style data-seo>[\s\S]*?<\/style>/gi,
];
const SNAP_START = "<!--seo-snapshot-->";
const SNAP_END = "<!--/seo-snapshot-->";

/** Replace head SEO tags and put the static snapshot inside <div id="root">. */
export function injectIntoHtml(html: string, c: Content): string {
  let out = html;
  for (const re of STRIP) out = out.replace(re, "");
  const head = `    ${buildHead(c)}\n    <style data-seo>${SNAPSHOT_CSS}</style>\n  </head>`;
  if (!/<\/head>/i.test(out)) throw new Error("index.html has no </head>");
  out = out.replace(/<\/head>/i, head);
  const snap = `${SNAP_START}${buildSnapshot(c)}${SNAP_END}`;
  const prev = out.indexOf(SNAP_START);
  if (prev !== -1) {
    // Already injected (re-run): swap the old snapshot for the new one.
    const end = out.indexOf(SNAP_END, prev);
    if (end === -1) throw new Error("index.html has a broken SEO snapshot marker");
    out = out.slice(0, prev) + snap + out.slice(end + SNAP_END.length);
  } else {
    const rootRe = /<div id="root">\s*<\/div>/i;
    if (!rootRe.test(out)) throw new Error('index.html has no empty <div id="root"></div>');
    out = out.replace(rootRe, `<div id="root">${snap}</div>`);
  }
  out = out.replace(/<html lang="[^"]*"/i, `<html lang="${c.site.defaultLang}"`);
  return out;
}
