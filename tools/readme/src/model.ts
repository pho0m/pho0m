import {
  absoluteUrl,
  frameDateLong,
  slugify,
  t,
  timelineFrames,
  type CompanyProject,
  type Content,
  type Frame,
  type Link,
  type Project,
  type SkillGroup,
} from "@pho0m/content";

/**
 * Everything the cards and the README need, derived from Content in English.
 * Only facts from the content (and real GitHub numbers when available) end up here.
 */

export type GithubStats = {
  login: string;
  publicRepos: number;
  followers: number;
  /** Sum of stargazers over the user's own (non-fork) repos. */
  stars: number;
  /** lower-case repo name → stars */
  repoStars: Record<string, number>;
};

/** A hero chip: big LED value + short label; `alt` is the same fact as a phrase for alt text. */
export type Stat = { value: string; label: string; alt: string };
export type LinkItem = { id: string; label: string; url: string; kind: Link["kind"]; company?: boolean };
export type FilmFrame = { frame: Frame; number: number; title: string; date: string };
export type TableRow = {
  id: string;
  name: string;
  url: string;
  about: string;
  extras: { label: string; url: string }[];
  badge: { segments: BadgeSegment[]; stars: number | null };
};
export type BadgeSegment = { text: string; tone: "led" | "text" | "accent" };

export const GROUP_LABEL: Record<Project["group"], string> = {
  utotech: "Utotech",
  personal: "Personal",
  teaching: "Teaching",
  school: "School",
  coop: "Co-op",
};

export const SECTIONS = ["top", "film", "utotech", "projects", "skills", "diary", "documents", "contact"] as const;
export type SectionId = (typeof SECTIONS)[number];

