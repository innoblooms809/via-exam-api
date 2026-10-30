/**
 * Scan quality of an uploaded answer sheet (PDF).
 *
 * A handwritten sheet that is scanned at a low resolution, out of focus or too
 * faint still uploads fine, but the AI reads it badly. This check measures every
 * page so the teacher (and the admin) know when the AI marks need a careful look.
 *
 * Per page:
 *   • DPI       the scanned image's pixels over the size it is drawn at on the page.
 *               pdfjs gives both; the PDF's own "DPI" headers are not trusted.
 *   • sharpness how quickly ink edges go from paper to ink, 0–100. A sharp pen
 *               stroke changes in about one pixel at 150 DPI (≈100); a blurred one
 *               spreads over several (≈25 or less). Measured only on tiles that
 *               carry ink, so the white paper of a handwritten page doesn't read as
 *               blur, and divided by the tile's own contrast, so faint ink isn't.
 *   • contrast  paper brightness minus ink darkness, 0–255. Low = faint pencil or
 *               a washed-out scan.
 *   • brightness the paper's brightness, 0–255. Low = a dark or shadowed scan.
 *
 * pdfjs decodes the images in JavaScript, which keeps the CPU busy for a while
 * on a long booklet, so callers run this in a worker (sheetQuality.worker).
 */

import sharp from "sharp";
import type { ScanQualityRule } from "../models/InstituteSettings.model";

// ─── Thresholds ───────────────────────────────────────────────────────────────

export type { ScanQualityRule };

/**
 * Measured on test sheets: clean scans score 78–86 sharpness, a lightly blurred one
 * 66, a 72 DPI scan blown up to 300 DPI 60, an out-of-focus one 18–32.
 */
export const DEFAULT_SCAN_QUALITY: ScanQualityRule = {
  enabled: true,
  minDpi: 150,
  warnDpi: 200,
  minSharpness: 40,
  warnSharpness: 65,
  minContrast: 60,
};

// ─── Report ───────────────────────────────────────────────────────────────────

/** ok · warn: check the AI marks · low: the AI may misread this sheet · unchecked: nothing could be measured. */
export type QualityFlag = "ok" | "warn" | "low" | "unchecked";

export type PageIssue = "low_dpi" | "blurry" | "faint" | "dark" | "blank" | "no_scan";

export interface PageQuality {
  page: number;
  flag: QualityFlag;
  issues: PageIssue[];
  dpi: number | null;
  sharpness: number | null;
  contrast: number | null;
  brightness: number | null;
}

export interface SheetQualityReport {
  /** Bumped when the measures change, so old reports can be told apart. */
  version: number;
  flag: QualityFlag;
  /** One line per problem, for the teacher and the admin. */
  reasons: string[];
  pageCount: number;
  pages: PageQuality[];
  /** The thresholds the flag was set with. */
  rule: ScanQualityRule;
  checkedAt: string;
  ms: number;
}

export const SHEET_QUALITY_VERSION = 1;

// Booklets past this many pages are measured on their first pages only.
const MAX_PAGES = 60;
// Blur is measured at this resolution, or the scan's own if it is lower.
const ANALYSIS_DPI = 150;
const TILE = 48;

const RANK: Record<QualityFlag, number> = { unchecked: 0, ok: 1, warn: 2, low: 3 };

// ─── pdfjs ────────────────────────────────────────────────────────────────────

// pdfjs ships as ES modules only; a plain import() would be compiled to require().
const importEsm = new Function("s", "return import(s)") as (s: string) => Promise<any>;
let pdfjsPromise: Promise<any> | null = null;
const loadPdfjs = () => (pdfjsPromise ??= importEsm("pdfjs-dist/legacy/build/pdf.mjs"));

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m applied inside ctm (PDF "cm"). */
const concat = (m: number[], c: Matrix): Matrix => [
  m[0] * c[0] + m[1] * c[2],
  m[0] * c[1] + m[1] * c[3],
  m[2] * c[0] + m[3] * c[2],
  m[2] * c[1] + m[3] * c[3],
  m[4] * c[0] + m[5] * c[2] + c[4],
  m[4] * c[1] + m[5] * c[3] + c[5],
];

/** The image drawn over the largest part of the page, with the size it is drawn at (points). */
const findScanImage = (pdfjs: any, ops: { fnArray: number[]; argsArray: any[] }) => {
  const OPS = pdfjs.OPS;
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;
  let best: { objId: string; w: number; h: number } | null = null;

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? IDENTITY;
    else if (fn === OPS.transform) ctm = concat(args, ctm);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args?.[0]) && args[0].length === 6) ctm = concat(args[0], ctm);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? IDENTITY;
    else if (fn === OPS.paintImageXObject && typeof args?.[0] === "string") {
      const w = Math.hypot(ctm[0], ctm[1]);
      const h = Math.hypot(ctm[2], ctm[3]);
      if (!best || w * h > best.w * best.h) best = { objId: args[0], w, h };
    }
  }
  return best;
};

