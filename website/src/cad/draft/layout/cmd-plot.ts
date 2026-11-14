/**
 * BALÍK 3 (layout) – TISK (PLOT, Ctrl+P) a EXPORT-PDF: rozvržení 1:1 na papír (nebo na jiný formát s měřítkem / Vejít),
 * model (okno / rozsah v měřítku); výstup PDF (vektorově), PNG (rastr v DPI), SVG. V GUI bez zadání otevře panel Tisk
 * s náhledem; textem vrací soubor v `results[].data.file` (base64 / text) a údaje tisku v `data.plot`.
 */
import { tr } from "../../i18n";
import { registerCommand, type CmdCtx } from "../commands";
import type { DraftModel, Vec2 } from "../model";
import { currentLayout } from "./cmd-layout";
import { pagesToPdf } from "./pdf";
import { plotLayoutObj, plotModel, type PlotOpts, type PlotPage, type PlotStyle } from "./plot";
import { pageToPng, pageToSvg } from "./raster";
import { findLayout, layoutsOf, parseSheet } from "./sheets";
import { activeViewport } from "./state";
import { fold, isW, parseRatio } from "./util";

const toB64 = (u8: Uint8Array) => {
  let b = "";
  for (let i = 0; i < u8.length; i += 0x8000) b += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(b);
};
const safe = (s: string) => (s || "vykres").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(0, 80);

export type PlotRequest = PlotOpts & { target: { kind: "layout"; id: string } | { kind: "model" } | { kind: "all" }; format: "pdf" | "png" | "svg"; dpi?: number; name?: string };

/** styl tisku z tabulky stylů rozvržení */
export const styleFromTable = (t: string | undefined): PlotStyle => (/mono/i.test(t ?? "") ? "mono" : /gray|grey|šed/i.test(t ?? "") ? "gray" : "color");

/** zápis tisku z argumentů (společné pro TISK a EXPORT-PDF) */
export function parsePlotArgs(c: CmdCtx, a: string[], defAll = false): PlotRequest {
  const m = c.tx.model;
  const cur = currentLayout(c);
  const inLayout = c.session.space.startsWith("layout:") || !!activeViewport(c.session, m);
  const req: PlotRequest = { target: defAll ? { kind: "all" } : inLayout && cur ? { kind: "layout", id: cur.id } : { kind: "model" }, format: "pdf" };
  for (let i = 0; i < a.length; i++) {
    const t = a[i];
    const f = fold(t);
    if (isW(t, "rozvržení", "layout")) {
      const l = findLayout(m, a[++i] ?? "");
      if (!l) throw new Error(tr("rozvržení „{0}“ neexistuje – rozvržení: {1}", a[i] ?? "", layoutsOf(m).map((x) => x.name).join(", ") || "—"));
      req.target = { kind: "layout", id: l.id };
    } else if (isW(t, "model", "modell")) req.target = { kind: "model" };
    else if (isW(t, "vše", "vse", "all", "alle", "alles")) req.target = { kind: "all" };
    else if (isW(t, "aktuální", "aktualni", "current", "aktuell")) req.target = cur ? { kind: "layout", id: cur.id } : { kind: "model" };
    else if (["pdf", "png", "svg"].includes(f)) req.format = f as PlotRequest["format"];
    else if (parseSheet(t)) req.size = parseSheet(t)!.size;
    else if (isW(t, "na-šířku", "landscape", "quer")) req.landscape = true;
    else if (isW(t, "na-výšku", "portrait", "hoch")) req.landscape = false;
    else if (isW(t, "měřítko", "scale", "maßstab", "massstab")) {
      const v = a[++i] ?? "";
      req.ratio = isW(v, "vejít", "fit", "einpassen", "vejit") ? "fit" : parseRatio(v);
    } else if (isW(t, "vejít", "fit", "einpassen")) req.ratio = "fit";
    else if (isW(t, "mono", "černobíle", "monochrome", "schwarzweiß", "sw")) req.style = "mono";
    else if (isW(t, "barevně", "barva", "color", "farbe")) req.style = "color";
    else if (isW(t, "šedě", "šedá", "gray", "grayscale", "grau")) req.style = "gray";
    else if (isW(t, "tloušťky", "lineweights", "linienstärken")) req.lineweights = !isW(a[++i], "ne", "no", "nein", "0", "vyp", "off");
    else if (isW(t, "okno", "window", "fenster")) {
      const p = c.parsePoint(a[i + 1] ?? "");
      const q = c.parsePoint(a[i + 2] ?? "");
      if (!p || !q) throw new Error(tr("okno x,y x,y"));
      req.window = [p, q] as [Vec2, Vec2];
      req.target = { kind: "model" };
      i += 2;
    } else if (isW(t, "rozsah", "extents", "grenzen")) {
      req.window = undefined;
      req.target = { kind: "model" };
    } else if (isW(t, "dpi")) {
      const v = Number(a[++i]);
      if (!(v >= 30 && v <= 1200)) throw new Error(tr("DPI 30–1200"));
      req.dpi = v;
    } else if (isW(t, "název", "nazev", "name", "soubor", "file", "datei")) req.name = a[++i];
    else throw new Error(tr("neznámé zadání tisku „{0}“ – rozvržení X, model, vše, pdf/png/svg, A4–A0, na-šířku, měřítko 1:1|vejít, mono|barevně|šedě, tloušťky ano|ne, okno x,y x,y, dpi N, název X", t));
  }
  return req;
}

