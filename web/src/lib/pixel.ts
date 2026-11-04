import { DARKROOM, SPRITES, SPRITE_PALETTE, type IconName } from "@pho0m/content";

/**
 * Pixel / darkroom image engine shared by the site and the admin preview.
 * Every frame image is a small bitmap (FRAME_W x FRAME_H) that is shown with
 * `image-rendering: pixelated`. Photos and generated icon scenes both go
 * through the same B&W ordered dither so they look like darkroom prints.
 */

export const FRAME_W = 128;
export const FRAME_H = 88;

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const mix = (a: RGB, b: RGB, t: number): RGB =>
  [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as RGB;

export const PAPER = hex(DARKROOM.paper);
export const INK = hex(DARKROOM.ink);

/** 8x8 Bayer matrix, values 0..63. */
export const BAYER8: number[] = (() => {
  const m: number[] = [];
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      let v = 0;
      const xc = x ^ y;
      for (let bit = 2; bit >= 0; bit--) v = (v << 2) | (((xc >> bit) & 1) << 1) | ((y >> bit) & 1);
      m.push(v);
    }
  return m;
})();
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function createImageData(w: number, h: number): ImageData {
  if (typeof ImageData !== "undefined") return new ImageData(w, h);
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: "srgb" } as ImageData;
}

/** Draw a sprite onto a 2D context at integer scale. */
export function drawSprite(ctx: CanvasRenderingContext2D, name: IconName, x: number, y: number, scale = 1): void {
  const rows = SPRITES[name] ?? SPRITES.star;
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const col = SPRITE_PALETTE[row[i]!];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x + i * scale, y + j * scale, scale, scale);
    }
  });
}

function putPixel(d: Uint8ClampedArray, w: number, x: number, y: number, c: RGB) {
  const k = (y * w + x) * 4;
  d[k] = c[0];
  d[k + 1] = c[1];
  d[k + 2] = c[2];
  d[k + 3] = 255;
}

const SKY: { t: number; top: RGB; bot: RGB; gr: RGB }[] = [
  { t: 0, top: hex("#2a2858"), bot: hex("#f0a07e"), gr: hex("#5b4a5e") },
  { t: 0.33, top: hex("#3a78d0"), bot: hex("#a8def0"), gr: hex("#4f8f3e") },
  { t: 0.66, top: hex("#56306e"), bot: hex("#f2a03c"), gr: hex("#6a4630") },
  { t: 1, top: hex("#0a0e28"), bot: hex("#33305f"), gr: hex("#1e2438") },
];
function skyAt(t: number) {
  t = Math.max(0, Math.min(1, t));
  for (let k = 0; k < SKY.length - 1; k++) {
    const A = SKY[k]!;
    const B = SKY[k + 1]!;
    if (t <= B.t) {
      const f = (t - A.t) / (B.t - A.t);
      return { top: mix(A.top, B.top, f), bot: mix(A.bot, B.bot, f), gr: mix(A.gr, B.gr, f) };
    }
  }
  const L = SKY[SKY.length - 1]!;
  return { top: L.top, bot: L.bot, gr: L.gr };
}

/**
 * A colour pixel scene (FRAME_W x FRAME_H) for a frame without photos:
 * sky by time-of-day `t` (0 = dawn … 1 = night), ground and the icon sprite.
 * Drawn at half resolution and doubled so pixels stay chunky.
 */
