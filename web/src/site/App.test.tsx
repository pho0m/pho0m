import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { canvaEmbedUrl, SKILL_LEVEL_MAX, t, timelineFrames, type Project } from "@pho0m/content";
import { seed } from "@pho0m/content/seed";
import { LangProvider } from "../lib/i18n.tsx";
import { EMBEDDED_CONTENT_ID, initialContent } from "../lib/content.ts";
import { pageUrl } from "../seo/build.ts";
import { App } from "./App.tsx";
import { Projects } from "./sections/Projects.tsx";
import { groupLabel } from "./util.ts";

// Everything below is derived from content/seed.json: the seed grows (frames, projects,
// skills), so no test hard-codes a count, a name or which frame has a photo.
const lang = seed.site.defaultLang;

// jsdom has no 2D canvas; a stub is enough for the print/frame painters.
beforeAll(() => {
  const ctx = {
    putImageData() {},
    drawImage() {},
    fillRect() {},
    fillStyle: "",
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "high",
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4).fill(255),
    }),
  };
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
beforeEach(() => {
  localStorage.clear();
  // The language lives in the URL (/ or /en/): every test starts on the Thai page.
  history.replaceState(null, "", "/");
});
afterEach(cleanup);

describe("public site", () => {
  it("renders every section from the seed", () => {
    const { container } = render(<App initial={seed} />);
    for (const id of ["top", "film", "utotech", "projects", "skills", "diary", "contact"])
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(t(seed.profile.name, lang));
    // one film cell per published frame
    expect(container.querySelectorAll(".ff")).toHaveLength(timelineFrames(seed).length);
    // Canva documents play in place; other documents with a link are buttons under the player
    const canva = seed.documents.filter((d) => d.url && canvaEmbedUrl(d.url));
    expect(canva.length).toBeGreaterThan(0);
    const frames = [...container.querySelectorAll<HTMLIFrameElement>("#documents iframe")];
    expect(frames.map((f) => f.getAttribute("src"))).toEqual(canva.map((d) => canvaEmbedUrl(d.url)));
    for (const f of frames) expect(f.getAttribute("loading")).toBe("lazy");
    const others = seed.documents.filter((d) => d.url && !canvaEmbedUrl(d.url));
    expect(container.querySelectorAll("#documents .linkrow li")).toHaveLength(others.length);
  });

  it("leaves out the sections that were taken off the page", () => {
    const { container } = render(<App initial={seed} />);
    // headings only: the company's own about text may still say "ลูกค้าของเรา" in a sentence
    const text = [...container.querySelectorAll("h2, h3, h4, .sec-kicker")].map((h) => h.textContent).join("\n");
    for (const gone of ["ทำงานกับเรา", "บริการและราคา", "ผลงานของ Utotech", "ลูกค้าของเรา", "แกลเลอรี", "บันทึกรายเดือน", "ไฟล์และลิงก์"])
      expect(text, gone).not.toContain(gone);
    expect(container.querySelector(".entry, .cp-card, .logo-wall, .pricelist, .tabs")).toBeNull();
  });

  it("rates skills on the 4-step scale, expert tier first", () => {
    const { container } = render(<App initial={seed} />);
    const tiers = [...container.querySelectorAll<HTMLElement>("#skills .tier")];
    expect(tiers).toHaveLength(seed.skills.length);
    for (const [i, tier] of tiers.entries()) {
      const g = seed.skills[i]!;
      expect(tier.dataset.level).toBe(String(g.level));
      expect(tier.querySelectorAll(".dot")).toHaveLength(SKILL_LEVEL_MAX);
      expect(tier.querySelectorAll(".dot.on")).toHaveLength(g.level);
    }
    const top = tiers[0]!;
    expect(top.querySelector(".tier-dots")!.getAttribute("aria-label")).toBe(`ระดับ ${SKILL_LEVEL_MAX} จาก ${SKILL_LEVEL_MAX}`);
    expect([...top.querySelectorAll(".skill-name")].map((n) => n.textContent)).toEqual(["Go", "NestJS", "AI"]);
  });

  it("puts a decorative darkroom bench beside the project list and marks each card's progress", () => {
    const { container } = render(<App initial={seed} />);
    const bench = container.querySelector("#projects .bench")!;
    expect(bench.getAttribute("aria-hidden")).toBe("true");
    expect(bench.querySelector("canvas")).not.toBeNull();
    expect([...bench.querySelectorAll(".bench-tray")].map((x) => x.textContent)).toEqual(["DEV", "STOP", "FIX"]);
    const cards = [...container.querySelectorAll<HTMLElement>("#projects .pcard")];
    expect(cards.length).toBe(seed.projects.filter((p) => p.published).length);
    // jsdom has no layout: every card sits above the gate line, so every print is dry
    for (const c of cards) {
      expect(c.dataset.state).toBe("dry");
      expect(c.dataset.stage).toBe("dry");
      expect([...c.querySelectorAll(".stg")].map((x) => x.textContent)).toEqual(["DEV", "STOP", "FIX", "DRY"]);
    }
    // the other sections start their one-off darkroom animations once on screen
    for (const sel of ["#skills .tiers", "#diary .duties", "#documents .slides"])
      expect(container.querySelector(sel)!.classList.contains("is-in"), sel).toBe(true);
  });

  it("only shows the profile phone when it is marked visible", () => {
    const { container } = render(<App initial={seed} />);
    const footer = container.ownerDocument.getElementById("contact")!;
    const personal = footer.querySelector(".contact-card")!;
    expect(personal.textContent?.includes(seed.profile.phone.value)).toBe(seed.profile.phone.visible);
    expect(personal.textContent?.includes(seed.profile.email.value)).toBe(seed.profile.email.visible);
  });

  it("switches language", () => {
    render(<App initial={seed} />);
    expect(document.documentElement.lang).toBe("th");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByText("Scroll down to advance the film")).toBeTruthy();
    expect(screen.getByRole("button", { name: "English" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens the print dialog and closes it with Escape", () => {
    render(<App initial={seed} />);
    const open = screen.getByRole("button", { name: "เปิดภาพ ▸" });
    open.focus();
    fireEvent.click(open);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const first = timelineFrames(seed)[0]!;
    expect(within(dialog).getByRole("heading", { level: 2 }).textContent).toBe(t(first.title, lang));
    // the Original toggle is offered only for a frame with a photo
    expect(within(dialog).queryByRole("button", { name: "ดูรูปจริง" }) !== null).toBe(first.images.length > 0);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it("filters personal projects by group", () => {
    const { container } = render(<App initial={seed} />);
    const published = seed.projects.filter((p) => p.published);
    expect(container.querySelectorAll(".pcard")).toHaveLength(published.length);
    const group = published[published.length - 1]!.group;
    const label = groupLabel(group, lang).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const chip = screen.getByRole("button", { name: new RegExp(`^${label} \\d+$`) });
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll(".pcard")).toHaveLength(published.filter((p) => p.group === group).length);
  });

  it("shows client work as text with an NDA note, and survives an unknown group", () => {
    const base: Project = {
      id: "x",
      name: "x",
      description: { th: "งาน", en: "Work" },
      url: "",
      repo: "",
      tags: [],
      group: "personal",
      year: "",
      featured: false,
      published: true,
    };
    const projects: Project[] = [
      { ...base, id: "c1", name: "Client app", group: "client", image: { url: "/shot.png", alt: { th: "", en: "" } } },
      { ...base, id: "p1", name: "Side thing" },
      // a group a later contract may add: must not crash, gets its own chip
      { ...base, id: "z1", name: "Zine", group: "zine" as Project["group"] },
    ];
    const { container } = render(
      <LangProvider defaultLang="th">
        <Projects projects={projects} />
      </LangProvider>,
    );
    expect(container.querySelector(".nda-note")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^งานลูกค้า 1$/ }));
    expect(container.querySelectorAll(".pcard")).toHaveLength(1);
    expect(container.querySelector(".nda-note")?.textContent).toContain("NDA");
    // no screenshot for client work
    expect(container.querySelector(".pcard .print")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Zine 1$/ }));
    expect(container.querySelectorAll(".pcard")).toHaveLength(1);
    expect(container.querySelector(".nda-note")).toBeNull();
  });

  it("marks #root as mounted so the head script keeps the snapshot hidden", () => {
    const root = document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" }));
    render(<App initial={seed} />, { container: root });
    expect(root.getAttribute("data-mounted")).toBe("1");
  });

  it("starts from the content baked into the page, not the bundled seed", async () => {
    const baked = structuredClone(seed);
    baked.profile.role = { th: "บทบาทที่อบไว้", en: "Baked role" };
    const script = Object.assign(document.createElement("script"), {
      type: "application/json",
      id: EMBEDDED_CONTENT_ID,
      textContent: JSON.stringify(baked).replace(/</g, "\\u003c"),
    });
    document.body.appendChild(script);
    try {
      // main.tsx does exactly this before rendering
      const initial = await initialContent();
      const { container } = render(<App initial={initial} />);
      expect(container.querySelector(".hero-role")?.textContent).toBe(t(baked.profile.role, lang));
    } finally {
      script.remove();
    }
  });

  it("keeps the URL, canonical and og tags in step with the language", () => {
    history.replaceState(null, "", "/#skills");
    render(<App initial={seed} />);
    const canonical = () => document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute("href");
    const og = (p: string) => document.head.querySelector<HTMLMetaElement>(`meta[property="${p}"]`)?.content;
    expect(canonical()).toBe(pageUrl(seed, "th"));
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(`${location.pathname}${location.search}${location.hash}`).toBe("/en/#skills");
    expect(canonical()).toBe(pageUrl(seed, "en"));
    expect(og("og:url")).toBe(pageUrl(seed, "en"));
    expect(og("og:locale")).toBe("en_US");
    expect(document.documentElement.lang).toBe("en");
    fireEvent.click(screen.getByRole("button", { name: "ภาษาไทย" }));
    expect(`${location.pathname}${location.hash}`).toBe("/#skills");
    expect(canonical()).toBe(pageUrl(seed, "th"));
    expect(og("og:locale")).toBe("th_TH");
  });

  it("returns focus to the opener when the dialog is closed from the backdrop", () => {
    render(<App initial={seed} />);
    const open = screen.getByRole("button", { name: "เปิดภาพ ▸" });
    open.focus();
    fireEvent.click(open);
    const backdrop = document.querySelector(".modal-backdrop")!;
    // a press that starts in the panel and ends on the backdrop (a drag) does not close it
    fireEvent.mouseDown(screen.getByRole("dialog"));
    fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog")).not.toBeNull();
    // the backdrop press must not move focus itself (the browser would send it to <body>)
    expect(fireEvent.mouseDown(backdrop)).toBe(false);
    fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it("lets Up/PageUp/Home scroll the page at the first frame instead of swallowing them", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    try {
      const { container } = render(<App initial={seed} />);
      const stage = container.querySelector<HTMLElement>(".film-stage")!;
      stage.focus();
      for (const key of ["ArrowUp", "PageUp", "Home"]) expect(fireEvent.keyDown(stage, { key }), key).toBe(true);
      // browser shortcuts stay with the browser
      expect(fireEvent.keyDown(stage, { key: "ArrowDown", altKey: true })).toBe(true);
      expect(scrollTo).not.toHaveBeenCalled();
      // inside the roll the keys move the film
      expect(fireEvent.keyDown(stage, { key: "ArrowDown" })).toBe(false);
      expect(scrollTo).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("gives every picture its box before it loads (fixed-ratio box or width/height)", () => {
    const { container } = render(<App initial={seed} />);
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      const sized = img.hasAttribute("width") && img.hasAttribute("height");
      const boxed = !!img.closest(".imgbox, .print-frame") || !!img.style.aspectRatio;
      expect(sized || boxed, img.getAttribute("src") ?? "").toBe(true);
    }
  });
});
