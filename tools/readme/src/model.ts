import {
  absoluteUrl,
  frameDateLong,
  isSafeUrl,
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
  client: "Client",
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

/** The company's short name ("Utotech"), for labels such as "Utotech projects". */
export function companyLabel(content: Content): string {
  return content.company.shortName.trim() || en(content.company.name) || "Company";
}

/**
 * Hero chips in a fixed priority order: the company and content numbers first, GitHub numbers
 * last. The card shows them in this order and leaves out whatever does not fit (see heroChips).
 * Each number is labelled for what it counts:
 *   "<Company> projects"  published company.projects (the company's own project list)
 *   "Client projects"     published projects in the "client" group
 *   "Customers", "Team"   the company's customers and team size
 *   "Own projects"        every other published project (personal, school, teaching…)
 */
export function heroStats(content: Content, gh: GithubStats | null): Stat[] {
  const stats: Stat[] = [];
  const company = companyLabel(content);
  const companyWork = content.company.projects.filter((p) => p.published).length;
  const client = clientProjects(content).length;
  const customers = content.company.customers.length;
  const teamSize = content.company.teamSize.trim();
  const own = ownProjects(content).length;
  const since = content.profile.codingSince;
  if (companyWork) stats.push({ value: String(companyWork), label: `${company} projects`, alt: `${companyWork} ${company} projects` });
  if (client) stats.push({ value: String(client), label: "Client projects", alt: `${client} client projects` });
  if (customers) stats.push({ value: String(customers), label: "Customers", alt: `${customers} ${company} customers` });
  if (teamSize) stats.push({ value: teamSize, label: "Team", alt: `a team of ${teamSize} at ${company}` });
  if (own) stats.push({ value: String(own), label: "Own projects", alt: `${own} own projects` });
  if (since) stats.push({ value: String(since), label: "Coding since", alt: `coding since ${since}` });
  if (gh) {
    stats.push({ value: String(gh.stars), label: "Stars", alt: `${gh.stars} GitHub stars` });
    stats.push({ value: String(gh.followers), label: "Followers", alt: `${gh.followers} GitHub followers` });
    stats.push({ value: String(gh.publicRepos), label: "Repos", alt: `${gh.publicRepos} public repos` });
  }
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
    if (!url || !isSafeUrl(url) || seen.has(key)) return;
    seen.add(key);
    const company = isCompanyUrl(content, url);
    items.push({ id: linkId("btn", label, used), label, url, kind, company });
  };
  add("Portfolio", linkHref(content, content.site.url), "website");
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
  const push = (key: string, item: Omit<LinkItem, "id">) => {
    if (isSafeUrl(item.url)) out.push({ id: linkId("link", key, used), ...item });
  };
  if (email.visible && email.value) push("email", { label: email.value, url: `mailto:${email.value.trim()}`, kind: "email" });
  const tel = phone.value.replace(/[^+\d]/g, "");
  if (phone.visible && phone.value && tel) push("phone", { label: phone.value, url: `tel:${tel}`, kind: "phone" });
  const site = linkHref(content, content.site.url);
  if (site) push("site", { label: hostOf(site), url: site, kind: "website" });
  const companySite = content.company.links.find((l) => l.kind === "website");
  const url = companySite ? linkHref(content, companySite.url) : "";
  if (url) push("company", { label: hostOf(url), url, kind: "website", company: true });
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
      url: linkHref(content, p.url) || sectionUrl(content, "utotech"),
      about: en(p.summary),
      extras: [],
      badge: { segments, stars: null },
    };
  });
}

/** Published projects done for clients (group "client"; often under NDA, so text only). */
export function clientProjects(content: Content): Project[] {
  return content.projects.filter((p) => p.published && p.group === "client");
}

/** Published projects of my own (every group except "client"). */
export function ownProjects(content: Content): Project[] {
  return content.projects.filter((p) => p.published && p.group !== "client");
}

/** Rows for client projects from the projects list: text only, every badge says "Client". */
export function clientProjectRows(content: Content): TableRow[] {
  return byFeatured(clientProjects(content)).map((p) => {
    return {
      id: `client-${p.id}`,
      name: p.name,
      url: linkHref(content, p.url) || linkHref(content, p.repo) || sectionUrl(content, "projects"),
      about: [en(p.description), p.tags.join(", ")].filter(Boolean).join(" · "),
      extras: [],
      badge: {
        segments: [{ text: "Client", tone: "accent" as const }, ...(p.year ? [{ text: p.year, tone: "led" as const }] : [])],
        stars: null,
      },
    };
  });
}

/** First `max` rows and how many were left out (so the README can say so). */
export function capRows<T>(rows: T[], max: number): { shown: T[]; more: number } {
  const limit = Math.max(1, Math.floor(max));
  return { shown: rows.slice(0, limit), more: Math.max(0, rows.length - limit) };
}

export function projectRows(content: Content, gh: GithubStats | null): TableRow[] {
  const list = ownProjects(content);
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
    const main = linkHref(content, p.repo) || linkHref(content, p.url) || sectionUrl(content, "projects");
    const extras: TableRow["extras"] = [];
    const demo = linkHref(content, p.url);
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

/**
 * Content URLs may be site-relative (/media/…, /docs/…); links in the README must be absolute.
 * Returns "" for anything that is not a safe link (javascript:, data:, protocol-relative…), both
 * before and after making it absolute, so callers fall back to the site section or plain text.
 */
export function linkHref(content: Content, url: string): string {
  const raw = url.trim();
  if (!raw || !isSafeUrl(raw)) return "";
  const abs = absoluteUrl(raw, content.site.url);
  return isSafeUrl(abs) ? abs : "";
}