const getObj = (page: any, objId: string): Promise<any> =>
  new Promise((resolve, reject) => {
    const store = objId.startsWith("g_") ? page.commonObjs : page.objs;
    const timer = setTimeout(() => reject(new Error("image decode timed out")), 30_000);
    store.get(objId, (data: any) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

/** pdfjs image data as one grey byte per pixel. */
const toGray = (pdfjs: any, img: any): Uint8Array | null => {
  const { width, height, data, kind } = img ?? {};
  if (!data || !width || !height) return null;
  const n = width * height;
  const out = new Uint8Array(n);
  if (kind === pdfjs.ImageKind.GRAYSCALE_1BPP) {
    // Rows are padded to whole bytes; a set bit is white.
    const rowBytes = (width + 7) >> 3;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        out[y * width + x] = data[y * rowBytes + (x >> 3)] & (128 >> (x & 7)) ? 255 : 0;
      }
    }
    return out;
  }
  const channels = kind === pdfjs.ImageKind.RGBA_32BPP ? 4 : kind === pdfjs.ImageKind.RGB_24BPP ? 3 : 0;
  if (!channels || data.length < n * channels) return null;
  for (let i = 0, j = 0; i < n; i++, j += channels) {
    out[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  }
  return out;
};

// ─── Measures ─────────────────────────────────────────────────────────────────

const percentile = (hist: Uint32Array, total: number, p: number): number => {
  const target = total * p;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen >= target) return v;
  }
  return 255;
};

const median = (values: number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Sharpness, contrast and brightness of a grey page image. */
const measurePixels = (px: Uint8Array, width: number, height: number) => {
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i++) hist[px[i]]++;
  const paper = percentile(hist, px.length, 0.9);
  const ink = percentile(hist, px.length, 0.005);
  const contrast = paper - ink;

  // A tile counts as writing when its darkest pixels reach halfway to the ink;
  // ruled lines and paper texture stay above that.
  const inkCut = paper - Math.max(25, contrast * 0.5);
  const ratios: number[] = [];
  let tiles = 0;
  const tileHist = new Uint32Array(256);
  const grads: number[] = [];

  for (let ty = 0; ty + TILE <= height; ty += TILE) {
    for (let tx = 0; tx + TILE <= width; tx += TILE) {
      tiles++;
      tileHist.fill(0);
      for (let y = ty; y < ty + TILE; y++) {
        const row = y * width;
        for (let x = tx; x < tx + TILE; x++) tileHist[px[row + x]]++;
      }
      const area = TILE * TILE;
      const lo = percentile(tileHist, area, 0.02);
      if (lo > inkCut) continue;
      const hi = percentile(tileHist, area, 0.98);
      const span = hi - lo;
      if (span < 20) continue;

      // Steepest steps from paper to ink inside the tile.
      grads.length = 0;
      for (let y = ty; y < ty + TILE - 1; y++) {
        const row = y * width;
        for (let x = tx; x < tx + TILE - 1; x++) {
          const v = px[row + x];
          const g = Math.max(Math.abs(px[row + x + 1] - v), Math.abs(px[row + width + x] - v));
          if (g > 4) grads.push(g);
        }
      }
      if (grads.length < 8) continue;
      grads.sort((a, b) => b - a);
      const top = grads[Math.min(grads.length - 1, Math.floor(grads.length * 0.05))];
      ratios.push(Math.min(1, top / span));
    }
  }

  const blank = ratios.length < Math.max(3, tiles * 0.004);
  return {
    brightness: paper,
    contrast,
    sharpness: blank ? null : Math.round(median(ratios) * 100),
    blank,
  };
};

const flagPage = (p: Omit<PageQuality, "flag">, rule: ScanQualityRule): PageQuality => {
  const issues = [...p.issues];
  let flag: QualityFlag = "ok";
  const raise = (to: QualityFlag) => {
    if (RANK[to] > RANK[flag]) flag = to;
  };

  if (issues.includes("no_scan")) return { ...p, issues, flag: "unchecked" };

  if (p.dpi != null && p.dpi < rule.minDpi) (issues.push("low_dpi"), raise("low"));
  else if (p.dpi != null && p.dpi < rule.warnDpi) (issues.push("low_dpi"), raise("warn"));

  if (!issues.includes("blank")) {
    if (p.sharpness != null && p.sharpness < rule.minSharpness) (issues.push("blurry"), raise("low"));
    else if (p.sharpness != null && p.sharpness < rule.warnSharpness) (issues.push("blurry"), raise("warn"));
    if (p.contrast != null && p.contrast < rule.minContrast) (issues.push("faint"), raise("low"));
  }
  if (p.brightness != null && p.brightness < 140) (issues.push("dark"), raise("warn"));

  return { ...p, issues, flag };
};

