import type { IconName, Project } from "@pho0m/content";
import { createImageData } from "../../lib/pixel.ts";
import { iconSource, type PrintSource } from "../../lib/print.ts";
import { clearOf, photoPrintSource } from "../ui/images.ts";

/** Pixel scene for a project without a photo, by group (client work never shows a screenshot). */
const GROUP_ICON: Record<string, IconName> = {
  utotech: "rocket",
  client: "brief",
  school: "cap",
  personal: "code",
  coop: "laptop",
  teaching: "board",
};

export function iconFor(p: Pick<Project, "group">): IconName {
  return Object.hasOwn(GROUP_ICON, p.group) ? GROUP_ICON[p.group]! : "star";
}

/** Stable 0..1 per id: the time of day of its scene and the scatter of its ground. */
export function idHash(id: string): number {
  let h = 2166136261;
  for (let k = 0; k < id.length; k++) {
    h ^= id.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const icons = new Map<string, PrintSource>();

/** The print source the bench shows for a project (its pixel scene; see photoFor for photos). */
export function sceneFor(p: Pick<Project, "id" | "group">): PrintSource {
  const icon = iconFor(p);
  const key = `${p.id}|${icon}`;
  let src = icons.get(key);
  if (!src) {
    const h = idHash(p.id);
    // daylight to dusk only: night scenes are too dark to read as a print at bench size
    src = iconSource(icon, 0.1 + h * 0.6, Math.floor(h * 997));
    icons.set(key, src);
  }
  return src;
}

/** The project's own photo as a print, when it has one and is not client work (NDA: text only). */
export function photoFor(
  p: Pick<Project, "image" | "group">,
  dev: { w: number; h: number },
): Promise<PrintSource> | null {
  if (!p.image || p.group === "client") return null;
  return photoPrintSource(p.image.url, 192, 132, { dev });
}

const thumbs = new WeakMap<PrintSource, HTMLCanvasElement>();

/** The finished (clear) print scaled to the bench size, drawn once per source and size. */
export function clearThumb(src: PrintSource, w: number, h: number): HTMLCanvasElement | null {
  const hit = thumbs.get(src);
  if (hit && hit.width === w && hit.height === h) return hit;
  if (typeof document === "undefined") return null;
  const full = clearOf(src);
  const big = document.createElement("canvas");
  big.width = full.width;
  big.height = full.height;
  const bctx = big.getContext("2d");
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d");
  if (!bctx || !octx) return null;
  bctx.putImageData(full, 0, 0);
  octx.imageSmoothingEnabled = src.photo;
  octx.drawImage(big, 0, 0, w, h);
  thumbs.set(src, out);
  return out;
}

/** A reusable pixel buffer for the developing dither at bench size. */
export function benchBuffer(w: number, h: number): ImageData {
  return createImageData(w, h);
}
