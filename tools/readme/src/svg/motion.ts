import { n } from "./xml.ts";

/**
 * Card animations. GitHub shows the SVGs through <img>, where CSS animations still run
 * (scripts don't). Every animation lives inside one reduced-motion guard, so viewers who
 * ask for less motion see the static card, which is always the finished state: the clear
 * print, the strip at rest, DRY lit.
 */
export const MOTION_QUERY = "@media (prefers-reduced-motion: no-preference)";

export function motionCss(rules: string): string {
  return rules ? `${MOTION_QUERY}{${rules}}` : "";
}

/** Percentage of a timeline, rounded for stable output and clamped to 0..100. */
export function pct(time: number, total: number): string {
  return `${n(Math.max(0, Math.min(100, (time / total) * 100)))}%`;
}

/** Seconds, rounded for stable output. */
export const sec = (v: number): string => `${n(v)}s`;

export type Stop = { at: number; opacity: number; ease?: string };

/** @keyframes for an opacity timeline in seconds (`total` = duration). Stops must be in order. */
export function opacityKeyframes(name: string, total: number, stops: Stop[]): string {
  const body = stops
    .map((s) => `${pct(s.at, total)}{opacity:${n(s.opacity)}${s.ease ? `;animation-timing-function:${s.ease}` : ""}}`)
    .join("");
  return `@keyframes ${name}{${body}}`;
}
