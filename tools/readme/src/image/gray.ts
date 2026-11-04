/**
 * Luminance images (0 = black … 1 = white) and the darkroom print look:
 * crop → area-average downscale → levels → 8x8 Bayer two-tone dither,
 * the same tone curve as the website's ditherPrint (web/src/lib/pixel.ts).
 */
export type Gray = { width: number; height: number; data: Float32Array };

/**
 * Standard (dispersed-dot) 8x8 Bayer matrix, values 0..63; row 0 is 0,32,8,40,2,34,10,42.
 * The least significant coordinate bits become the most significant threshold bits.
 */
export const BAYER8: number[] = (() => {
  const m: number[] = [];
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      let v = 0;
      for (let bit = 0; bit < 3; bit++) v = (v << 2) | ((((x ^ y) >> bit) & 1) << 1) | ((y >> bit) & 1);
      m.push(v);
    }
  return m;
})();

/** Apply an EXIF orientation (1–8) so the image is upright. */
export function orient(img: Gray, orientation: number): Gray {
  if (orientation <= 1 || orientation > 8) return img;
  const { width: w, height: h, data } = img;
  const swap = orientation >= 5;
  const W = swap ? h : w;
  const H = swap ? w : h;
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sx: number;
      let sy: number;
      switch (orientation) {
        case 2: sx = w - 1 - x; sy = y; break;
        case 3: sx = w - 1 - x; sy = h - 1 - y; break;
        case 4: sx = x; sy = h - 1 - y; break;
        case 5: sx = y; sy = x; break;
        case 6: sx = y; sy = h - 1 - x; break;
        case 7: sx = w - 1 - y; sy = h - 1 - x; break;
        default: sx = w - 1 - y; sy = x; break; // 8
      }
      out[y * W + x] = data[sy * w + sx]!;
    }
  return { width: W, height: H, data: out };
}

export type Crop = { x: number; y: number; size: number };

/**
 * Square portrait crop: `zoom` of the shorter side, centred horizontally and placed
 * a little above centre (faces sit in the upper part of most portraits).
 */
export function portraitCrop(width: number, height: number, zoom = 0.6): Crop {
  const size = Math.max(1, Math.round(Math.min(width, height) * zoom));
  const x = Math.round((width - size) / 2);
  const y = Math.round(Math.max(0, Math.min(height - size, (height - size) * 0.15)));
  return { x, y, size };
}

/** Area-average a square region down to n x n. */
export function resampleSquare(img: Gray, crop: Crop, n: number): Gray {
  const out = new Float32Array(n * n);
  const step = crop.size / n;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const x0 = Math.floor(crop.x + x * step);
      const y0 = Math.floor(crop.y + y * step);
      const x1 = Math.max(x0 + 1, Math.floor(crop.x + (x + 1) * step));
      const y1 = Math.max(y0 + 1, Math.floor(crop.y + (y + 1) * step));
      let sum = 0;
      let count = 0;
      for (let sy = y0; sy < y1 && sy < img.height; sy++)
        for (let sx = x0; sx < x1 && sx < img.width; sx++) {
          sum += img.data[sy * img.width + sx]!;
          count++;
        }
      out[y * n + x] = count ? sum / count : 1;
    }
  return { width: n, height: n, data: out };
}

/**
 * Stretch tones so the 2nd–98th percentiles span the full range, then lift the mid-tones
 * (gamma < 1) so faces don't sink into the shadows of a two-tone print.
 */
export function autoLevels(img: Gray, low = 0.02, high = 0.98, gamma = 0.75): Gray {
  const sorted = Array.from(img.data).sort((a, b) => a - b);
  const lo = sorted[Math.floor(low * (sorted.length - 1))] ?? 0;
  const hi = sorted[Math.floor(high * (sorted.length - 1))] ?? 1;
  const span = Math.max(0.05, hi - lo);
  const data = img.data.map((v) => Math.max(0, Math.min(1, (v - lo) / span)) ** gamma);
  return { width: img.width, height: img.height, data };
}

/** Two-tone ordered dither. Returns 1 for ink, 0 for paper (same curve as ditherPrint). */
export function ditherBits(img: Gray, black = 0.12, white = 0.88): Uint8Array {
  const bits = new Uint8Array(img.width * img.height);
  const span = Math.max(0.01, white - black);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const lum = img.data[y * img.width + x]!;
      const dark = Math.max(0, Math.min(1, (white - lum) / span));
      bits[y * img.width + x] = dark > (BAYER8[(y & 7) * 8 + (x & 7)]! + 0.5) / 64 ? 1 : 0;
    }
  return bits;
}
