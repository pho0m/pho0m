declare module "subset-font" {
  export type SubsetFontOptions = {
    targetFormat?: "sfnt" | "truetype" | "woff" | "woff2";
    keepFeatures?: string[];
    noLayoutClosure?: boolean;
    noHinting?: boolean;
    dropTables?: string[];
  };
  /** Subset a font (TTF/OTF/WOFF/WOFF2) to the code points in `text` (harfbuzz hb-subset). */
  export default function subsetFont(font: Uint8Array, text: string, options?: SubsetFontOptions): Promise<Buffer>;
}
