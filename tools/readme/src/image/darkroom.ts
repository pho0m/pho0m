import { DARKROOM, SPRITES, SPRITE_PALETTE, type IconName } from "@pho0m/content";
import { BAYER8, type Gray } from "./gray.ts";

/**
 * The website's print pipeline (web/src/lib/pixel.ts + print.ts) ported to Node, without a DOM.
 * Everything works on luminance (Gray, 0 = black … 1 = white) because every print is a duotone:
 *
 *   developingBits → two-tone ordered dither at FRAME_W×FRAME_H (the "coming up in the tray" effect)
 *   clearLevels    → continuous-tone print, 0 = ink … 255 = paper (the finished, sharp print)
 *   negative       → the same levels mapped onto the red safelight negative (see NEGATIVE below)
 *
 * Same maths as the site so the README frames look like the frames on the website.
 */

export const FRAME_W = 128;
export const FRAME_H = 88;

export type Rgb = [number, number, number];
export type Rgba = { width: number; height: number; data: Uint8ClampedArray };
export type Tone = { black: number; white: number };
export type PrintSource = {
  gray: Gray;
  /** true for photos (shown smooth), false for pixel-art scenes (shown pixelated). */
  photo: boolean;
  ditherTone?: Tone;
  clearTone?: Tone;
};

export const hexRgb = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
export const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as Rgb;
export const rgbHex = (c: Rgb): string => "#" + c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");

export const PAPER = hexRgb(DARKROOM.paper);
export const INK = hexRgb(DARKROOM.ink);
const NEG_HI = hexRgb(DARKROOM.led);
const NEG_BASE = hexRgb(DARKROOM.filmBase);

/** Print colour for a clear level (0 = ink … 1 = paper). */
export function duotoneAt(t: number): Rgb {
  return mixRgb(INK, PAPER, t);
}

