import { timelineFrames, type Content, type IconName } from "@pho0m/content";
import { portraitPrint, printDataUri } from "./image/print.ts";
import type { MediaLoader } from "./media.ts";
import {
  GROUP_LABEL,
  companyRows,
  en,
  footerLinks,
  heroStats,
  hostOf,
  latestFrames,
  profileButtons,
  projectRows,
  sectionUrl,
  skillGroups,
  visibleDocuments,
  type GithubStats,
  type TableRow,
} from "./model.ts";
import { WAKA_END, WAKA_START, cell, extractWaka, html, linkText, linkUrl, linked, picture } from "./readme.ts";
import { bandCard } from "./svg/band.ts";
import { badgeCard, badgeLabel, BADGE_H } from "./svg/badge.ts";
import { buttonCard, BUTTON_H } from "./svg/button.ts";
import { filmCard } from "./svg/film.ts";
import { bioWithoutEcho, heroCard, type AvatarImage } from "./svg/hero.ts";
import { panelCards } from "./svg/panels.ts";
import { rollEndCard } from "./svg/rollend.ts";
import { skillsCard } from "./svg/skills.ts";
import { FILM, THEMES, type Theme } from "./svg/theme.ts";
import { utotechCard } from "./svg/utotech.ts";

export type GenerateInput = {
  content: Content;
  github: GithubStats | null;
  media: MediaLoader;
  /** Current README.md (for the WakaTime block), or null when there is none. */
  currentReadme: string | null;
  /** Path of the SVG folder as seen from README.md, e.g. "assets/readme". */
  assetPath: string;
  warn?: (message: string) => void;
};

export type Output = {
  /** file name → SVG source */
  files: Map<string, string>;
  readme: string;
};

/** Every file this tool writes into its output folder matches this (used to clean up stale ones). */
export const GENERATED_FILE = /^(hero|btn|band|film|utotech|badge|skills|panel|roll|link)(-[a-z0-9-]+)?-(dark|light)\.svg$/;

const MAX_RAW_AVATAR = 100_000;
const MAX_LOGO = 150_000;

async function avatarImage(input: GenerateInput, warn: (m: string) => void): Promise<AvatarImage> {
  const url = input.content.profile.avatar?.url;
  if (!url) return null;
  const media = await input.media(url);
  if (!media) return null;
  const print = portraitPrint(media.bytes, 88);
  if (print) return { kind: "print", uri: printDataUri(print, 4, FILM.paper, FILM.ink) };
  if (media.mime.startsWith("image/") && media.bytes.byteLength <= MAX_RAW_AVATAR) {
    return { kind: "raw", uri: `data:${media.mime};base64,${Buffer.from(media.bytes).toString("base64")}` };
  }
  warn(`[readme] avatar ${url} is not a baseline JPEG/PNG and is too large to embed; using a monogram`);
  return null;
}

async function logoImage(input: GenerateInput, warn: (m: string) => void): Promise<string | null> {
  const url = input.content.company.logo?.url;
  if (!url) return null;
  const media = await input.media(url);
  if (!media || !media.mime.startsWith("image/")) return null;
  if (media.bytes.byteLength > MAX_LOGO) {
    warn(`[readme] company logo ${url} is larger than ${MAX_LOGO / 1000} KB; using a monogram`);
    return null;
  }
  return `data:${media.mime};base64,${Buffer.from(media.bytes).toString("base64")}`;
}

function bandText(content: Content) {
  const frames = timelineFrames(content);
  const first = frames[0];
  const last = frames[frames.length - 1];
  const c = content.company;
  const own = content.projects.filter((p) => p.published);
  const client = c.projects.filter((p) => p.published).length;
  const groups = [...new Set(own.map((p) => GROUP_LABEL[p.group].toLowerCase()))];
  const tiers = skillGroups(content)
    .filter((g, i, all) => all.findIndex((x) => x.level === g.level) === i)
    .map((g) => en(g.title));
  const company = c.shortName || en(c.name);
  return {
    film:
      first && last
        ? `${frames.length} frames on one roll, from ${first.date.slice(0, 4)} to ${last.dateLabel.trim() || last.date.slice(0, 4)}. On the site the film runs to the right as you scroll.`
        : "The timeline, frame by frame.",
    utotech: [en(c.tagline) + (c.founded ? `, founded in ${c.founded}` : ""), en(c.role) ? `My role: ${en(c.role)}.` : ""]
      .filter(Boolean)
      .join(". ")
      .replace(/\.\./g, "."),
    projects: `${client} client projects at ${company}, and ${own.length} of my own${groups.length ? ` (${groups.join(", ")})` : ""}.`,
    skills: tiers.length ? `Rated on a ${tiers.length}-step scale: ${tiers.join(" · ")}.` : "Tools I use.",
  };
}

