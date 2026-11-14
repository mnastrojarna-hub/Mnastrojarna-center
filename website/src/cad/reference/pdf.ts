/**
 * Vektorové PDF jako předloha: stránky (cesty z pdf-vector.ts + texty z pdf.js getTextContent) → 2D model v mm
 * (osa Y nahoru, stránky pod sebou s mezerou). Čárkované cesty (setDash) dostanou typ čáry skrytá / osa, každá stránka
 * je jeden list (ext.pdfPages). Načtení stránek knihovnou pdf.js (`readPdfPages`) dostane modul pdf.js zvenku – v
 * prohlížeči `loadPdfJs()`, v testech sestavení „legacy“ pro Node.
 */
import { extractPdfPaths, pdfPathsToEntities, type Mat, type PdfOpList, type PdfPath } from "../pdf-vector";
import { newDraftModel } from "../draft/doc";
import { circle3 } from "../draft/geom";
import type { DraftEntity, DraftModel, Vec2 } from "../draft/model";
import type { RefBox } from "./types";

export type PdfTextItem = { str: string; transform: number[]; width?: number; height?: number };
export type PdfPageData = { paths: PdfPath[]; texts: PdfTextItem[]; view: Mat; w: number; h: number };

declare module "../draft/model" {
  interface DraftDocExt {
    /** předloha z PDF: obdélníky stránek v souřadnicích modelu [mm] */
    pdfPages?: RefBox[];
  }
}

const PT = 25.4 / 72;
/** hladina tenkých plných čar PDF (kóty, šrafy) – do geometrie pohledů nepatří */
export const PDF_THIN = "PDF_THIN";
const GAP = 20;

/** typ čáry podle vzoru čárkování: dlouhá-krátká (≥ 4 prvky nebo poměr > 3) = osa, jinak skrytá */
const dashType = (d: number[] | undefined): string | undefined => {
  if (!d?.length) return undefined;
  if (d.length >= 4) return "CENTER";
  const mx = Math.max(...d);
  const mn = Math.min(...d);
  return mx / Math.max(mn, 1e-9) > 3 && d.length > 2 ? "CENTER" : "HIDDEN";
};

