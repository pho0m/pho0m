import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { seed, t, timelineFrames, type Project } from "@pho0m/content";
import { LangProvider } from "../lib/i18n.tsx";
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
beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("public site", () => {
  it("renders every section from the seed", () => {
    const { container } = render(<App />);
    for (const id of ["top", "film", "utotech", "projects", "skills", "diary", "contact"])
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(t(seed.profile.name, lang));
    // one film cell per published frame
    expect(container.querySelectorAll(".ff")).toHaveLength(timelineFrames(seed).length);
    // only documents with a url are listed
    expect(container.querySelectorAll(".doc")).toHaveLength(seed.documents.filter((d) => d.url).length);
    // every published Utotech project gets a card
    expect(container.querySelectorAll(".cp-card")).toHaveLength(
      seed.company.projects.filter((p) => p.published).length,
    );
  });

  it("only shows the profile phone when it is marked visible", () => {
    const { container } = render(<App />);
    const footer = container.ownerDocument.getElementById("contact")!;
    const personal = footer.querySelector(".contact-card")!;
    expect(personal.textContent?.includes(seed.profile.phone.value)).toBe(seed.profile.phone.visible);
    expect(personal.textContent?.includes(seed.profile.email.value)).toBe(seed.profile.email.visible);
  });

  it("switches language", () => {
    render(<App />);
    expect(document.documentElement.lang).toBe("th");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByText("Scroll down to advance the film")).toBeTruthy();
    expect(screen.getByRole("button", { name: "English" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens the print dialog and closes it with Escape", () => {
    render(<App />);
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
    const { container } = render(<App />);
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

  it("opens a Utotech project with its features", () => {
    render(<App />);
    const p = seed.company.projects.find((x) => x.published)!;
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`ดูรายละเอียด ${p.name}`) }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { level: 2 }).textContent).toBe(p.name);
    expect(dialog.querySelectorAll(".pj-feature")).toHaveLength(p.features.length);
  });
});
