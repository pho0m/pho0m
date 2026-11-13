import {
  absoluteUrl,
  frameDateLong,
  isSafeUrl,
  slugify,
  t,
  timelineFrames,
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
};

/** A hero chip: big LED value + short label; `alt` is the same fact as a phrase for alt text. */
export type Stat = { value: string; label: string; alt: string };
export type LinkItem = { id: string; label: string; url: string; kind: Link["kind"]; company?: boolean };
export type FilmFrame = { frame: Frame; number: number; title: string; date: string };

/** Sections of the site the README links to. */
export const SECTIONS = ["top", "film", "skills", "diary", "documents"] as const;
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

/** Published projects done for clients (group "client"). The README only counts them (hero chips). */
export function clientProjects(content: Content): Project[] {
  return content.projects.filter((p) => p.published && p.group === "client");
}

/** Published projects of my own (every group except "client"). The README only counts them (hero chips). */
export function ownProjects(content: Content): Project[] {
  return content.projects.filter((p) => p.published && p.group !== "client");
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
