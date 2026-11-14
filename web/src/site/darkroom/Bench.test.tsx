import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { seed } from "@pho0m/content/seed";
import { LangProvider } from "../../lib/i18n.tsx";
import { App } from "../App.tsx";
import { Projects } from "../sections/Projects.tsx";
import { groupLabel } from "../util.ts";

/*
 * jsdom has no layout, so these tests fake one: the project list starts at LIST_TOP and every
 * card is CARD_H tall; the viewport is 800 px, so the gate line is at 400 px (mid-screen).
 * requestAnimationFrame is removed, so the bench paints straight away on every scroll event.
 */
const CARD_H = 200;
const LIST_TOP = 1000;
let reduce = false;
let scrollY = 0;
const ctx = {
  putImageData() {},
  drawImage() {},
  fillRect: vi.fn(),
  fillStyle: "",
  globalAlpha: 1,
  imageSmoothingEnabled: true,
  imageSmoothingQuality: "high",
  getImageData: (_x: number, _y: number, w: number, h: number) => ({
    width: w,
    height: h,
    data: new Uint8ClampedArray(w * h * 4).fill(255),
  }),
};
const rect = (top: number, h: number, left = 0, w = 0) =>
  ({ top, bottom: top + h, left, right: left + w, width: w, height: h, x: left, y: top, toJSON() {} }) as DOMRect;

const published = seed.projects
  .map((p, i) => ({ p, i }))
  .filter(({ p }) => p.published)
  .sort((a, b) => Number(b.p.featured) - Number(a.p.featured) || a.i - b.i)
  .map(({ p }) => p);
const n = published.length;

type IO = { cb: IntersectionObserverCallback; margin?: string; els: Element[] };
let observers: IO[] = [];
const stubObservers = () => {
  observers = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      rec: IO;
      constructor(cb: IntersectionObserverCallback, o?: IntersectionObserverInit) {
        this.rec = { cb, margin: o?.rootMargin, els: [] };
        observers.push(this.rec);
      }
      observe(el: Element) {
        this.rec.els.push(el);
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    },
  );
};
const report = (el: Element, isIntersecting: boolean) => {
  const watching = observers.filter((o) => o.els.includes(el));
  expect(watching.length, "an observer watches the element").toBeGreaterThan(0);
  act(() => {
    for (const o of watching) o.cb([{ isIntersecting, target: el } as IntersectionObserverEntry], {} as IntersectionObserver);
  });
};