export async function generate(input: GenerateInput): Promise<Output> {
  const { content, github } = input;
  const warn = input.warn ?? ((m: string) => console.warn(m));
  const files = new Map<string, string>();
  const base = input.assetPath.replace(/\/+$/, "");
  const render = (name: string, draw: (t: Theme) => string) => {
    for (const theme of THEMES) files.set(`${name}-${theme.name}.svg`, draw(theme));
    return { dark: `${base}/${name}-dark.svg`, light: `${base}/${name}-light.svg` };
  };
  const [avatar, logo] = await Promise.all([avatarImage(input, warn), logoImage(input, warn)]);
  const p = content.profile;
  const c = content.company;
  const site = content.site.url;
  const md: string[] = [];

  md.push(
    "<!-- Generated by tools/readme (`npm run readme`) from the portfolio content. Edit the content, not this file. The WakaTime block is kept as is. -->",
  );

  // hero ------------------------------------------------------------------------------------
  const name = en(p.name) || p.nickname || p.handle;
  const stats = heroStats(content, github);
  const heroData = {
    name,
    handle: p.handle,
    location: en(p.location),
    role: en(p.role),
    headline: en(p.headline),
    bio: en(p.bio),
    stats,
    avatar,
    avatarInitial: (p.nickname || name).slice(0, 1).toUpperCase(),
  };
  const sentence = (s: string) => (s && !/[.!?]$/.test(s) ? `${s}.` : s);
  const heroAlt = [
    sentence(`${name}${p.handle ? ` (${p.handle})` : ""} — ${heroData.role}`),
    sentence(heroData.headline),
    sentence(bioWithoutEcho(heroData.bio, heroData.headline)),
    stats.length ? sentence(stats.map((s) => s.alt).join(", ")) : "",
  ]
    .filter(Boolean)
    .join(" ");
  md.push(linked(sectionUrl(content, "top"), picture({ ...render("hero", (t) => heroCard(heroData, t)), alt: heroAlt })));

  // pill buttons ------------------------------------------------------------------------------
  const buttons = profileButtons(content).map((b) =>
    linked(b.url, picture({ ...render(b.id, (t) => buttonCard(b, t, { style: "pill", logo })), alt: b.label, height: BUTTON_H })),
  );
  md.push(["<p>", ...buttons.map((b) => `  ${b}`), "</p>"].join("\n"));

  // film --------------------------------------------------------------------------------------
  const bands = bandText(content);
  const band = (id: string, number: number, title: string, description: string, icon: IconName, section: Parameters<typeof sectionUrl>[1]) =>
    linked(
      sectionUrl(content, section),
      picture({ ...render(`band-${id}`, (t) => bandCard({ number, title, description, icon }, t)), alt: `${title} — ${description}` }),
    );
  md.push(band("film", 1, "Film", bands.film, "eye", "film"));
  const frames = latestFrames(content, 5);
  if (frames.length) {
    const filmAlt = `Film strip of the latest ${frames.length} timeline frames: ${frames.map((f) => `${f.date}, ${f.title}`).join("; ")}.`;
    md.push(linked(sectionUrl(content, "film"), picture({ ...render("film-latest", (t) => filmCard(frames, p.handle || "film", t)), alt: filmAlt })));
  }

  // utotech -----------------------------------------------------------------------------------
  const companyName = en(c.name);
  const companyShort = c.shortName || companyName;
  md.push(band("utotech", 2, companyShort, bands.utotech, "brief", "utotech"));
  const publishedClient = c.projects.filter((x) => x.published).length;
  const utoData = {
    name: companyName,
    shortName: companyShort,
    tagline: en(c.tagline),
    slogan: en(c.slogan),
    role: en(c.role),
    logo,
    stats: [
      { label: "Founded", value: c.founded },
      { label: "Team", value: c.teamSize },
      { label: "Projects", value: publishedClient ? String(publishedClient) : "" },
      { label: "Customers", value: c.customers.length ? String(c.customers.length) : "" },
    ].filter((s) => s.value),
    customers: c.customers.map((x) => x.name),
    services: c.services.map((s) => ({ title: en(s.title), subtitle: en(s.subtitle), price: en(s.price) })),
  };
  const utoAlt = [
    sentence(`${companyName} — ${utoData.tagline}`),
    utoData.stats.map((s) => `${s.label}: ${s.value}`).join(", ") + ".",
    utoData.services.length ? `Services: ${utoData.services.map((s) => `${s.title} (${s.price})`).join("; ")}.` : "",
    utoData.customers.length ? `Customers include ${utoData.customers.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const companySite = c.links.find((l) => l.kind === "website")?.url || sectionUrl(content, "utotech");
  md.push(linked(companySite, picture({ ...render("utotech", (t) => utotechCard(utoData, t)), alt: utoAlt })));

  // projects ----------------------------------------------------------------------------------
  md.push(band("projects", 3, "Projects", bands.projects, "code", "projects"));
  // Two columns on purpose: GitHub tables shrink images in a narrow third column to nothing,
  // so each badge sits on its own line at the top of the wide "About" cell.
  const table = (rows: TableRow[]) => {
    const lines = ["| Project | About |", "| :-- | :-- |"];
    for (const r of rows) {
      const nameCell = `**[${linkText(r.name)}](${linkUrl(r.url)})**`;
      const about = [cell(r.about), ...r.extras.map((e) => `[${linkText(e.label)}](${linkUrl(e.url)})`)].filter(Boolean).join(" · ");
      const badge = picture({ ...render(`badge-${r.id}`, (t) => badgeCard(r.badge, t)), alt: badgeLabel(r.badge), height: BADGE_H });
      lines.push(`| ${nameCell} | ${badge}<br>${about} |`);
    }
    return lines.join("\n");
  };
  const clientRows = companyRows(content);
  if (clientRows.length) md.push(`**Client work at ${html(companyShort)}**`, table(clientRows));
  const ownRows = projectRows(content, github);
  if (ownRows.length) md.push("**My own projects**", table(ownRows));

  // skills ------------------------------------------------------------------------------------
  md.push(band("skills", 4, "Skills", bands.skills, "star", "skills"));
  for (const g of skillGroups(content)) {
    const alt = `${en(g.title)} (level ${g.level} of 3): ${g.items.map((i) => i.name).join(", ")}`;
    md.push(picture({ ...render(`skills-${g.id}`, (t) => skillsCard(g, t)), alt }));
  }

  // panels ------------------------------------------------------------------------------------
  const d = content.diary;
  const diaryData = {
    title: en(d.title),
    intro: en(d.intro),
    entries: d.entries.map((e) => ({ month: en(e.month).slice(0, 3).toUpperCase(), title: en(e.title) })),
    footer: [en(d.company.name), d.company.website ? hostOf(d.company.website) : ""].filter(Boolean).join(" · ").toUpperCase(),
  };
  const contact: { label: string; value: string }[] = [];
  if (p.email.visible && p.email.value) contact.push({ label: "EMAIL", value: p.email.value });
  if (p.phone.visible && p.phone.value) contact.push({ label: "PHONE", value: p.phone.value });
  if (en(p.location)) contact.push({ label: "BASE", value: en(p.location) });
  if (c.links.find((l) => l.kind === "website")) contact.push({ label: "WORK", value: hostOf(companySite) });
  contact.push({ label: "SITE", value: hostOf(site) });
  const docsData = {
    title: "Documents & contact",
    documents: visibleDocuments(content).map((x) => ({ title: en(x.title), description: en(x.description) })),
    contact,
  };
  const panels = { dark: panelCards(diaryData, docsData, THEMES[0]), light: panelCards(diaryData, docsData, THEMES[1]) };
  const diaryRef = render("panel-diary", (t) => panels[t.name].diary);
  const docsRef = render("panel-docs", (t) => panels[t.name].docs);
  const diaryAlt = `${diaryData.title} — ${diaryData.intro} ${d.entries.map((e) => `${en(e.month)}: ${en(e.title)}`).join(" ")}`.trim();
  const docsAlt = `${docsData.title} — ${[...docsData.documents.map((x) => x.title), ...contact.map((x) => `${x.label.toLowerCase()} ${x.value}`)].join(", ")}`;
  md.push(
    [
      "<p>",
      `  ${linked(sectionUrl(content, "diary"), picture({ ...diaryRef, alt: diaryAlt, width: "49.5%" }))}`,
      `  ${linked(sectionUrl(content, "documents"), picture({ ...docsRef, alt: docsAlt, width: "49.5%" }))}`,
      "</p>",
    ].join("\n"),
  );

  // waka + footer -----------------------------------------------------------------------------
  const waka = extractWaka(input.currentReadme);
  md.push(["<details>", "<summary>Current languages (WakaTime)</summary>", "", waka, "", "</details>"].join("\n"));
  const total = timelineFrames(content).length;
  const endLabel = `END OF ROLL · ${total} FRAMES · ${(p.handle || "film").toUpperCase()} 400`;
  md.push(picture({ ...render("roll-end", (t) => rollEndCard(endLabel, t)), alt: "" }));
  const links = footerLinks(content).map((l) =>
    linked(l.url, picture({ ...render(l.id, (t) => buttonCard(l, t, { style: "link", logo })), alt: l.label, height: BUTTON_H })),
  );
  md.push(["<p>", ...links.map((l) => `  ${l}`), "</p>"].join("\n"));

  const readme = md.join("\n\n") + "\n";
  if (!readme.includes(WAKA_START) || !readme.includes(WAKA_END)) throw new Error("WakaTime markers were lost");
  return { files, readme };
}
