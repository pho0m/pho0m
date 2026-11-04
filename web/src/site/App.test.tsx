import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { seed, timelineFrames } from "@pho0m/content";
import { App } from "./App.tsx";

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
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Kiattiphoom Poonketkit");
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
    expect(within(dialog).getByRole("heading", { level: 2 }).textContent).toBe(first.title.th);
    // the first frame has a photo, so the Original toggle is offered
    expect(within(dialog).getByRole("button", { name: "ดูรูปจริง" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it("filters personal projects by group", () => {
    const { container } = render(<App />);
    const published = seed.projects.filter((p) => p.published);
    expect(container.querySelectorAll(".pcard")).toHaveLength(published.length);
    fireEvent.click(screen.getByRole("button", { name: /งานสอน/ }));
    expect(container.querySelectorAll(".pcard")).toHaveLength(published.filter((p) => p.group === "teaching").length);
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