beforeEach(() => {
  reduce = false;
  scrollY = 0;
  ctx.fillRect.mockClear();
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  vi.stubGlobal("requestAnimationFrame", undefined);
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q === "(prefers-reduced-motion: reduce)" ? reduce : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("scrollTo", vi.fn());
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.matches(".pgrid--darkroom")) return rect(LIST_TOP - scrollY, this.children.length * CARD_H);
    if (this.matches(".pgrid--darkroom > li")) {
      const j = Array.prototype.indexOf.call(this.parentElement!.children, this);
      return rect(LIST_TOP + j * CARD_H - scrollY, CARD_H);
    }
    if (this.matches(".bench-canvas")) return rect(0, 216, 0, 320);
    return rect(0, 0);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const setScroll = (y: number) => {
  scrollY = y;
  fireEvent.scroll(window);
};
/** scrollY that puts the gate line (400 px) at progress t through card j. */
const at = (j: number, t: number) => LIST_TOP + (j + t) * CARD_H - 400;
const states = (c: HTMLElement) =>
  [...c.querySelectorAll<HTMLElement>("#projects .pcard")].map((x) => `${x.dataset.state ?? "-"}/${x.dataset.stage ?? "-"}`);
const text = (c: HTMLElement, sel: string) => c.querySelector(sel)!.textContent;
const renderProjects = () =>
  render(
    <LangProvider defaultLang="th">
      <Projects projects={seed.projects} />
    </LangProvider>,
  );

describe("darkroom bench", () => {
  it("dries the cards above the gate line, puts the one on it in its tray and leaves the rest ahead", () => {
    const { container } = renderProjects();
    expect(states(container)).toEqual(Array(n).fill("ahead/-"));
    setScroll(at(2, 0.5));
    expect(states(container)).toEqual(["dry/dry", "dry/dry", "active/stop", ...Array(n - 3).fill("ahead/-")]);
    expect(text(container, ".bench-name")).toBe(published[2]!.name);
    expect(text(container, ".bench-count")).toBe(`03/${n}`);
    expect(text(container, ".bench-timer")).toBe("STOP 00:45");
    expect([...container.querySelectorAll(".bench-tray[data-on]")].map((x) => x.textContent)).toEqual(["STOP"]);
    setScroll(at(2, 0.2));
    expect(states(container)[2]).toBe("active/dev");
    setScroll(at(2, 0.7));
    expect(states(container)[2]).toBe("active/fix");
    setScroll(at(n, 0.1));
    expect(states(container)).toEqual(Array(n).fill("dry/dry"));
    expect(text(container, ".bench-pile")).toBe(`+${n - 5}`);
  });

  it("follows the list when content above it changes height (offsets are relative to the list)", () => {
    const { container } = renderProjects();
    setScroll(at(2, 0.5));
    // fonts arrive above: the whole list moves 60 px down without changing size
    const moved = vi.mocked(Element.prototype.getBoundingClientRect).getMockImplementation()!;
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
      const r = moved.call(this);
      return this.closest(".pgrid--darkroom") ? rect(r.top + 60, r.height, r.left, r.width) : r;
    });
    setScroll(at(2, 0.5) + 60);
    expect(states(container)[2]).toBe("active/stop");
    expect(text(container, ".bench-timer")).toBe("STOP 00:45");
  });

  it("with reduced motion shows the finished line and leaves the cards unmarked", () => {
    reduce = true;
    const { container } = renderProjects();
    setScroll(at(2, 0.5));
    for (const c of container.querySelectorAll<HTMLElement>("#projects .pcard")) {
      expect(c.dataset.state).toBeUndefined();
      expect(c.dataset.stage).toBeUndefined();
    }
    expect(text(container, ".bench-timer")).toBe("DRY 00:89");
    expect(text(container, ".bench-count")).toBe(`${n}/${n}`);
    expect(container.querySelector(".bench-tray[data-on]")).toBeNull();
  });

  it("re-measures and re-counts after a filter change, clearing the old pile count", () => {
    const { container } = renderProjects();
    setScroll(at(12, 0.5));
    expect(text(container, ".bench-pile")).toBe("+7");
    const group = published[published.length - 1]!.group;
    const k = published.filter((p) => p.group === group).length;
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${groupLabel(group, "th")} ${k}$`) }));
    setScroll(at(0, 0.5));
    expect(states(container)[0]).toBe("active/stop");
    expect(text(container, ".bench-count")).toBe(`01/${String(k).padStart(2, "0")}`);
    expect(text(container, ".bench-name")).toBe(published.find((p) => p.group === group)!.name);
    expect(text(container, ".bench-pile")).toBe("");
  });

  it("scrolls a clicked print's card just above the gate, so its print stays on the line", () => {
    const { container } = renderProjects();
    setScroll(at(n, 0.1)); // past the list: every print is dry, the newest on the left peg
    const canvas = container.querySelector("canvas")!;
    fireEvent.click(canvas, { clientX: 160, clientY: 175 }); // the trays: nothing
    expect(window.scrollTo).not.toHaveBeenCalled();
    fireEvent.click(canvas, { clientX: 30, clientY: 45 }); // the newest peg: the last card
    // card bottom at 6 px above the 400 px gate
    const top = LIST_TOP + (n - 1) * CARD_H - (400 - 6 - CARD_H);
    expect(window.scrollTo).toHaveBeenCalledWith({ top, behavior: "smooth" });
    setScroll(top);
    expect(states(container)[n - 1]).toBe("dry/dry");
  });

  it("does not draw while the list is off screen, but keeps the cards in step", () => {
    stubObservers();
    const { container } = renderProjects();
    const area = container.querySelector(".pj-darkroom")!;
    report(area, false);
    ctx.fillRect.mockClear();
    setScroll(at(n, 0.5));
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(states(container)).toEqual(Array(n).fill("dry/dry"));
    report(area, true);
    expect(ctx.fillRect).toHaveBeenCalled();
  });
});

describe("one-off darkroom touches", () => {
  it("wait until 20% into the viewport, then stay on", () => {
    stubObservers();
    const { container } = render(<App initial={seed} />);
    for (const sel of ["#skills .tiers", "#utotech .hangers", "#diary .duties", "#documents .slides"]) {
      const el = container.querySelector(sel)!;
      expect(el.classList.contains("is-out"), sel).toBe(true);
      expect(
        observers.filter((o) => o.els.includes(el)).map((o) => o.margin),
        sel,
      ).toEqual(["0px 0px -20% 0px"]);
      report(el, true);
      expect(el.classList.contains("is-in"), sel).toBe(true);
      report(el, false);
      expect(el.classList.contains("is-in"), sel).toBe(true);
    }
  });
});
