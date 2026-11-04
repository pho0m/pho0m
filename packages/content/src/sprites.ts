import type { IconName } from "./schema.ts";

/**
 * 16x16 pixel sprites, one character per pixel. "." is transparent; every other
 * character is a key into SPRITE_PALETTE. Shared by the website (canvas) and the
 * README generator (SVG rects) so both draw identical icons.
 */
export const SPRITE_PALETTE: Record<string, string> = {
  k: "#1b1a26",
  w: "#f6f1e6",
  y: "#ffd23f",
  o: "#f08a24",
  r: "#e0483e",
  b: "#3b7fd6",
  c: "#6fd6e8",
  g: "#5cc45a",
  G: "#2d6e3a",
  n: "#7a4a2a",
  l: "#c9c8d2",
  d: "#5a5868",
};

const E = "................";

export const SPRITES: Record<IconName, readonly string[]> = {
  laptop: [E, "..kkkkkkkkkkkk..", "..kddddddddddk..", "..kdbbbbbbbbdk..", "..kdbwwbbbbbdk..", "..kdbbbbccbbdk..", "..kdbwwwbbbbdk..", "..kdbbbcccbbdk..", "..kdbbbbbbbbdk..", "..kddddddddddk..", "..kkkkkkkkkkkk..", ".kllllllllllllk.", "klllddddddddlllk", "kkkkkkkkkkkkkkkk", E, E],
  note: [E, ".........k......", ".........kk.....", ".........kyk....", ".........kyyk...", ".........kkyyk..", ".........k.kyk..", ".........k..kk..", ".........k......", ".........k......", "......kkkk......", ".....kyyyk......", "....kyyyyk......", "....kyyyk.......", ".....kkk........", E],
  chedi: [".......yy.......", ".......yy.......", "......kyyk......", "......kyyk......", ".....kyyyyk.....", ".....kyyyyk.....", "....kooooook....", "....kyyyyyyk....", "...kyyyyyyyyk...", "...kyyoyyoyyk...", "..kyyyyyyyyyyk..", "..kooooooooook..", ".kwwwwwwwwwwwwk.", ".kwwkwwkwwkwwwk.", "kkkkkkkkkkkkkkkk", E],
  eye: [E, E, E, ".....kkkkkk.....", "...kkwwwwwwkk...", "..kwwwkkkkwwwk..", ".kwwwkbbbbkwwwk.", "kwwwkbwkkbbkwwwk", "kwwwkbbkkbbkwwwk", ".kwwwkbbbbkwwwk.", "..kwwwkkkkwwwk..", "...kkwwwwwwkk...", ".....kkkkkk.....", E, E, E],
  check: [".....kkkkkk.....", "....kllllllk....", "..kkkkkkkkkkkk..", "..kwwwwwwwwwwk..", "..kwwwwwwwwgwk..", "..kwwwwwwwggwk..", "..kwwwwwwggwwk..", "..kwgwwwggwwwk..", "..kwggwggwwwwk..", "..kwwgggwwwwwk..", "..kwwwgwwwwwwk..", "..kwwwwwwwwwwk..", "..kwddddddddwk..", "..kwwwwwwwwwwk..", "..kkkkkkkkkkkk..", E],
  drop: [".......kk.......", "......kcck......", "......kcck......", ".....kcccck.....", ".....kcccck.....", "....kcccccck....", "....kcwcccck....", "...kcwwccccbk...", "...kcwcccccbk...", "...kccccccbbk...", "...kccccccbbk...", "....kccccbbk....", ".....kkkkkk.....", E, E, E],
  board: [E, ".nnnnnnnnnnnnnn.", ".nGGGGGGGGGGGGn.", ".nGwwGGGGGGGGGn.", ".nGGGGwwwGGGGGn.", ".nGGGGGGGGwGGGn.", ".nGwGGwwGGGGGGn.", ".nGGGGGGGGGwwGn.", ".nGGGGGGGGGGGGn.", ".nnnnnnnnnnnnnn.", "....n......n....", "...n........n...", "..n..........n..", E, E, E],
  bubble: [E, E, "...kkkkkkkkkk...", "..kbbbbbbbbbbk..", ".kbbbbbbbbbbbbk.", ".kbwwbbwwbbwwbk.", ".kbwwbbwwbbwwbk.", ".kbbbbbbbbbbbbk.", "..kbbbbbbbbbbk..", "...kkkbbkkkkk...", ".....kbk........", ".....kk.........", E, E, E, E],
  rocket: [".......kk.......", "......kwwk......", ".....kwwwwk.....", ".....kwbbwk.....", ".....kwbbwk.....", ".....kwwwwk.....", ".....kwwwwk.....", "....kkwwwwkk....", "...krkwwwwkrk...", "...krkwwwwkrk...", "...kkkkwwkkkk...", "......kook......", "......kyyk......", ".......yy.......", ".......o........", E],
  brief: [E, E, "......kkkk......", ".....kk..kk.....", "..kkkkkkkkkkkk..", ".knnnnnnnnnnnnk.", ".knnnnnnnnnnnnk.", ".knnnnnyynnnnnk.", ".kkkkkkyykkkkkk.", ".knnnnnnnnnnnnk.", ".knnnnnnnnnnnnk.", ".knnnnnnnnnnnnk.", ".kkkkkkkkkkkkkk.", E, E, E],
  star: [E, ".......kk.......", "......kyyk......", "......kyyk......", ".....kyyyyk.....", "kkkkkkyyyykkkkkk", ".kyyyyyyyyyyyyk.", "..kyyyyyyyyyyk..", "...kyyyyyyyyk...", "....kyyyyyyk....", "...kyyyyyyyyk...", "..kyyyykkyyyyk..", "..kyykk..kkyyk..", ".kykk......kkyk.", ".kk..........kk.", E],
  cap: [E, E, ".......kk.......", ".....kkddkk.....", "...kkddddddkk...", ".kkddddddddddkk.", "kddddddddddddddk", ".kkddddddddddkky", "...kkddddddkk..y", "....kkkkkkkk...y", "....kddddddk..yy", "....kddddddk..yy", "....kkkkkkkk....", E, E, E],
  code: [E, ".dddddddddddddd.", ".drdydgdddddddd.", ".dddddddddddddd.", ".dkkkkkkkkkkkkd.", ".dkgkkkkkkkkkkd.", ".dkkgkkkkkkkkkd.", ".dkgkkggggkkkkd.", ".dkkkkkkkkkkkkd.", ".dkkkkkkkkkkkkd.", ".dddddddddddddd.", E, E, E, E, E],
  flag: ["..k.............", "..krrrrrrrrr....", "..krrrrrrrrrr...", "..krrwwrrrrrrr..", "..krrwwrrrrrrr..", "..krrrrrrrrrr...", "..krrrrrrrrr....", "..k.............", "..k.............", "..k.............", "..k.............", "..k.............", "..k.............", "..k.............", ".kkk............", E],
};

/** Iterate the opaque pixels of a sprite. */
export function spritePixels(name: IconName): { x: number; y: number; color: string; key: string }[] {
  const rows = SPRITES[name] ?? SPRITES.star;
  const out: { x: number; y: number; color: string; key: string }[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const key = row[x]!;
      const color = SPRITE_PALETTE[key];
      if (color) out.push({ x, y, color, key });
    }
  });
  return out;
}

/**
 * Darkroom palette (concept B colours) — the single source for both the site and README.
 * paper/ink are the two tones of a developed print; red is the safelight.
 */
export const DARKROOM = {
  bg: "#120303",
  bg2: "#1c0706",
  bg3: "#2a0d0a",
  line: "#7a2c22",
  red: "#ff4a32",
  redDeep: "#b8261a",
  led: "#ff8a76",
  paper: "#efe7d8",
  ink: "#2b1d17",
  muted: "#c9a49b",
  filmBase: "#2a0b08",
  hole: "#070101",
} as const;