/** Safelight negative of a print level, exactly like the site's negativeOf(): lum(print) → led … film base. */
export function negativeAt(t: number): Rgb {
  const c = duotoneAt(t);
  return mixRgb(NEG_HI, NEG_BASE, (c[0] + c[1] + c[2]) / 765);
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const SKY: { t: number; top: Rgb; bot: Rgb; gr: Rgb }[] = [
  { t: 0, top: hexRgb("#2a2858"), bot: hexRgb("#f0a07e"), gr: hexRgb("#5b4a5e") },
  { t: 0.33, top: hexRgb("#3a78d0"), bot: hexRgb("#a8def0"), gr: hexRgb("#4f8f3e") },
  { t: 0.66, top: hexRgb("#56306e"), bot: hexRgb("#f2a03c"), gr: hexRgb("#6a4630") },
  { t: 1, top: hexRgb("#0a0e28"), bot: hexRgb("#33305f"), gr: hexRgb("#1e2438") },
];

function skyAt(t: number) {
  t = Math.max(0, Math.min(1, t));
  for (let k = 0; k < SKY.length - 1; k++) {
    const A = SKY[k]!;
    const B = SKY[k + 1]!;
    if (t <= B.t) {
      const f = (t - A.t) / (B.t - A.t);
      return { top: mixRgb(A.top, B.top, f), bot: mixRgb(A.bot, B.bot, f), gr: mixRgb(A.gr, B.gr, f) };
    }
  }
  const L = SKY[SKY.length - 1]!;
  return { top: L.top, bot: L.bot, gr: L.gr };
}

/**
 * Colour pixel scene (FRAME_W x FRAME_H) for a frame without a photo: sky by time of day
 * `t` (0 = dawn … 1 = night), ground and the icon sprite. Port of the site's iconScene().
 */
export function iconScene(icon: IconName, t: number, seed = 0): Rgba {
  const W = FRAME_W / 2;
  const H = FRAME_H / 2;
  const GY = H - 10;
  const s = skyAt(t);
  const cols = [0, 1, 2, 3, 4].map((k) => mixRgb(s.top, s.bot, k / 4));
  const d = new Uint8ClampedArray(W * H * 4);
  const put = (x: number, y: number, c: Rgb) => {
    const k = (y * W + x) * 4;
    d[k] = c[0];
    d[k + 1] = c[1];
    d[k + 2] = c[2];
    d[k + 3] = 255;
  };
  const grDk = mixRgb(s.gr, [0, 0, 0], 0.25);
  const grTop = mixRgb(s.gr, [255, 255, 255], 0.22);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let c: Rgb;
      if (y < GY) {
        const v = (y / (GY - 1)) * 4;
        const b0 = Math.floor(v);
        const fr = v - b0;
        c = cols[Math.min(4, b0 + (fr > BAYER4[(y & 3) * 4 + (x & 3)]! / 16 ? 1 : 0))]!;
      } else if (y === GY) c = grTop;
      else c = hash(x * 7 + y * 13 + seed) > 0.8 ? grDk : s.gr;
      put(x, y, c);
    }
  const disc = (cx: number, cy: number, r: number, c: Rgb) => {
    for (let dy = -r; dy <= r; dy++) {
      const w = Math.floor(Math.sqrt(r * r + r * 0.8 - dy * dy));
      for (let dx = -w; dx <= w; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < W && y >= 0 && y < GY) put(x, y, c);
      }
    }
  };
  if (t > 0.7) {
    for (let k = 0; k < 12; k++) put(Math.floor(hash(k * 3 + seed * 17) * W), Math.floor(hash(k * 11 + seed) * 24), [255, 251, 232]);
    disc(52, 8, 4, [238, 234, 255]);
    disc(54, 7, 3, cols[0]!);
  } else {
    disc(50, Math.round(6 + Math.abs(t - 0.33) * 30), 4, t > 0.5 ? [255, 207, 122] : [255, 241, 184]);
  }
  const rows = SPRITES[icon] ?? SPRITES.star;
  const ox = 16;
  const oy = GY - 30;
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const col = SPRITE_PALETTE[row[i]!];
      if (!col) continue;
      const c = hexRgb(col);
      for (let a = 0; a < 2; a++)
        for (let b = 0; b < 2; b++) {
          const x = ox + i * 2 + a;
          const y = oy + j * 2 + b;
          if (x >= 0 && x < W && y >= 0 && y < H) put(x, y, c);
        }
    }
  });
  const out = new Uint8ClampedArray(FRAME_W * FRAME_H * 4);
  for (let y = 0; y < FRAME_H; y++)
    for (let x = 0; x < FRAME_W; x++) {
      const si = ((y >> 1) * W + (x >> 1)) * 4;
      const di = (y * FRAME_W + x) * 4;
      out[di] = d[si]!;
      out[di + 1] = d[si + 1]!;
      out[di + 2] = d[si + 2]!;
      out[di + 3] = 255;
    }
  return { width: FRAME_W, height: FRAME_H, data: out };
}

/** RGBA → luminance with the site's weights (0.3, 0.59, 0.11). */
export function lumaOf(img: Rgba): Gray {
  const data = new Float32Array(img.width * img.height);
  const d = img.data;
  for (let i = 0; i < data.length; i++) data[i] = (d[i * 4]! * 0.3 + d[i * 4 + 1]! * 0.59 + d[i * 4 + 2]! * 0.11) / 255;
  return { width: img.width, height: img.height, data };
}

/** Box-filter downsample (area average). */
export function downsample(src: Gray, w: number, h: number): Gray {
  if (src.width === w && src.height === h) return src;
  return resampleRegion(src, { x: 0, y: 0, w: src.width, h: src.height }, w, h);
}

/** Area-average a region of `src` into w x h (missing pixels read as white paper). */
export function resampleRegion(src: Gray, r: { x: number; y: number; w: number; h: number }, w: number, h: number): Gray {
  const out = new Float32Array(w * h);
  const fx = r.w / w;
  const fy = r.h / h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(r.x + x * fx);
      const x1 = Math.max(x0 + 1, Math.floor(r.x + (x + 1) * fx));
      const y0 = Math.floor(r.y + y * fy);
      const y1 = Math.max(y0 + 1, Math.floor(r.y + (y + 1) * fy));
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const inside = xx >= 0 && yy >= 0 && xx < src.width && yy < src.height;
          sum += inside ? src.data[yy * src.width + xx]! : 1;
          n++;
        }
      out[y * w + x] = n ? sum / n : 1;
    }
  return { width: w, height: h, data: out };
}

/** Cover-fit (centre crop to the target aspect), like the site's sourceToImageData(). */
export function coverFit(src: Gray, w: number, h: number): Gray {
  const scale = Math.max(w / src.width, h / src.height);
  const cw = w / scale;
  const ch = h / scale;
  return resampleRegion(src, { x: (src.width - cw) / 2, y: (src.height - ch) / 2, w: cw, h: ch }, w, h);
}

