import { timelineFrames, type Content, type IconName } from "@pho0m/content";
import { GIF_BUDGET, filmGif } from "./gif/film.ts";
import { bitsDataUri, grayDataUri, portraitPrints } from "./image/print.ts";
import type { MediaLoader } from "./media.ts";
import {
  GROUP_LABEL,
  capRows,
  clientProjectRows,
  clientProjects,
  companyRows,
  en,
  footerLinks,
  heroStats,
  hostOf,
  latestFrames,
  linkHref,
  ownProjects,
  profileButtons,
  projectRows,
  sectionUrl,
  skillGroups,
  visibleDocuments,
  type GithubStats,
  type TableRow,
} from "./model.ts";
import { filmPrint, frameSources, gifPrint } from "./prints.ts";
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
  /** Path of the asset folder as seen from README.md, e.g. "assets/readme". */
  assetPath: string;
  /** Rows per project table before the README links to the site for the rest (default 12). */
  maxRows?: number;
  warn?: (message: string) => void;
};

export type Output = {
  /** file name → SVG source */
  files: Map<string, string>;
  /** file name → binary asset (the film GIF) */
  binaries: Map<string, Uint8Array>;
  readme: string;
};

/** Every file this tool writes into its output folder matches this (used to clean up stale ones). */
export const GENERATED_FILE = /^(?:(hero|btn|band|film|utotech|badge|skills|panel|roll|link)(-[a-z0-9-]+)?-(dark|light)\.svg|film(-[a-z0-9-]+)?\.gif)$/;

export const MAX_TABLE_ROWS = 12;
/** Frames in the film card's loop (the newest 5 show when it is still). */
export const FILM_CARD_FRAMES = 8;
/** Frames in the GIF. */
export const FILM_GIF_FRAMES = 5;

const MAX_RAW_AVATAR = 100_000;
const MAX_LOGO = 150_000;
/** Every SVG card stays under this size (GitHub's image proxy and page weight). */
export const SVG_BUDGET = 240 * 1024;
/** Avatar print: 88 dither cells (drawn 2 px each); the clear print at 2x the 176 px it is shown at, smaller if the card gets too big. */
const AVATAR_CELLS = 88;
const AVATAR_CLEAR = [352, 264, 176];
const AVATAR_DEV_LEVELS = [0.35, 0.7, 1];

