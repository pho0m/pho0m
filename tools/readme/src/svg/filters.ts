import { duotoneAt, negativeAt, type Rgb } from "../image/darkroom.ts";

/**
 * SVG filters that turn any embedded image into a darkroom print, so every upload format the
 * browser can show (JPEG, PNG, WebP, AVIF, GIF…) gets the same look:
 *   duotone   luminance → ink #2b1d17 … paper #efe7d8 (the clear, continuous-tone print)
 *   negative  luminance → the red safelight negative the site shows off the gate
 *   posterize luminance → two flat tones (a "still developing" stand-in for undecodable images)
 * Pre-toned greyscale prints go through the same duotone filter (grey g → luminance g).
 */

const f4 = (v: number) => {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? "0" : String(r);
};

/** feColorMatrix mapping luminance L (site weights 0.3/0.59/0.11) to from + (to - from) * L. */
function lumaMatrix(from: Rgb, to: Rgb): string {
  const rows = [0, 1, 2].map((c) => {
    const span = (to[c]! - from[c]!) / 255;
    return [span * 0.3, span * 0.59, span * 0.11, 0, from[c]! / 255].map(f4).join(" ");
  });
  return [...rows, "0 0 0 1 0"].join(" ");
}

const filter = (id: string, inner: string) =>
  `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">${inner}</filter>`;

export function duotoneFilter(id: string): string {
  return filter(id, `<feColorMatrix type="matrix" values="${lumaMatrix(duotoneAt(0), duotoneAt(1))}"/>`);
}

export function negativeFilter(id: string): string {
  return filter(id, `<feColorMatrix type="matrix" values="${lumaMatrix(negativeAt(0), negativeAt(1))}"/>`);
}

export function posterizeFilter(id: string): string {
  const ink = duotoneAt(0);
  const paper = duotoneAt(1);
  const fn = (c: number) => {
    const tv = [ink[c]!, ink[c]!, paper[c]!, paper[c]!].map((v) => f4(v / 255)).join(" ");
    return `<feFunc${"RGB"[c]} type="discrete" tableValues="${tv}"/>`;
  };
  return filter(
    id,
    `<feColorMatrix type="matrix" values="${lumaMatrix([0, 0, 0], [255, 255, 255])}"/><feComponentTransfer>${fn(0)}${fn(1)}${fn(2)}</feComponentTransfer>`,
  );
}