/** stránky PDF → 2D model (mm, Y nahoru); stránka i leží pod stránkou i − 1 */
export function pdfPagesToDraft(pages: PdfPageData[]): DraftModel {
  const m = newDraftModel({ units: "mm" } as never);
  const ents: DraftEntity[] = [];
  let seq = 0;
  const id = () => `e${++seq}`;
  const frames: RefBox[] = [];
  let top = 0;
  for (const pg of pages) {
    const H = pg.h * PT;
    const W = pg.w * PT;
    const y0 = top - H;
    frames.push({ x0: 0, y0, x1: W, y1: top });
    const toMm = (p: Vec2): Vec2 => [p[0] * PT, top - p[1] * PT];
    // tenké plné čáry (kóty, šrafy, pomocné) od tlustých obrysů: tloušťka pod 70 % nejtlustší (jsou-li na stránce aspoň dvě)
    const widths = pg.paths.filter((p) => p.stroke && !p.dash && p.width !== undefined).map((p) => p.width!);
    const wMax = widths.length ? Math.max(...widths) : 0;
    const wMin = widths.length ? Math.min(...widths) : 0;
    const thin = (p: PdfPath) => !p.dash && wMax > 0 && wMax - wMin > 0.05 * wMax && (p.width ?? wMax) < 0.7 * wMax;
    for (const lt of [undefined, "THIN", "HIDDEN", "CENTER"]) {
      const paths = pg.paths.filter((p) => (lt === "THIN" ? thin(p) : !thin(p) && dashType(p.dash) === lt));
      if (!paths.length) continue;
      const r = pdfPathsToEntities(paths, toMm, { tol: 0.01, minLen: 0.05, max: 20000 });
      const props = lt === "THIN" ? { layer: PDF_THIN } : { layer: "0", ...(lt ? { linetype: lt } : {}) };
      for (const e of r.entities) {
        if (e.type === "line") ents.push({ id: id(), type: "line", a: e.a, b: e.b, ...props } as DraftEntity);
        else if (e.type === "polyline") ents.push({ id: id(), type: "polyline", pts: e.points, ...(e.closed ? { closed: true } : {}), ...props } as DraftEntity);
        else if (e.type === "circle") ents.push({ id: id(), type: "circle", c: [e.cx, e.cy], r: e.r, ...props } as DraftEntity);
        else if (e.type === "arc") {
          const k = circle3(e.a, e.b, e.c);
          if (!k) {
            ents.push({ id: id(), type: "line", a: e.a, b: e.c, ...props } as DraftEntity);
            continue;
          }
          const ang = (q: Vec2) => (Math.atan2(q[1] - k.c[1], q[0] - k.c[0]) * 180) / Math.PI;
          const ccw = (e.b[0] - e.a[0]) * (e.c[1] - e.a[1]) - (e.b[1] - e.a[1]) * (e.c[0] - e.a[0]) > 0;
          const n360 = (a: number) => ((a % 360) + 360) % 360;
          const [a0, a1] = ccw ? [ang(e.a), ang(e.c)] : [ang(e.c), ang(e.a)];
          ents.push({ id: id(), type: "arc", c: k.c, r: k.r, a0: n360(a0), a1: n360(a1), ...props } as DraftEntity);
        } else if (e.type === "spline") ents.push({ id: id(), type: "polyline", pts: e.points, ...props } as DraftEntity);
      }
    }
    // texty: počátek a natočení z matice textu × transformace stránky (Y dolů) → mm s osou Y nahoru
    const v = pg.view;
    for (const t of pg.texts) {
      const s = (t.str ?? "").trim();
      if (!s || !Array.isArray(t.transform) || t.transform.length < 6) continue;
      const [a, b, c, d, e, f] = t.transform;
      const px = v[0] * e + v[2] * f + v[4];
      const py = v[1] * e + v[3] * f + v[5];
      const dx = v[0] * a + v[2] * b;
      const dy = v[1] * a + v[3] * b;
      const hx = v[0] * c + v[2] * d;
      const hy = v[1] * c + v[3] * d;
      const h = Math.hypot(hx, hy) * PT || 2.5;
      let rot = (Math.atan2(-dy, dx) * 180) / Math.PI;
      if (rot < 0) rot += 360;
      ents.push({ id: id(), type: "text", layer: "0", p: [px * PT, top - py * PT], h, s, ...(Math.abs(rot) > 1e-6 && Math.abs(rot - 360) > 1e-6 ? { rot } : {}) } as DraftEntity);
    }
    top = y0 - GAP;
  }
  const layers = [...m.layers, { name: PDF_THIN, color: 8, linetype: "Continuous", lineweight: 0.18 as const, on: true, frozen: false, locked: false, plot: true }];
  return { ...m, layers, entities: ents, seq, ext: { ...(m.ext ?? {}), source: { format: "pdf" } as never, pdfPages: frames } };
}

/** modul pdf.js – jen to, co předloha potřebuje (getDocument, OPS) */
export type PdfJsLike = {
  getDocument: (o: { data: Uint8Array; [k: string]: unknown }) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<PdfPageLike>; destroy?: () => Promise<void> | void }> };
  OPS: Record<string, number>;
};
type PdfPageLike = {
  getViewport: (o: { scale: number }) => { width: number; height: number; transform: number[] };
  getOperatorList: () => Promise<PdfOpList>;
  getTextContent: () => Promise<{ items: unknown[] }>;
};

/** stránky PDF knihovnou pdf.js (nejvýš `maxPages`) */
export async function readPdfPages(pdfjs: PdfJsLike, bytes: Uint8Array, opts: { maxPages?: number; docOptions?: Record<string, unknown> } = {}): Promise<PdfPageData[]> {
  const doc = await pdfjs.getDocument({ ...(opts.docOptions ?? {}), data: bytes.slice() }).promise;
  const out: PdfPageData[] = [];
  try {
    const n = Math.min(doc.numPages, opts.maxPages ?? 50);
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const view = vp.transform.slice(0, 6) as Mat;
      const ops = await page.getOperatorList();
      const tc = await page.getTextContent();
      const texts = (tc.items as PdfTextItem[]).filter((it) => typeof it?.str === "string");
      out.push({ paths: extractPdfPaths(ops, pdfjs.OPS, view), texts, view, w: vp.width, h: vp.height });
    }
  } finally {
    await doc.destroy?.();
  }
  return out;
}