async function avatarImage(input: GenerateInput, warn: (m: string) => void, clearSize: number): Promise<AvatarImage> {
  const url = input.content.profile.avatar?.url;
  if (!url) return null;
  const media = await input.media(url);
  if (!media) return null;
  const prints = portraitPrints(media.bytes, AVATAR_CELLS, clearSize, AVATAR_DEV_LEVELS);
  if (prints) {
    return {
      kind: "print",
      clear: grayDataUri(prints.clear, prints.clearSize, prints.clearSize),
      developing: prints.developing.map((bits) => bitsDataUri(bits, prints.cells, prints.cells, 4, FILM.paper, FILM.ink)),
    };
  }
  // Any other format the browser can show (WebP, AVIF…) is embedded as is; the duotone filter tones it.
  if (media.mime.startsWith("image/") && media.bytes.byteLength <= MAX_RAW_AVATAR) {
    return { kind: "raw", uri: `data:${media.mime};base64,${Buffer.from(media.bytes).toString("base64")}` };
  }
  warn(`[readme] avatar ${url} can't be decoded here and is over ${MAX_RAW_AVATAR / 1000} KB to embed as is; using a monogram`);
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

/** "a", "a and b", "a, b, and c" */
function andList(items: string[]): string {
  if (items.length < 2) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function bandText(content: Content) {
  const frames = timelineFrames(content);
  const first = frames[0];
  const last = frames[frames.length - 1];
  const c = content.company;
  const own = ownProjects(content);
  const client = c.projects.filter((p) => p.published).length;
  const clientMore = clientProjects(content).length;
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
    projects:
      andList(
        [
          client ? `${client} client projects at ${company}` : "",
          clientMore ? `${clientMore} more client works` : "",
          own.length ? `${own.length} of my own${groups.length ? ` (${groups.join(", ")})` : ""}` : "",
        ].filter(Boolean),
      ) + ".",
    skills: tiers.length ? `Rated on a ${tiers.length}-step scale: ${tiers.join(" · ")}.` : "Tools I use.",
  };
}

export async function generate(input: GenerateInput): Promise<Output> {
  const { content, github } = input;
  const warn = input.warn ?? ((m: string) => console.warn(m));
  const maxRows = input.maxRows ?? MAX_TABLE_ROWS;
  const files = new Map<string, string>();
  const binaries = new Map<string, Uint8Array>();
  const base = input.assetPath.replace(/\/+$/, "");
  const render = (name: string, draw: (t: Theme) => string) => {
    for (const theme of THEMES) files.set(`${name}-${theme.name}.svg`, draw(theme));
    return { dark: `${base}/${name}-dark.svg`, light: `${base}/${name}-light.svg` };
  };
  const [avatar, logo] = await Promise.all([avatarImage(input, warn, AVATAR_CLEAR[0]!), logoImage(input, warn)]);
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
  // a busy photo can make the clear print big: step its resolution down until the card fits
  for (const size of AVATAR_CLEAR.slice(1)) {
    if (!heroData.avatar || heroData.avatar.kind !== "print") break;
    if (THEMES.every((t) => Buffer.byteLength(heroCard(heroData, t)) <= SVG_BUDGET)) break;
    heroData.avatar = await avatarImage(input, () => {}, size);
  }
  md.push(linked(sectionUrl(content, "top"), picture({ ...render("hero", (t) => heroCard(heroData, t)), alt: heroAlt })));

  // pill buttons ------------------------------------------------------------------------------
  const buttons = profileButtons(content).map((b) =>
    linked(b.url, picture({ ...render(b.id, (t) => buttonCard(b, t, { style: "pill", logo })), alt: b.label, height: BUTTON_H })),
  );
  md.push(["<p>", ...buttons.map((b) => `  ${b}`), "</p>"].join("\n"));

  // film GIF banner ----------------------------------------------------------------------------
  const cardFrames = latestFrames(content, FILM_CARD_FRAMES);
  const sources = await Promise.all(cardFrames.map((f) => frameSources(content, f, input.media, warn)));
  const gifFrames = cardFrames.slice(-FILM_GIF_FRAMES);
  if (gifFrames.length) {
    const prints = gifFrames.map((f, i) => gifPrint(f, sources[cardFrames.length - gifFrames.length + i]!.gif));
    const gif = filmGif(prints, p.handle || "film");
    if (gif.bytes.byteLength > GIF_BUDGET) warn(`[readme] film.gif is ${Math.round(gif.bytes.byteLength / 1024)} KB, over the ${GIF_BUDGET / 1024} KB budget even at the lowest quality`);
    binaries.set("film.gif", gif.bytes);
    const gifAlt =
      `Animated film strip running to the right: the latest ${gifFrames.length} timeline frames, ` +
      `each flashed in the gate and developed from a dither into a clear print — ${[...gifFrames].reverse().map((f) => `${f.date}, ${f.title}`).join("; ")}.`;
    md.push(linked(sectionUrl(content, "film"), `<img src="${html(`${base}/film.gif`)}" alt="${html(gifAlt)}" width="100%">`));
  }

  // film --------------------------------------------------------------------------------------
  const bands = bandText(content);
  const band = (id: string, number: number, title: string, description: string, icon: IconName, section: Parameters<typeof sectionUrl>[1]) =>
    linked(
      sectionUrl(content, section),
      picture({ ...render(`band-${id}`, (t) => bandCard({ number, title, description, icon }, t)), alt: `${title} — ${description}` }),
    );
  md.push(band("film", 1, "Film", bands.film, "eye", "film"));
  if (cardFrames.length) {
    // photos go in at 2x for sharp screens, or at 1x when that would make the card too big
    const withPrints = (pick: "card" | "gif") => cardFrames.map((f, i) => ({ ...f, print: filmPrint(sources[i]![pick]) }));
    let prints = withPrints("card");
    if (THEMES.some((t) => Buffer.byteLength(filmCard(prints, p.handle || "film", t)) > SVG_BUDGET)) prints = withPrints("gif");
    const newestFirst = [...cardFrames].reverse();
    const filmAlt = `Film strip of the latest ${cardFrames.length} timeline frames, newest first: ${newestFirst.map((f) => `${f.date}, ${f.title}`).join("; ")}.`;
    md.push(linked(sectionUrl(content, "film"), picture({ ...render("film-latest", (t) => filmCard(prints, p.handle || "film", t)), alt: filmAlt })));
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
  const companyLink = c.links.find((l) => l.kind === "website")?.url;
  const companySite = companyLink ? linkHref(content, companyLink) : sectionUrl(content, "utotech");
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
  // Long lists are capped; the README says how many more there are and links to the site.
  const capped = (rows: TableRow[], noun: string, section: Parameters<typeof sectionUrl>[1]) => {
    const { shown, more } = capRows(rows, maxRows);
    const out = [table(shown)];
    if (more) out.push(`**+${more} more** ${noun} not listed here — [see all ${rows.length} on the site →](${linkUrl(sectionUrl(content, section))})`);
    return out;
  };
  const companyClientRows = companyRows(content);
  if (companyClientRows.length) md.push(`**Client work at ${html(companyShort)}**`, ...capped(companyClientRows, "client projects", "utotech"));
  const clientRows = clientProjectRows(content);
  if (clientRows.length) md.push("**Client projects** — work built for clients, described in text only.", ...capped(clientRows, "client projects", "projects"));
  const ownRows = projectRows(content, github);
  if (ownRows.length) md.push("**My own projects**", ...capped(ownRows, "projects", "projects"));

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
  return { files, binaries, readme };
}