/** Contain-fit a cut-out image on white paper with a small margin, like the site's containOnPaper(). */
export function containFit(src: Gray, w: number, h: number): Gray {
  const scale = Math.min((w * 0.84) / src.width, (h * 0.84) / src.height);
  const vw = w / scale;
  const vh = h / scale;
  return resampleRegion(src, { x: (src.width - vw) / 2, y: (src.height - vh) / 2, w: vw, h: vh }, w, h);
}

/** Percentile auto-levels: the darkest/lightest `clip` share maps to full ink/paper. */
export function autoTone(src: Gray, clip = 0.12, minSpan = 0.35): Tone {
  const hist = new Uint32Array(256);
  for (const v of src.data) hist[Math.max(0, Math.min(255, Math.round(v * 255)))]!++;
  const total = src.data.length;
  const at = (q: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v]!;
      if (acc >= q * total) return v / 255;
    }
    return 1;
  };
  let black = at(clip);
  let white = at(1 - clip);
  if (white - black < minSpan) {
    const mid = (white + black) / 2;
    black = Math.max(0, mid - minSpan / 2);
    white = Math.min(1, mid + minSpan / 2);
  }
  return { black, white };
}

/** Photo (luminance) → print source at w x h. Cut-outs are contained on paper; photos are cover-fit and auto-toned. */
export function photoSource(img: Gray & { cutout?: boolean }, w: number, h: number): PrintSource {
  if (img.cutout) return { gray: containFit(img, w, h), photo: true };
  const gray = coverFit(img, w, h);
  return { gray, photo: true, ditherTone: autoTone(gray, 0.12, 0.35), clearTone: autoTone(gray, 0.01, 0.5) };
}

/** Generated pixel-art scene for a frame without a photo. */
export function iconSource(icon: IconName, t: number, seed = 0): PrintSource {
  return { gray: lumaOf(iconScene(icon, t, seed)), photo: false };
}

/** The developing print: ordered dither at FRAME size, 1 = ink. `level` 0 → 1 (shadows come up first). */
export function developingBits(src: PrintSource, level: number): Uint8Array {
  const g = downsample(src.gray, FRAME_W, FRAME_H);
  const { black, white } = src.ditherTone ?? { black: 0.12, white: 0.88 };
  const span = Math.max(0.01, white - black);
  const bits = new Uint8Array(g.width * g.height);
  for (let y = 0; y < g.height; y++)
    for (let x = 0; x < g.width; x++) {
      const lum = g.data[y * g.width + x]!;
      const dark = Math.max(0, Math.min(1, (white - lum) / span)) * level;
      bits[y * g.width + x] = dark > (BAYER8[(y & 7) * 8 + (x & 7)]! + 0.5) / 64 ? 1 : 0;
    }
  return bits;
}

export type ClearOptions = { level?: number; grain?: number; contrast?: number };

/**
 * The finished print: continuous-tone levels at the source's resolution, 0 = ink … 255 = paper.
 * Port of tonePrint() with clearPrint()'s settings (grain is off by default here: it only adds bytes).
 */
export function clearLevels(src: PrintSource, opts: ClearOptions = {}): Uint8Array {
  const { level = 1, grain = 0, contrast = src.photo ? 0.3 : 0.15 } = opts;
  const { black, white } = src.clearTone ?? { black: 0, white: 1 };
  const span = Math.max(0.01, white - black);
  const g = src.gray;
  const lv = Math.max(0, Math.min(1, level));
  const out = new Uint8Array(g.width * g.height);
  for (let y = 0; y < g.height; y++)
    for (let x = 0; x < g.width; x++) {
      let lum = Math.max(0, Math.min(1, (g.data[y * g.width + x]! - black) / span));
      lum = lum + contrast * (lum - 0.5) * (1 - Math.abs(2 * lum - 1));
      if (grain > 0) lum += (hash(x * 12.9898 + y * 78.233) - 0.5) * grain;
      lum = Math.max(0, Math.min(1, lum));
      const density = (1 - lum) * Math.min(1, lv * (1 + (1 - lum)));
      out[y * g.width + x] = Math.round((1 - density) * 255);
    }
  return out;
}
