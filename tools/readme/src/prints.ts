import { frameStamp, timelineFrames, type Content } from "@pho0m/content";
import { FRAME_H, FRAME_W, clearLevels, developingBits, iconSource, photoSource, type PrintSource } from "./image/darkroom.ts";
import { bitsDataUri, decodeLuma, grayDataUri } from "./image/print.ts";
import type { MediaLoader } from "./media.ts";
import type { FilmFrame } from "./model.ts";
import type { FilmPrint } from "./svg/film.ts";
import { FILM } from "./svg/theme.ts";
import { DEV_LEVELS, type GifPrint } from "./gif/film.ts";

/** Time of day for a generated scene: dawn for the oldest frame on the roll, night for the newest (as on the site). */
export const sceneTime = (i: number, n: number): number => (n > 1 ? i / (n - 1) : 0);

/** Print sources for one frame: the README film card (2x for sharp screens) and the GIF (FRAME size). */
export type FrameSources = { card: PrintSource; gif: PrintSource };

/** Photo prints for the film card are this size (2x FRAME, shown at FRAME size). */
const CARD_W = FRAME_W * 2;
const CARD_H = FRAME_H * 2;
/** Developing stages embedded in the film card. */
const CARD_DEV_LEVELS = [0.45, 1];

/**
 * The frame's first image when it is a JPEG/PNG this tool can decode, else the generated
 * pixel scene (the same fallback the site uses when a photo cannot be read).
 */
export async function frameSources(content: Content, f: FilmFrame, media: MediaLoader, warn: (m: string) => void): Promise<FrameSources> {
  const all = timelineFrames(content);
  const i = Math.max(0, f.number - 1);
  const img = f.frame.images[0];
  if (img) {
    const m = await media(img.url);
    if (m) {
      try {
        const gray = decodeLuma(m.bytes);
        return { card: photoSource(gray, CARD_W, CARD_H), gif: photoSource(gray, FRAME_W, FRAME_H) };
      } catch {
        warn(`[readme] frame "${f.frame.id}": ${m.mime} can't be decoded here (JPEG/PNG only); the README film shows its pixel scene`);
      }
    }
  }
  const scene = iconSource(f.frame.icon, sceneTime(i, all.length), i);
  return { card: scene, gif: scene };
}

/** Film-card print: clear greyscale levels (duotone/negative filters do the colour) + developing dithers. */
export function filmPrint(src: PrintSource): FilmPrint {
  const clear = clearLevels(src);
  const { width, height } = src.gray;
  return {
    clear: src.photo ? grayDataUri(clear, width, height) : grayDataUri(clear, width, height, 2),
    developing: CARD_DEV_LEVELS.map((l) => bitsDataUri(developingBits(src, l), FRAME_W, FRAME_H, 2, FILM.paper, FILM.ink)),
    pixelated: !src.photo,
  };
}

/** GIF print: clear levels at FRAME size and the dither stages it develops through. */
export function gifPrint(f: FilmFrame, src: PrintSource): GifPrint {
  return {
    number: f.number,
    date: f.date,
    stamp: frameStamp(f.frame),
    title: f.title,
    clear: clearLevels(src),
    developing: DEV_LEVELS.map((l) => developingBits(src, l)),
  };
}