export function sectionUrl(content: Content, id: SectionId): string {
  return `${content.site.url.replace(/\/+$/, "")}/#${id}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const en = (v: Parameters<typeof t>[0]) => t(v, "en").trim();

/** Latest `count` published frames, oldest first, numbered by their place on the whole roll. */
export function latestFrames(content: Content, count = 5): FilmFrame[] {
  const frames = timelineFrames(content);
  return frames.slice(-count).map((frame, i) => ({
    frame,
    number: frames.length - Math.min(count, frames.length) + i + 1,
    title: en(frame.title),
    date: frameDateLong(frame),
  }));
}

export function heroStats(content: Content, gh: GithubStats | null): Stat[] {
  const stats: Stat[] = [];
  if (gh) {
    stats.push({ value: String(gh.stars), label: "Stars", alt: `${gh.stars} GitHub stars` });
    stats.push({ value: String(gh.publicRepos), label: "Repos", alt: `${gh.publicRepos} public repos` });
    stats.push({ value: String(gh.followers), label: "Followers", alt: `${gh.followers} followers` });
  }
  const own = content.projects.filter((p) => p.published).length;
  const client = content.company.projects.filter((p) => p.published).length;
  const customers = content.company.customers.length;
  const { teamSize } = content.company;
  const since = content.profile.codingSince;
  if (own) stats.push({ value: String(own), label: "Projects", alt: `${own} projects` });
  if (client) stats.push({ value: String(client), label: "Client works", alt: `${client} client projects` });
  if (customers) stats.push({ value: String(customers), label: "Customers", alt: `${customers} customers` });
  if (teamSize) stats.push({ value: teamSize, label: "Team", alt: `a team of ${teamSize}` });
  if (since) stats.push({ value: String(since), label: "Coding since", alt: `coding since ${since}` });
  return stats;
}

/** Is this link the company's own website? */
function isCompanyUrl(content: Content, url: string): boolean {
  const companyHosts = content.company.links.filter((l) => l.kind === "website").map((l) => hostOf(l.url));
  return companyHosts.includes(hostOf(url));
}

const linkId = (prefix: string, label: string, used: Set<string>) => {
  let id = `${prefix}-${slugify(label)}`;
  for (let i = 2; used.has(id); i++) id = `${prefix}-${slugify(label)}-${i}`;
  used.add(id);
  return id;
};

/** Pill buttons under the hero: the portfolio site, every profile link, and Utotech. */
export function profileButtons(content: Content): LinkItem[] {
  const used = new Set<string>();
  const items: LinkItem[] = [];
  const seen = new Set<string>();
  const add = (label: string, url: string, kind: Link["kind"]) => {
    const key = url.replace(/\/+$/, "").toLowerCase();
    if (!url || seen.has(key)) return;
    seen.add(key);
    const company = isCompanyUrl(content, url);
    items.push({ id: linkId("btn", label, used), label, url, kind, company });
  };
  add("Portfolio", content.site.url, "website");
  for (const l of content.profile.links) add(l.label || hostOf(l.url), linkHref(content, l.url), l.kind);
  const companySite = content.company.links.find((l) => l.kind === "website");
  if (companySite) add(content.company.shortName || en(content.company.name), linkHref(content, companySite.url), "website");
  return items;
}

/** Footer buttons: ways to reach the owner, labelled with the address itself. */
export function footerLinks(content: Content): LinkItem[] {
  const used = new Set<string>();
  const out: LinkItem[] = [];
  const { email, phone } = content.profile;
  if (email.visible && email.value) out.push({ id: linkId("link", "email", used), label: email.value, url: `mailto:${email.value}`, kind: "email" });
  if (phone.visible && phone.value) out.push({ id: linkId("link", "phone", used), label: phone.value, url: `tel:${phone.value.replace(/[^+\d]/g, "")}`, kind: "phone" });
  out.push({ id: linkId("link", "site", used), label: hostOf(content.site.url), url: content.site.url, kind: "website" });
  const companySite = content.company.links.find((l) => l.kind === "website");
  if (companySite) {
    const url = linkHref(content, companySite.url);
    out.push({ id: linkId("link", "company", used), label: hostOf(url), url, kind: "website", company: true });
  }
  return out;
}

function repoName(repoUrl: string, login: string | undefined): string | null {
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)/i.exec(repoUrl);
  if (!m || !login || m[1]!.toLowerCase() !== login.toLowerCase()) return null;
  return m[2]!.replace(/\.git$/, "").toLowerCase();
}

const byFeatured = <T extends { featured: boolean }>(list: T[]) =>
  list
    .map((item, i) => ({ item, i }))
    .sort((a, b) => Number(b.item.featured) - Number(a.item.featured) || a.i - b.i)
    .map(({ item }) => item);

/** "Platform / Web Application" → ["Platform", "Web app"] (badge text only; the table keeps the full words). */
export function categoryParts(category: string): string[] {
  return category
    .split("/")
    .map((part) => part.trim().replace(/\bapplications?\b/i, "app"))
    .filter(Boolean);
}

export function companyRows(content: Content): TableRow[] {
  return byFeatured(content.company.projects.filter((p: CompanyProject) => p.published)).map((p) => {
    const segments: BadgeSegment[] = [];
    if (p.featured) segments.push({ text: "Featured", tone: "accent" });
    for (const part of categoryParts(p.category)) segments.push({ text: part, tone: "text" });
    if (!segments.length) segments.push({ text: content.company.shortName || "Client", tone: "text" });
    return {
      id: `utotech-${p.id}`,
      name: p.name,
      url: p.url ? linkHref(content, p.url) : sectionUrl(content, "utotech"),
      about: en(p.summary),
      extras: [],
      badge: { segments, stars: null },
    };
  });
}

export function projectRows(content: Content, gh: GithubStats | null): TableRow[] {
  const list = content.projects.filter((p) => p.published);
  const sorted = list
    .map((item, i) => ({ item, i }))
    .sort(
      (a, b) =>
        Number(b.item.featured) - Number(a.item.featured) ||
        (b.item.year || "").localeCompare(a.item.year || "") ||
        a.i - b.i,
    )
    .map(({ item }) => item);
  return sorted.map((p) => {
    const repo = repoName(p.repo, gh?.login);
    const stars = repo && gh ? (gh.repoStars[repo] ?? null) : null;
    const main = p.repo || p.url ? linkHref(content, p.repo || p.url) : sectionUrl(content, "projects");
    const extras: TableRow["extras"] = [];
    const demo = p.url ? linkHref(content, p.url) : "";
    if (demo && demo !== main) extras.push({ label: "demo", url: demo });
    return {
      id: `project-${p.id}`,
      name: p.name,
      url: main,
      about: [en(p.description), p.tags.join(", ")].filter(Boolean).join(" · "),
      extras,
      badge: {
        segments: [
          ...(p.year ? [{ text: p.year, tone: "led" as const }] : []),
          { text: GROUP_LABEL[p.group], tone: "text" as const },
        ],
        stars,
      },
    };
  });
}

/** Skill groups, most confident first (stable for equal levels). */
export function skillGroups(content: Content): SkillGroup[] {
  return content.skills
    .map((g, i) => ({ g, i }))
    .sort((a, b) => b.g.level - a.g.level || a.i - b.i)
    .map(({ g }) => g);
}

export function visibleDocuments(content: Content) {
  return content.documents.filter((d) => d.url.trim());
}

/** Content URLs may be site-relative (/media/…, /docs/…); links in the README must be absolute. */
export function linkHref(content: Content, url: string): string {
  return absoluteUrl(url.trim(), content.site.url);
}