const pageList = (pages: number[]) =>
  pages.length === 1 ? `page ${pages[0]}` : `pages ${pages.slice(0, -1).join(", ")} and ${pages[pages.length - 1]}`;

const REASON: Record<Exclude<PageIssue, "blank" | "no_scan">, string> = {
  low_dpi: "scanned at a low resolution",
  blurry: "blurred or out of focus",
  faint: "too faint (light ink or a washed-out scan)",
  dark: "too dark",
};

const summarise = (pages: PageQuality[], rule: ScanQualityRule): string[] => {
  const reasons: string[] = [];
  for (const issue of Object.keys(REASON) as (keyof typeof REASON)[]) {
    const hit = pages.filter((p) => p.issues.includes(issue) && (p.flag === "warn" || p.flag === "low"));
    if (!hit.length) continue;
    let line = `${pageList(hit.map((p) => p.page))}: ${REASON[issue]}`;
    if (issue === "low_dpi") {
      const lowest = Math.min(...hit.map((p) => p.dpi ?? Infinity));
      line += ` (${lowest} DPI, ${rule.warnDpi}+ recommended)`;
    }
    reasons.push(line.charAt(0).toUpperCase() + line.slice(1));
  }
  return reasons;
};

// ─── Entry ────────────────────────────────────────────────────────────────────

export const analyzeSheetQuality = async (
  pdf: Uint8Array,
  rule: ScanQualityRule = DEFAULT_SCAN_QUALITY,
): Promise<SheetQualityReport> => {
  const started = Date.now();
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    // pdfjs takes ownership of (and detaches) the buffer it is given.
    data: new Uint8Array(pdf),
    verbosity: 0,
    isEvalSupported: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    // 600 DPI A4 is ~35 million pixels; anything larger is not a page scan.
    maxImageSize: 50_000_000,
  }).promise;

  const pages: PageQuality[] = [];
  try {
    const count = Math.min(doc.numPages, MAX_PAGES);
    for (let n = 1; n <= count; n++) {
      const page = await doc.getPage(n);
      const base: Omit<PageQuality, "flag"> = {
        page: n,
        issues: [],
        dpi: null,
        sharpness: null,
        contrast: null,
        brightness: null,
      };
      try {
        const [x0, y0, x1, y1] = page.view;
        const pageArea = Math.abs((x1 - x0) * (y1 - y0));
        const ops = await page.getOperatorList();
        const scan = findScanImage(pdfjs, ops);

        // A typed or vector page has no scan to measure.
        if (!scan || scan.w * scan.h < pageArea * 0.4) {
          pages.push(flagPage({ ...base, issues: ["no_scan"] }, rule));
          continue;
        }

        const img = await getObj(page, scan.objId);
        const gray = toGray(pdfjs, img);
        if (!gray) {
          pages.push(flagPage({ ...base, issues: ["no_scan"] }, rule));
          continue;
        }

        const dpi = Math.round(Math.min(img.width / (scan.w / 72), img.height / (scan.h / 72)));
        const scale = Math.min(1, ANALYSIS_DPI / Math.max(dpi, 1));
        const w = Math.max(TILE, Math.round(img.width * scale));
        const h = Math.max(TILE, Math.round(img.height * scale));
        const { data } = await sharp(gray, { raw: { width: img.width, height: img.height, channels: 1 } })
          .resize(w, h, { kernel: "lanczos3", fit: "fill" })
          // sharp writes sRGB (3 channels) unless told to keep one.
          .toColourspace("b-w")
          .raw()
          .toBuffer({ resolveWithObject: true });

        const m = measurePixels(new Uint8Array(data.buffer, data.byteOffset, data.length), w, h);
        pages.push(
          flagPage(
            {
              ...base,
              issues: m.blank ? ["blank"] : [],
              dpi,
              sharpness: m.sharpness,
              contrast: m.contrast,
              brightness: m.brightness,
            },
            rule,
          ),
        );
      } catch {
        pages.push(flagPage({ ...base, issues: ["no_scan"] }, rule));
      } finally {
        page.cleanup();
      }
    }

    const measured = pages.filter((p) => p.flag !== "unchecked");
    const flag = measured.reduce<QualityFlag>((worst, p) => (RANK[p.flag] > RANK[worst] ? p.flag : worst), measured.length ? "ok" : "unchecked");

    return {
      version: SHEET_QUALITY_VERSION,
      flag,
      reasons: summarise(pages, rule),
      pageCount: doc.numPages,
      pages,
      rule,
      checkedAt: new Date().toISOString(),
      ms: Date.now() - started,
    };
  } finally {
    await doc.destroy();
  }
};