/** stránky tisku podle požadavku (rozvržení s výchozím stylem z vzhledu stránky) */
export function plotPages(m: DraftModel, req: PlotRequest): PlotPage[] {
  const one = (id: string): PlotPage => {
    const l = findLayout(m, id)!;
    const o: PlotOpts = { ...req, style: req.style ?? styleFromTable(l.plot?.styleTable), lineweights: req.lineweights ?? l.plot?.lineweights !== false };
    if (o.ratio === undefined && typeof l.plot?.scale === "number" && l.plot.scale !== 1) o.ratio = l.plot.scale;
    return plotLayoutObj(m, l, o);
  };
  if (req.target.kind === "layout") return [one(req.target.id)];
  if (req.target.kind === "all") {
    const ls = layoutsOf(m);
    if (ls.length) return ls.map((l) => one(l.id));
  }
  return [plotModel(m, { ...req, style: req.style ?? "color" })];
}

/** provede tisk: soubor + údaje pro agenty */
export async function runPlot(c: CmdCtx, req: PlotRequest): Promise<void> {
  const m = c.tx.model;
  const pages = plotPages(m, req);
  const base = safe(req.name ?? `${c.ui?.docName?.() ?? tr("výkres")}${pages.length === 1 ? `-${pages[0].name}` : ""}`);
  let file: { name: string; mime: string; data: Uint8Array | string };
  if (req.format === "pdf") file = { name: `${base}.pdf`, mime: "application/pdf", data: await pagesToPdf(pages, { title: req.name ?? pages.map((p) => p.name).join(", ") }) };
  else if (req.format === "svg") file = { name: `${base}.svg`, mime: "image/svg+xml", data: pageToSvg(pages[0], pages[0].name) };
  else file = { name: `${base}.png`, mime: "image/png", data: await pageToPng(pages[0], req.dpi ?? 150) };
  const bytes = typeof file.data === "string" ? new TextEncoder().encode(file.data).length : file.data.length;
  c.out("plot", pages.map((p) => ({ name: p.name, w: p.w, h: p.h, scale: p.scale, ratio: p.ratio, items: p.items.length })));
  c.out("file", { name: file.name, mime: file.mime, bytes, ...(typeof file.data === "string" ? { text: file.data } : { base64: toB64(file.data) }) });
  c.ui?.download?.(file.name, file.data, file.mime);
  const p0 = pages[0];
  c.log(tr("✓ {0}: {1} stran, {2}×{3} mm, měřítko {4} ({5} kB)", file.name, pages.length, Math.round(p0.w * 10) / 10, Math.round(p0.h * 10) / 10, p0.ratio, Math.max(1, Math.round(bytes / 1024))));
}

registerCommand({
  id: "PLOT",
  names: { cs: ["tisk", "tisknout"], en: ["plot", "print"], de: ["plot", "drucken"] },
  group: "output",
  readonly: true,
  desc: () => tr("tisk do PDF (vektorově, tloušťky v mm, přesné měřítko), PNG nebo SVG: aktuální rozvržení 1:1, jiné rozvržení, model (rozsah / okno) v měřítku; volby formát A4–A0, orientace, měřítko 1:1 / vejít, mono / barevně / šedě, tloušťky; v GUI bez zadání panel Tisk s náhledem (Ctrl+P)"),
  usage: () => tr("tisk | tisk rozvržení Výroba mono | tisk model okno 0,0 200,100 A4 měřítko 1:2 | tisk png dpi 300 | tisk svg"),
  async: async (c, a) => {
    if (!a.length && c.interactive && c.ui?.openPanel) {
      c.ui.openPanel("plot");
      return c.log(tr("panel Tisk – nastavte a stiskněte Tisk PDF"));
    }
    await runPlot(c, parsePlotArgs(c, a));
  },
});

registerCommand({
  id: "EXPORTPDF",
  names: { cs: ["export-pdf"], en: ["exportpdf"], de: ["pdfexport"] },
  group: "output",
  readonly: true,
  desc: () => tr("export všech rozvržení do jednoho vícestránkového PDF (každá strana svým formátem, 1:1); bez rozvržení model; volby jako TISK (aktuální, rozvržení X, mono, název)"),
  usage: () => tr("export-pdf | export-pdf mono | export-pdf aktuální | export-pdf název \"Sada výkresů\""),
  async: async (c, a) => {
    const req = parsePlotArgs(c, a, true);
    req.format = "pdf";
    await runPlot(c, req);
  },
});
