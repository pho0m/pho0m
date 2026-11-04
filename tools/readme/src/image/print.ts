import { autoLevels, ditherBits, orient, portraitCrop, resampleSquare, type Gray } from "./gray.ts";
import { decodeJpegLuma } from "./jpeg.ts";
import { decodePngLuma, encodeTwoTonePng, isPng } from "./png.ts";

export type Print = { bits: Uint8Array; size: number };

/** Detect an image type from its first bytes. */
export function sniffMime(bytes: Uint8Array): string | null {
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b));
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (isPng(bytes)) return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(4, 12) === "ftypavif") return "image/avif";
  if (/^\s*(<\?xml|<svg)/.test(ascii(0, 64))) return "image/svg+xml";
  return null;
}

/** Decode JPEG (baseline) or PNG to luminance. Throws for anything else. */
export function decodeLuma(bytes: Uint8Array): Gray {
  const mime = sniffMime(bytes);
  if (mime === "image/jpeg") {
    const img = decodeJpegLuma(bytes);
    return orient(img, img.orientation);
  }
  if (mime === "image/png") return decodePngLuma(bytes);
  throw new Error(`cannot decode ${mime ?? "unknown"} images`);
}

/** A square two-tone print of a portrait, `size` x `size` dither cells. Null when the file can't be decoded. */
export function portraitPrint(bytes: Uint8Array, size: number): Print | null {
  try {
    const img = decodeLuma(bytes);
    const small = resampleSquare(img, portraitCrop(img.width, img.height), size);
    return { bits: ditherBits(autoLevels(small)), size };
  } catch {
    return null;
  }
}

/** PNG data URI of a print, each cell drawn as `scale` x `scale` pixels. */
export function printDataUri(print: Print, scale: number, paper: string, ink: string): string {
  const png = encodeTwoTonePng(print.bits, print.size, print.size, scale, paper, ink);
  return `data:image/png;base64,${png.toString("base64")}`;
}