export function iconScene(icon: IconName, t: number, seed = 0): ImageData {
  const W = FRAME_W / 2;
  const H = FRAME_H / 2;
  const GY = H - 10;
  const s = skyAt(t);
  const cols = [0, 1, 2, 3, 4].map((k) => mix(s.top, s.bot, k / 4));
  const small = createImageData(W, H);
  const d = small.data;
  const grTop = mix(s.gr, [255, 255, 255], 0.22);
  const grDk = mix(s.gr, [0, 0, 0], 0.25);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let c: RGB;
      if (y < GY) {
        const v = (y / (GY - 1)) * 4;
        const b0 = Math.floor(v);
        const fr = v - b0;
        c = cols[Math.min(4, b0 + (fr > BAYER4[(y & 3) * 4 + (x & 3)]! / 16 ? 1 : 0))]!;
      } else if (y === GY) c = grTop;
      else c = hash(x * 7 + y * 13 + seed) > 0.8 ? grDk : s.gr;
      putPixel(d, W, x, y, c);
    }
  // celestial body
  const disc = (cx: number, cy: number, r: number, c: RGB) => {
    for (let dy = -r; dy <= r; dy++) {
      const w = Math.floor(Math.sqrt(r * r + r * 0.8 - dy * dy));
      for (let dx = -w; dx <= w; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < W && y >= 0 && y < GY) putPixel(d, W, x, y, c);
      }
    }
  };
  if (t > 0.7) {
    for (let k = 0; k < 12; k++)
      putPixel(d, W, Math.floor(hash(k * 3 + seed * 17) * W), Math.floor(hash(k * 11 + seed) * 24), [255, 251, 232]);
    disc(52, 8, 4, [238, 234, 255]);
    disc(54, 7, 3, cols[0]!);
  } else {
    disc(50, Math.round(6 + Math.abs(t - 0.33) * 30), 4, t > 0.5 ? [255, 207, 122] : [255, 241, 184]);
  }
  // sprite at scale 2 standing on the ground
  const rows = SPRITES[icon] ?? SPRITES.star;
  const ox = 16;
  const oy = GY - 30;
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const col = SPRITE_PALETTE[row[i]!];
      if (!col) continue;
      const c = hex(col);
      for (let a = 0; a < 2; a++)
        for (let b = 0; b < 2; b++) {
          const x = ox + i * 2 + a;
          const y = oy + j * 2 + b;
          if (x >= 0 && x < W && y >= 0 && y < H) putPixel(d, W, x, y, c);
        }
    }
  });
  // upscale x2 (nearest)
  const out = createImageData(FRAME_W, FRAME_H);
  for (let y = 0; y < FRAME_H; y++)
    for (let x = 0; x < FRAME_W; x++) {
      const si = ((y >> 1) * W + (x >> 1)) * 4;
      const di = (y * FRAME_W + x) * 4;
      out.data[di] = d[si]!;
      out.data[di + 1] = d[si + 1]!;
      out.data[di + 2] = d[si + 2]!;
      out.data[di + 3] = 255;
    }
  return out;
}

/** Cover-fit any drawable (photo) into an ImageData of w x h. Throws on tainted (non-CORS) images. */
export function sourceToImageData(src: CanvasImageSource & { width: number; height: number }, w = FRAME_W, h = FRAME_H): ImageData {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const sw = (src as HTMLImageElement).naturalWidth || src.width;
  const sh = (src as HTMLImageElement).naturalHeight || src.height;
  const scale = Math.max(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return ctx.getImageData(0, 0, w, h);
}

export type DitherOptions = {
  /** 0..1 how far the print has developed (shadows appear first). */
  level?: number;
  /** Tone curve: luminance below `black` → solid ink, above `white` → paper. */
  black?: number;
  white?: number;
  paper?: RGB;
  ink?: RGB;
};

/**
 * Two-tone ordered dither (paper / ink), the "developed print" look of concept B.
 * `level` < 1 renders a partially developed print: only darker tones have appeared.
 */
export function ditherPrint(src: ImageData, opts: DitherOptions = {}, out?: ImageData): ImageData {
  const { level = 1, black = 0.12, white = 0.88, paper = PAPER, ink = INK } = opts;
  const W = src.width;
  const H = src.height;
  const o = out ?? createImageData(W, H);
  const s = src.data;
  const d = o.data;
  const span = Math.max(0.01, white - black);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4;
      const lum = (s[k]! * 0.3 + s[k + 1]! * 0.59 + s[k + 2]! * 0.11) / 255;
      const dark = Math.max(0, Math.min(1, (white - lum) / span)) * level;
      const c = dark > (BAYER8[(y & 7) * 8 + (x & 7)]! + 0.5) / 64 ? ink : paper;
      d[k] = c[0];
      d[k + 1] = c[1];
      d[k + 2] = c[2];
      d[k + 3] = 255;
    }
  return o;
}

/** Negative of a print under safelight: paper → deep red film base, ink → red-orange highlight. */
export function negativeOf(print: ImageData, out?: ImageData): ImageData {
  const W = print.width;
  const H = print.height;
  const o = out ?? createImageData(W, H);
  const base = hex(DARKROOM.filmBase);
  const hi = hex(DARKROOM.led);
  const s = print.data;
  const d = o.data;
  for (let k = 0; k < s.length; k += 4) {
    const lum = (s[k]! + s[k + 1]! + s[k + 2]!) / 765;
    const c = mix(hi, base, lum);
    d[k] = c[0];
    d[k + 1] = c[1];
    d[k + 2] = c[2];
    d[k + 3] = 255;
  }
  return o;
}

/** Load an image with CORS so it can be read back from a canvas. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

/** Paint ImageData into a canvas element (resizing the canvas if needed). */
export function paint(canvas: HTMLCanvasElement, data: ImageData): void {
  if (canvas.width !== data.width) canvas.width = data.width;
  if (canvas.height !== data.height) canvas.height = data.height;
  canvas.getContext("2d")!.putImageData(data, 0, 0);
}
