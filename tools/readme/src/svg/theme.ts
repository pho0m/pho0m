import { DARKROOM } from "@pho0m/content";

/**
 * Card colours. Dark = the darkroom (safelight red on near-black, paper text, LED accents);
 * light = a sheet of photo paper (ink text, deep red accents). Film stock and prints are
 * physical objects, so they keep their own colours in both variants.
 */
export type Theme = {
  name: "dark" | "light";
  bg: string;
  panel: string;
  panel2: string;
  line: string;
  line2: string;
  accent: string;
  /** LED/LCD text colour */
  led: string;
  text: string;
  muted: string;
  /** colour of text sitting on an accent fill */
  onAccent: string;
  glow: string;
  glowOpacity: number;
  shadow: string;
  shadowOpacity: number;
  /** a film leader / band strip */
  strip: string;
  stripHole: string;
  stripText: string;
  stripMuted: string;
  stripEdge: string;
};

export const FILM = {
  base: DARKROOM.filmBase,
  hole: DARKROOM.hole,
  text: "#efe2d6",
  muted: DARKROOM.muted,
  edge: DARKROOM.led,
  paper: DARKROOM.paper,
  ink: DARKROOM.ink,
  stamp: DARKROOM.red,
} as const;

export const DARK: Theme = {
  name: "dark",
  bg: DARKROOM.bg,
  panel: DARKROOM.bg2,
  panel2: DARKROOM.bg3,
  line: "#4a1812",
  line2: DARKROOM.line,
  accent: DARKROOM.red,
  led: DARKROOM.led,
  text: "#efe2d6",
  muted: DARKROOM.muted,
  onAccent: DARKROOM.bg,
  glow: DARKROOM.red,
  glowOpacity: 0.22,
  shadow: "#000000",
  shadowOpacity: 0.55,
  strip: DARKROOM.filmBase,
  stripHole: DARKROOM.hole,
  stripText: "#efe2d6",
  stripMuted: DARKROOM.muted,
  stripEdge: DARKROOM.led,
};

export const LIGHT: Theme = {
  name: "light",
  bg: DARKROOM.paper,
  panel: "#e7dcc9",
  panel2: "#dccdb4",
  line: "#cdb79a",
  line2: "#a8836b",
  accent: DARKROOM.redDeep,
  led: "#a32115",
  text: DARKROOM.ink,
  muted: "#6b4f45",
  onAccent: DARKROOM.paper,
  glow: DARKROOM.red,
  glowOpacity: 0.1,
  shadow: DARKROOM.ink,
  shadowOpacity: 0.18,
  strip: "#e2d5bf",
  stripHole: DARKROOM.paper,
  stripText: DARKROOM.ink,
  stripMuted: "#6b4f45",
  stripEdge: DARKROOM.redDeep,
};

export const THEMES = [DARK, LIGHT] as const;
