import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { holdHashTarget, isOffTarget, useHashLanding } from "./hooks.ts";

/**
 * jsdom has no layout, so the page is a model: a section at document offset `offset`,
 * the window at `scrollY`, a 56 px top bar (scroll-padding-top), 10 000 px of page.
 */
const PAD = 56;
let scrollY = 0;
let offset = 3000;
let target: HTMLElement;
let observers: (() => void)[] = [];

function relayout(delta: number) {
  offset += delta;
  for (const cb of observers) cb();
}

beforeEach(() => {
  vi.useFakeTimers();
  scrollY = 0;
  offset = 3000;
  observers = [];
  document.documentElement.style.scrollPaddingTop = `${PAD}px`;
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 10_000 });
  // A ResizeObserver whose callbacks the test fires itself ("the layout changed").
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {
        observers = [];
      }
    },
  );
  document.body.innerHTML = `<main><section id="top"></section><section id="projects"></section></main>`;
  target = document.getElementById("projects")!;
  target.getBoundingClientRect = () => ({ top: offset - scrollY }) as DOMRect;
  target.scrollIntoView = vi.fn(() => {
    scrollY = offset - PAD;
  });
  history.replaceState(null, "", "/#projects");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

describe("isOffTarget", () => {
  it("is on target under the top bar, or at the bottom of the page", () => {
    scrollY = offset - PAD;
    expect(isOffTarget(target)).toBe(false);
    scrollY = offset - PAD - 300; // still above it
    expect(isOffTarget(target)).toBe(true);
    scrollY = offset; // past it
    expect(isOffTarget(target)).toBe(true);
    // a short last section cannot reach the top bar: the bottom of the page counts as landed
    scrollY = 10_000 - window.innerHeight;
    offset = scrollY + 300;
    expect(isOffTarget(target)).toBe(false);
  });
});

describe("holdHashTarget", () => {
  it("lands on the hash target and keeps it there while the layout settles", () => {
    const stop = holdHashTarget(document);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "instant" });
    expect(history.scrollRestoration).toBe("manual");
    expect(target.getBoundingClientRect().top).toBe(PAD);
    // web fonts swap in above it: the section moves down 700 px, the page follows
    relayout(700);
    expect(target.getBoundingClientRect().top).toBe(PAD);
    relayout(-250);
    expect(target.getBoundingClientRect().top).toBe(PAD);
    stop();
    relayout(100);
    expect(target.getBoundingClientRect().top).toBe(PAD + 100);
  });

  it("lets go once the visitor scrolls", () => {
    holdHashTarget(document);
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 120 }));
    scrollY += 120;
    relayout(400);
    expect(target.getBoundingClientRect().top).toBe(PAD - 120 + 400);
  });

  it("lets go when the layout has been quiet for a while", () => {
    holdHashTarget(document, { settleMs: 500, maxMs: 5000 });
    vi.advanceTimersByTime(600);
    relayout(300);
    expect(target.getBoundingClientRect().top).toBe(PAD + 300);
  });

  it("does nothing without a hash or for an unknown id", () => {
    history.replaceState(null, "", "/");
    holdHashTarget(document)();
    history.replaceState(null, "", "/#nope");
    holdHashTarget(document)();
    expect(target.scrollIntoView).not.toHaveBeenCalled();
  });
});

function Landing({ k }: { k: number }) {
  useHashLanding(k);
  return null;
}

describe("useHashLanding", () => {
  it("lands on mount and corrects a hash change that ended off target", () => {
    render(<Landing k={1} />);
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(7000); // the first-load hold is over
    // The browser's own jump ended short (something above grew while it scrolled).
    history.replaceState(null, "", "/#top");
    history.replaceState(null, "", "/#projects");
    scrollY = offset - 800;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    vi.advanceTimersByTime(400);
    expect(target.scrollIntoView).toHaveBeenLastCalledWith({ block: "start", behavior: "smooth" });
    expect(target.getBoundingClientRect().top).toBe(PAD);
  });

  it("leaves a hash change alone when the visitor scrolls during the jump", () => {
    render(<Landing k={1} />);
    vi.advanceTimersByTime(7000);
    const calls = vi.mocked(target.scrollIntoView).mock.calls.length;
    scrollY = offset - 800;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    vi.advanceTimersByTime(50);
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 120 }));
    vi.advanceTimersByTime(400);
    expect(vi.mocked(target.scrollIntoView).mock.calls.length).toBe(calls);
  });

  it("lands again when the live content replaces the baked one, unless the visitor moved", () => {
    const { rerender } = render(<Landing k={1} />);
    vi.advanceTimersByTime(7000);
    scrollY = 0;
    rerender(<Landing k={2} />);
    expect(target.getBoundingClientRect().top).toBe(PAD);
    window.dispatchEvent(new Event("touchstart"));
    scrollY = 0;
    rerender(<Landing k={3} />);
    expect(target.getBoundingClientRect().top).toBe(offset);
  });
});
