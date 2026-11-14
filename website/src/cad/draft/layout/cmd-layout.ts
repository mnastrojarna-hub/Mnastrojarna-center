/**
 * BALÍK 3 (layout) – příkazy rozvržení a výřezů: ROZVRŽENÍ (nové / kopírovat / smazat / přejmenovat / nastavit /
 * seznam), VZHLED-STRÁNKY, VÝŘEZ (MVIEW: obdélník, vejít, 2 / 3 / 4, mnohoúhelník, objekt, zap / vyp, zamknout,
 * měřítko, střed), MODELOVÝ-PROSTOR / PAPÍROVÝ-PROSTOR (MSPACE / PSPACE), HLADINY-VÝŘEZU (VPLAYER).
 */
import { tr } from "../../i18n";
import { kw, registerCommand, type CmdCtx, type CmdGen, type Input } from "../commands";
import { cPoint, cRange } from "../curves";
import { boxOf, type Box } from "../geom";
import { entityCurves } from "../kinds";
import { findLayer } from "../layers";
import { spaceEntities, type DraftEntity, type DraftLayout, type DraftModel, type NewEntity, type Vec2 } from "../model";
import { extents } from "../status";
import { addLayout, copyLayout, drawingArea, findLayout, isFrameBlock, layoutsOf, parseSheet, setLayoutMargins, setLayoutPaper, sheetRect, syncTitleScale, TITLE_BLOCK, viewportFor, viewportsOffSheet } from "./sheets";
import { activeViewport, layoutState, setSpace } from "./state";
import type { DInsert, DViewport } from "./types";
import { fold, isW, parseRatio, ratioLabel, ratioToScale, scaleToRatio, unitMm, vpInv, vpPolygon, vpScaleLabel } from "./util";
import { xfPt } from "../geom";

const W = {
  list: ["seznam", "list", "liste", "?"],
  new: ["nové", "nový", "nova", "nove", "new", "neu"],
  copy: ["kopírovat", "kopie", "copy", "kopieren"],
  del: ["smazat", "odstranit", "delete", "löschen"],
  rename: ["přejmenovat", "rename", "umbenennen"],
  set: ["nastavit", "aktuální", "set", "current", "setzen", "aktuell"],
  model: ["model", "modell", "modelový-prostor"],
  land: ["na-šířku", "šířka", "landscape", "quer", "querformat"],
  port: ["na-výšku", "výška", "portrait", "hoch", "hochformat"],
  notitle: ["bez-razítka", "notitle", "ohne-schriftfeld"],
  noframe: ["bez-rámečku", "noframe", "ohne-rahmen"],
  novp: ["bez-výřezu", "noviewport", "ohne-ansichtsfenster"],
  scale: ["měřítko", "scale", "maßstab", "massstab"],
};
const isAny = (t: string | undefined, list: string[]) => isW(t, ...list);

/** rozvržení, ke kterému se příkaz vztahuje: zobrazené, aktivní přes výřez, nebo naposledy zobrazené */
export function currentLayout(c: CmdCtx): DraftLayout | null {
  const m = c.tx.model;
  const sp = c.session.space;
  if (sp.startsWith("layout:")) return findLayout(m, sp.slice(7)) ?? null;
  const av = activeViewport(c.session, m);
  if (av) return findLayout(m, av.layout) ?? null;
  const last = layoutState(c.session).lastLayout;
  return (last ? findLayout(m, last) : null) ?? null;
}
const layoutNames = (m: DraftModel) => layoutsOf(m).map((l) => l.name).join(", ") || "—";
const needLayout = (m: DraftModel, key: string) => {
  const l = findLayout(m, key);
  if (!l) throw new Error(tr("rozvržení „{0}“ neexistuje – rozvržení: {1}", key, layoutNames(m)));
  return l;
};

/**
 * Změna entit v papírovém prostoru rozvržení (i z modelového prostoru přes výřez) jako jeden krok. Entity na zamčené
 * hladině zůstanou beze změny (varování); nezmění-li se kvůli zámku nic, je to chyba. Vrací id změněných entit.
 */
export function updateLayoutEntities(c: CmdCtx, layoutId: string, fn: (e: DraftEntity) => DraftEntity): string[] {
  const locked: string[] = [];
  const changed: string[] = [];
  c.tx.setModel((m) => ({
    ...m,
    layouts: (m.layouts ?? []).map((l) =>
      l.id === layoutId
        ? {
            ...l,
            entities: l.entities.map((e) => {
              const n = fn(e);
              if (n === e) return e;
              if (findLayer(m, e.layer)?.locked) {
                locked.push(e.id);
                return e;
              }
              changed.push(e.id);
              return n;
            }),
          }
        : l,
    ),
  }));
  if (locked.length && !changed.length) throw new Error(tr("{0}: na zamčené hladině – nejdřív hladinu odemkněte", locked.join(", ")));
  if (locked.length) c.log(tr("⚠ na zamčené hladině (beze změny): {0}", locked.join(", ")));
  return changed;
}

function layoutSummary(m: DraftModel) {
  return layoutsOf(m).map((l) => ({
    id: l.id,
    name: l.name,
    paper: l.paper,
    plot: l.plot ?? {},
    entities: l.entities.length,
    viewports: l.entities.filter((e) => e.type === "viewport").map((e) => {
      const v = e as DViewport;
      return { id: v.id, c: v.c, w: v.w, h: v.h, scale: vpScaleLabel(m, v), ratio: scaleToRatio(m, v.scale), viewCenter: v.viewCenter, locked: !!v.locked, on: v.on !== false, frozenLayers: v.frozenLayers ?? [], ...(v.twist ? { twist: v.twist } : {}) };
    }),
  }));
}

function zoomSheet(c: CmdCtx, l: DraftLayout) {
  const s = sheetRect(l);
  const pad = Math.max(s.x1 - s.x0, s.y1 - s.y0) * 0.03;
  c.session.zoom = { kind: "window", box: { x0: s.x0 - pad, y0: s.y0 - pad, x1: s.x1 + pad, y1: s.y1 + pad } };
}

// ---------------------------------------------------------------- ROZVRŽENÍ

registerCommand({
  id: "LAYOUT",
  names: { cs: ["rozvržení", "rozvrzeni", "list-papíru"], en: ["layout"], de: ["layout", "layoutverw"] },
  alias: ["LO"],
  group: "layout",
  desc: () => tr("rozvržení (listy papíru): seznam; nové [název] [A4–A0] [na-šířku / na-výšku] [bez-razítka] [bez-rámečku] [bez-výřezu] [měřítko 1:50] [ZNAČKA=hodnota razítka]; kopírovat; smazat; přejmenovat; nastavit (přepnout); model"),
  usage: () => tr("rozvržení nové Výroba A3 měřítko 1:5 NAZEV=Příruba | rozvržení nastavit Výroba | rozvržení model | rozvržení přejmenovat Výroba Dílna | rozvržení smazat Dílna"),
  line: (c, a) => {
    const m = c.tx.model;
    const op = a[0];
    if (!op || isAny(op, W.list)) {
      const s = layoutSummary(m);
      c.out("layouts", s);
      if (!s.length) return c.log(tr("výkres nemá rozvržení – rozvržení nové A3"));
      for (const l of s) c.log(tr("{0} ({1}) · {2} {3}×{4} mm · výřezů {5}{6}", l.name, l.id, l.paper?.size ?? "?", l.paper?.w ?? "?", l.paper?.h ?? "?", l.viewports.length, l.viewports.length ? ` (${l.viewports.map((v) => `${v.id} ${v.scale}${v.locked ? " 🔒" : ""}`).join(", ")})` : ""));
      return;
    }
    if (isAny(op, W.new)) {
      let name: string | undefined;
      let size = "A3";
      let landscape: boolean | undefined;
      let frame = true;
      let title = true;
      let vp = true;
      let ratio: number | "fit" = "fit";
      const values: Record<string, string> = {};
      for (let i = 1; i < a.length; i++) {
        const t = a[i];
        if (parseSheet(t)) size = t;
        else if (isAny(t, W.land)) landscape = true;
        else if (isAny(t, W.port)) landscape = false;
        else if (isAny(t, W.notitle)) title = false;
        else if (isAny(t, W.noframe)) frame = false;
        else if (isAny(t, W.novp)) vp = false;
        else if (isAny(t, W.scale)) {
          const v = a[++i] ?? "";
          ratio = isW(v, "vejít", "fit", "einpassen") ? "fit" : parseRatio(v);
        } else if (/^[A-Za-z_][\w]*=/.test(t)) {
          const eq = t.indexOf("=");
          values[t.slice(0, eq).toUpperCase()] = t.slice(eq + 1);
        } else if (!name) name = t;
        else throw new Error(tr("neznámé zadání „{0}“ – formát A4–A0, na-šířku, na-výšku, bez-razítka, bez-rámečku, bez-výřezu, měřítko 1:50, ZNAČKA=hodnota", t));
      }
      const sh = parseSheet(size)!;
      const r = addLayout(m, { name, size: sh.size === size.toUpperCase() ? sh.size : size, landscape: landscape ?? (sh.size === "A4" ? false : true), frame, titleBlock: title, viewport: vp, ratio, values }, () => c.tx.newId());
      c.tx.setModel(() => r.model);
      const l = findLayout(c.tx.model, r.id)!;
      setSpace(c.session, `layout:${l.id}`);
      zoomSheet(c, l);
      const v = l.entities.find((e) => e.type === "viewport") as DViewport | undefined;
      c.out("layout", { id: l.id, name: l.name, size: l.paper.size, w: l.paper.w, h: l.paper.h, ...(v ? { viewport: v.id, scale: vpScaleLabel(c.tx.model, v) } : {}) });
      c.log(tr("✓ rozvržení „{0}“ ({1}): {2} {3}×{4} mm{5}", l.name, l.id, l.paper.size, l.paper.w, l.paper.h, v ? tr(" · výřez {0} v měřítku {1}", v.id, vpScaleLabel(c.tx.model, v)) : ""));
      return;
    }
    if (isAny(op, W.copy)) {
      const src = a[1] ? needLayout(m, a[1]) : currentLayout(c);
      if (!src) throw new Error(tr("zadejte rozvržení ke kopírování – rozvržení: {0}", layoutNames(m)));
      const r = copyLayout(m, src.id, a[2], () => c.tx.newId());
      c.tx.setModel(() => r.model);
      const l = findLayout(c.tx.model, r.id)!;
      setSpace(c.session, `layout:${l.id}`);
      zoomSheet(c, l);
      c.out("layout", { id: l.id, name: l.name });
      return c.log(tr("✓ kopie rozvržení „{0}“ → „{1}“", src.name, l.name));
    }
    if (isAny(op, W.del)) {
      const l = a[1] ? needLayout(m, a[1]) : currentLayout(c);
      if (!l) throw new Error(tr("zadejte rozvržení ke smazání – rozvržení: {0}", layoutNames(m)));
      c.tx.setModel((mm) => ({ ...mm, layouts: (mm.layouts ?? []).filter((x) => x.id !== l.id) }));
      if (c.session.space === `layout:${l.id}` || activeViewport(c.session, m)?.layout === l.id) setSpace(c.session, "model");
      if (layoutState(c.session).lastLayout === l.id) layoutState(c.session).lastLayout = null;
      return c.log(tr("✓ rozvržení „{0}“ smazáno", l.name));
    }
    if (isAny(op, W.rename)) {
      const l = a[2] !== undefined ? needLayout(m, a[1]) : currentLayout(c);
      const nn = (a[2] !== undefined ? a[2] : a[1] ?? "").trim();
      if (!l) throw new Error(tr("rozvržení přejmenovat STARÝ NOVÝ"));
      if (!nn) throw new Error(tr("zadejte nový název"));
      if ((m.layouts ?? []).some((x) => x.id !== l.id && x.name.toLowerCase() === nn.toLowerCase()) || fold(nn) === "model") throw new Error(tr("rozvržení „{0}“ už existuje", nn));
      c.tx.setModel((mm) => ({ ...mm, layouts: (mm.layouts ?? []).map((x) => (x.id === l.id ? { ...x, name: nn } : x)) }));
      return c.log(tr("✓ rozvržení „{0}“ → „{1}“", l.name, nn));
    }
    if (isAny(op, W.model)) {
      setSpace(c.session, "model");
      c.session.zoom = { kind: "extents" };
      return c.log(tr("✓ modelový prostor"));
    }
    if (isAny(op, W.set) || findLayout(m, op)) {
      const key = isAny(op, W.set) ? a[1] : op;
      if (!key) throw new Error(tr("rozvržení nastavit NÁZEV – rozvržení: {0}", layoutNames(m)));
      if (isAny(key, W.model)) {
        setSpace(c.session, "model");
        c.session.zoom = { kind: "extents" };
        return c.log(tr("✓ modelový prostor"));
      }
      const l = needLayout(m, key);
      setSpace(c.session, `layout:${l.id}`);
      zoomSheet(c, l);
      c.out("space", c.session.space);
      return c.log(tr("✓ rozvržení „{0}“", l.name));
    }
    throw new Error(tr("rozvržení: seznam, nové, kopírovat, smazat, přejmenovat, nastavit, model – ne „{0}“", op));
  },
});

// ---------------------------------------------------------------- VZHLED-STRÁNKY

const STYLE_W: Record<string, string> = { mono: "monochrome.ctb", monochrome: "monochrome.ctb", cernobile: "monochrome.ctb", schwarzweiss: "monochrome.ctb", barva: "acad.ctb", barevne: "acad.ctb", color: "acad.ctb", farbe: "acad.ctb", sede: "grayscale.ctb", seda: "grayscale.ctb", gray: "grayscale.ctb", grayscale: "grayscale.ctb", grau: "grayscale.ctb" };
registerCommand({
  id: "PAGESETUP",
  names: { cs: ["vzhled-stránky", "vzhled-stranky"], en: ["pagesetup"], de: ["seiteneinr", "seiteneinrichtung"] },
  group: "layout",
  desc: () => tr("vzhled stránky rozvržení: formát A4–A0 (rámeček, razítko a výchozí výřez se přizpůsobí), orientace, okraje tisku (obsah zůstane na místě, tisk ho ořízne), styl tisku (mono / barva / šedá), tloušťky čar, DPI pro PNG, PSLTSCALE (vzor čar ve výřezech v mm papíru = 1); bez zadání = výpis"),
  usage: () => tr("vzhled-stránky A2 na-šířku | vzhled-stránky styl mono tloušťky ano | vzhled-stránky rozvržení Výroba okraje 5,5,5,5 | vzhled-stránky psltscale 0"),
  line: (c, a) => {
    const m = c.tx.model;
    let l = currentLayout(c);
    let i = 0;
    if (isW(a[0], "rozvržení", "layout")) {
      l = needLayout(m, a[1] ?? "");
      i = 2;
    }
    if (!l) throw new Error(tr("vzhled stránky patří rozvržení – přepněte na rozvržení (rozvržení nastavit X) nebo zadejte „rozvržení X“"));
    const lid = l.id;
    if (i >= a.length) {
      c.out("pagesetup", { layout: l.name, paper: l.paper, plot: l.plot ?? {}, psltscale: m.vars.psltscale === 0 ? 0 : 1 });
      return c.log(tr("{0}: {1} {2}×{3} mm, {4}, okraje {5}, styl {6}, tloušťky {7}", l.name, l.paper.size, l.paper.w, l.paper.h, l.paper.landscape ? tr("na šířku") : tr("na výšku"), l.paper.margins.join(","), l.plot?.styleTable ?? "acad.ctb", l.plot?.lineweights === false ? tr("ne") : tr("ano")) + ` · PSLTSCALE ${m.vars.psltscale === 0 ? 0 : 1}`);
    }
    let size: string | null = null;
    let land: boolean | null = null;
    const plot = { ...(l.plot ?? {}) };
    let margins: [number, number, number, number] | null = null;
    let psl: 0 | 1 | null = null;
    for (; i < a.length; i++) {
      const t = a[i];
      const sh = parseSheet(t);
      if (sh) size = sh.size;
      else if (isAny(t, W.land)) land = true;
      else if (isAny(t, W.port)) land = false;
      else if (isW(t, "okraje", "margins", "ränder")) {
        const v = (a[++i] ?? "").split(/[,;]/).map(Number);
        if (v.length !== 4 || v.some((x) => !(x >= 0))) throw new Error(tr("okraje: vlevo,dole,vpravo,nahoře v mm"));
        margins = v as [number, number, number, number];
      } else if (isW(t, "psltscale")) {
        const v = a[++i];
        if (!isW(v, "0", "1", "ne", "ano", "no", "yes", "nein", "ja", "vyp", "zap", "off", "on")) throw new Error(tr("psltscale 1 (vzor čar ve výřezech v mm papíru) nebo 0 (v jednotkách modelu × měřítko výřezu)"));
        psl = isW(v, "1", "ano", "yes", "ja", "zap", "on") ? 1 : 0;
      } else if (isW(t, "styl", "style", "stil")) {
        const s = STYLE_W[fold(a[++i] ?? "")];
        if (!s) throw new Error(tr("styl tisku: mono, barva, šedá"));
        plot.styleTable = s;
      } else if (isW(t, "tloušťky", "lineweights", "linienstärken")) plot.lineweights = !isW(a[++i], "ne", "no", "nein", "0", "vyp", "off");
      else if (isW(t, "dpi")) {
        const v = Number(a[++i]);
        if (!(v >= 30 && v <= 1200)) throw new Error(tr("DPI 30–1200"));
        plot.dpi = v;
      } else throw new Error(tr("neznámé zadání „{0}“ – A4–A0, na-šířku, na-výšku, okraje l,d,p,h, styl mono|barva|šedá, tloušťky ano|ne, dpi N, psltscale 1|0", t));
    }
    c.tx.setModel((mm) => {
      let out = mm;
      if (margins) out = setLayoutMargins(out, lid, margins);
      if (size || land !== null) out = setLayoutPaper(out, lid, size ?? l!.paper.size, land ?? l!.paper.landscape, () => c.tx.newId());
      if (psl !== null && psl !== (out.vars.psltscale === 0 ? 0 : 1)) {
        // nová identita výřezů = znovu spočítaný obsah (vzor čar) – starý model (zpět) si nechá svůj
        out = { ...out, vars: { ...out.vars, psltscale: psl }, layouts: (out.layouts ?? []).map((x) => ({ ...x, entities: x.entities.map((e) => (e.type === "viewport" ? ({ ...e } as DraftEntity) : e)) })) };
      }
      return { ...out, layouts: (out.layouts ?? []).map((x) => (x.id === lid ? { ...x, plot } : x)) };
    });
    const nl = findLayout(c.tx.model, lid)!;
    c.out("pagesetup", { layout: nl.name, paper: nl.paper, plot: nl.plot ?? {}, psltscale: c.tx.model.vars.psltscale === 0 ? 0 : 1 });
    c.log(tr("✓ {0}: {1} {2}×{3} mm, styl {4}", nl.name, nl.paper.size, nl.paper.w, nl.paper.h, nl.plot?.styleTable ?? "acad.ctb"));
    if (margins) c.log(tr("okraje {0} mm – entity listu posunuty, aby zůstaly na stejném místě papíru", margins.join(",")));
    if (psl !== null) c.log(tr("PSLTSCALE = {0}", psl));
    const off = viewportsOffSheet(nl);
    if (off.length) c.log(tr("⚠ výřezy mimo list: {0} – upravte je úchopy nebo vlastnostmi (c, w, h)", off.join(", ")));
  },
});

// ---------------------------------------------------------------- VÝŘEZ (MVIEW)

const KV = {
  fit: kw("fit", "Vejít", "Fit", "Einpassen"),
  two: kw("two", "Dva", "Two", "Zwei"),
  three: kw("three", "Tři", "Three", "Drei"),
  four: kw("four", "Čtyři", "Four", "Vier"),
  poly: kw("polygonal", "Mnohoúhelník", "Polygonal", "Polygonal"),
  object: kw("object", "Objekt", "Object", "Objekt"),
  on: kw("on", "Zapnout", "ON", "Ein"),
  off: kw("off", "Vypnout", "OFF", "Aus"),
  lock: kw("lock", "Zamknout", "Lock", "Sperren"),
  unlock: kw("unlock", "Odemknout", "Unlock", "Entsperren"),
  scale: kw("scale", "Měřítko", "Scale", "Maßstab"),
  center: kw("center", "Střed", "Center", "Mitte"),
  horiz: kw("horizontal", "Vodorovně", "Horizontal", "Horizontal"),
  vert: kw("vertical", "Svisle", "Vertical", "Vertikal"),
  right: kw("right", "Vpravo", "Right", "Rechts"),
  left: kw("left", "Vlevo", "Left", "Links"),
};

/** výřez s měřítkem: „vejít“ = model se přesně vejde (2 % okraj), jinak poměr ISO; střed pohledu = střed rozsahu modelu */
function makeViewport(c: CmdCtx, area: Box, scaleTxt: string, clip?: Vec2[]): Omit<DViewport, "id"> {
  const m = c.tx.model;
  const fit = !scaleTxt || isW(scaleTxt, "vejít", "fit", "einpassen", "vejit");
  const base = viewportFor(m, area, fit ? 1 : parseRatio(scaleTxt));
  if (fit) {
    const ex = extents(m, m.entities);
    if (ex) {
      // nulový rozměr (jediný bod, vodorovná úsečka) se nepočítá; model bez plochy = 1:1 (měřítko z viewportFor)
      const tiny = 1e-9 * Math.max(1, Math.abs(ex.x0), Math.abs(ex.x1), Math.abs(ex.y0), Math.abs(ex.y1));
      const kx = ex.x1 - ex.x0 > tiny ? (area.x1 - area.x0) / (ex.x1 - ex.x0) : Infinity;
      const ky = ex.y1 - ex.y0 > tiny ? (area.y1 - area.y0) / (ex.y1 - ex.y0) : Infinity;
      const k = Math.min(kx, ky) * 0.98;
      if (Number.isFinite(k) && k > 0) base.scale = k;
    }
  }
  return { ...base, ...(clip ? { clip } : {}) };
}

/** kreslicí plocha listu (podle rámečku a razítka v rozvržení) */
function layoutArea(l: DraftLayout): Box {
  const frame = l.entities.some((e) => e.type === "insert" && isFrameBlock((e as DInsert).block));
  const title = l.entities.some((e) => e.type === "insert" && (e as DInsert).block === TITLE_BLOCK);
  const s = sheetRect(l);
  const a = drawingArea(s.x1 - s.x0, s.y1 - s.y0, frame, title);
  return { x0: a.x0 + s.x0, y0: a.y0 + s.y0, x1: a.x1 + s.x0, y1: a.y1 + s.y0 };
}

function splitArea(b: Box, n: number, mode: string): Box[] {
  const g = 4;
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  if (n === 2)
    return mode === "horizontal"
      ? [{ ...b, y0: b.y0 + h / 2 + g / 2 }, { ...b, y1: b.y0 + h / 2 - g / 2 }]
      : [{ ...b, x1: b.x0 + w / 2 - g / 2 }, { ...b, x0: b.x0 + w / 2 + g / 2 }];
  if (n === 3) {
    if (mode === "horizontal") return [0, 1, 2].map((i) => ({ ...b, y1: b.y1 - i * (h + g) / 3, y0: b.y1 - (i + 1) * (h + g) / 3 + g }));
    if (mode === "vertical") return [0, 1, 2].map((i) => ({ ...b, x0: b.x0 + i * (w + g) / 3, x1: b.x0 + (i + 1) * (w + g) / 3 - g }));
    const big = mode === "left" ? { ...b, x0: b.x0 + w / 2 + g / 2 } : { ...b, x1: b.x0 + w / 2 - g / 2 };
    const sx0 = mode === "left" ? b.x0 : b.x0 + w / 2 + g / 2;
    const sx1 = mode === "left" ? b.x0 + w / 2 - g / 2 : b.x1;
    return [big, { x0: sx0, x1: sx1, y0: b.y0 + h / 2 + g / 2, y1: b.y1 }, { x0: sx0, x1: sx1, y0: b.y0, y1: b.y0 + h / 2 - g / 2 }];
  }
  const xs = [b.x0, b.x0 + w / 2 - g / 2, b.x0 + w / 2 + g / 2, b.x1];
  const ys = [b.y0, b.y0 + h / 2 - g / 2, b.y0 + h / 2 + g / 2, b.y1];
  return [
    { x0: xs[0], x1: xs[1], y0: ys[2], y1: ys[3] },
    { x0: xs[2], x1: xs[3], y0: ys[2], y1: ys[3] },
    { x0: xs[0], x1: xs[1], y0: ys[0], y1: ys[1] },
    { x0: xs[2], x1: xs[3], y0: ys[0], y1: ys[1] },
  ];
}

const rectPreview = (a: Vec2) => (q: Vec2): NewEntity[] => [{ type: "polyline", pts: [a, [q[0], a[1]], q, [a[0], q[1]]], closed: true } as NewEntity];
const SCALE_MSG = () => tr("Měřítko výřezu (1:1, 1:2, 1:5, 1:10, 1:20, 1:50, 2:1…) nebo Vejít");
const SCALE_MSG2 = () => tr("Měřítko výřezu (např. 1:50, 2:1)");
/** výzvy měřítka (jedno slovo – v GUI je potvrdí i mezera) */
export const layoutWordPrompts = (): string[] => [SCALE_MSG(), SCALE_MSG2()];

function setScaleAll(c: CmdCtx, l: DraftLayout, ids: string[], raw: string) {
  const prevLabel = (l.entities.find((e) => e.type === "viewport") as DViewport | undefined) ? vpScaleLabel(c.tx.model, l.entities.find((e) => e.type === "viewport") as DViewport) : undefined;
  const r = parseRatio(raw);
  const skipped: string[] = [];
  for (const id of ids) if ((l.entities.find((e) => e.id === id) as DViewport | undefined)?.locked) skipped.push(id);
  if (skipped.length === ids.length) throw new Error(tr("výřez {0} je zamčený – odemknout: výřez odemknout", skipped.join(", ")));
  const done = updateLayoutEntities(c, l.id, (e) => (ids.includes(e.id) && e.type === "viewport" && !(e as DViewport).locked ? ({ ...e, scale: ratioToScale(c.tx.model, r) } as DraftEntity) : e));
  c.tx.setModel((m) => syncTitleScale({ ...m, vars: { ...m.vars, cannoscale: r } }, l.id, prevLabel));
  c.out("viewports", done);
  c.log(tr("✓ měřítko {0}: {1}", ratioLabel(r), done.join(", ") || "—"));
  if (skipped.length) c.log(tr("⚠ zamčené výřezy (beze změny): {0} – odemknout: výřez odemknout", skipped.join(", ")));
}

registerCommand({
  id: "MVIEW",
  names: { cs: ["výřez", "vyrez"], en: ["mview"], de: ["mansfen"] },
  alias: ["MV"],
  group: "layout",
  desc: () => tr("výřezy rozvržení (pohled do modelu v měřítku): dva rohy + měřítko (1:50… / Vejít); volby Vejít (kreslicí plocha), Dva/Tři/Čtyři, Mnohoúhelník, Objekt (uzavřená křivka / kružnice), Zapnout / Vypnout, Zamknout / Odemknout, Měřítko, Střed (střed pohledu v modelu)"),
  usage: () => tr("výřez 25,60 405,282 1:5 | výřez vejít 1:10 | výřez dva svisle vejít vejít | výřez měřítko e7 1:20 | výřez zamknout e7 | výřez střed e7 120,40"),
  run: function* (c): CmdGen {
    const m0 = c.tx.model;
    const l = c.session.space.startsWith("layout:") ? findLayout(m0, c.session.space.slice(7)) : null;
    if (!l) throw new Error(tr("výřezy se kreslí v rozvržení – přepněte: rozvržení nastavit X (nebo rozvržení nové A3)"));
    const vpFilter = (e: DraftEntity) => e.type === "viewport";
    const i = yield { k: "point", msg: tr("Zadejte roh výřezu nebo"), kw: [KV.fit, KV.two, KV.three, KV.four, KV.poly, KV.object, KV.on, KV.off, KV.lock, KV.unlock, KV.scale, KV.center] };
    const addVp = (v: Omit<DViewport, "id">) => c.tx.add(v as NewEntity);
    const finishNew = (ids: string[]) => {
      c.tx.setModel((m) => syncTitleScale(m, l.id));
      const vs = ids.map((id) => c.tx.get(id) as DViewport);
      c.out("viewports", vs.map((v) => ({ id: v.id, scale: vpScaleLabel(c.tx.model, v), c: v.c, w: v.w, h: v.h })));
      c.log(tr("✓ výřez {0}", vs.map((v) => `${v.id} ${vpScaleLabel(c.tx.model, v)}`).join(", ")));
    };
    if (i.k === "point") {
      const q = yield { k: "point", msg: tr("Zadejte protější roh"), base: i.p, preview: rectPreview(i.p) };
      if (q.k !== "point") return;
      const b = boxOf([i.p, q.p]);
      if (b.x1 - b.x0 < 1e-6 || b.y1 - b.y0 < 1e-6) throw new Error(tr("výřez má nulový rozměr"));
      const s = yield { k: "text", msg: SCALE_MSG(), def: KV.fit.cs };
      return finishNew([addVp(makeViewport(c, b, s.k === "text" ? s.s : ""))]);
    }
    if (i.k !== "kw") return;
    if (i.id === "fit") {
      const s = yield { k: "text", msg: SCALE_MSG(), def: KV.fit.cs };
      return finishNew([addVp(makeViewport(c, layoutArea(l), s.k === "text" ? s.s : ""))]);
    }
    if (i.id === "two" || i.id === "three" || i.id === "four") {
      const n = i.id === "two" ? 2 : i.id === "three" ? 3 : 4;
      let mode = n === 3 ? "right" : "vertical";
      if (n < 4) {
        const o = yield { k: "kw", msg: tr("Uspořádání"), kw: n === 2 ? [KV.horiz, KV.vert] : [KV.horiz, KV.vert, KV.left, KV.right], def: mode };
        if (o.k === "kw") mode = o.id;
      }
      const p = yield { k: "point", msg: tr("Zadejte první roh nebo"), kw: [KV.fit], none: true };
      let area: Box = layoutArea(l);
      if (p.k === "point") {
        const q = yield { k: "point", msg: tr("Zadejte protější roh"), base: p.p, preview: rectPreview(p.p) };
        if (q.k !== "point") return;
        area = boxOf([p.p, q.p]);
      }
      const s = yield { k: "text", msg: SCALE_MSG(), def: KV.fit.cs };
      return finishNew(splitArea(area, n, mode).map((b) => addVp(makeViewport(c, b, s.k === "text" ? s.s : ""))));
    }
    if (i.id === "polygonal") {
      const pts: Vec2[] = [];
      for (;;) {
        const p = yield { k: "point", msg: pts.length < 3 ? tr("Zadejte vrchol mnohoúhelníku") : tr("Zadejte další vrchol nebo Enter"), ...(pts.length ? { base: pts[pts.length - 1], preview: (q: Vec2) => [{ type: "polyline", pts: [...pts, q], closed: true } as NewEntity] } : {}), none: pts.length >= 3 };
        if (p.k !== "point") break;
        pts.push(p.p);
      }
      if (pts.length < 3) throw new Error(tr("mnohoúhelník potřebuje aspoň 3 vrcholy"));
      const s = yield { k: "text", msg: SCALE_MSG(), def: KV.fit.cs };
      return finishNew([addVp(makeViewport(c, boxOf(pts), s.k === "text" ? s.s : "", pts))]);
    }
    if (i.id === "object") {
      const closedObj = (e: DraftEntity) => {
        if (e.type === "circle") return true;
        if (e.type === "ellipse") {
          const el = e as DraftEntity & { t0?: number; t1?: number };
          return el.t0 === undefined || el.t1 === undefined || Math.abs(Math.abs(el.t1 - el.t0) - 2 * Math.PI) < 1e-9 || Math.abs(el.t1 - el.t0) < 1e-12;
        }
        return (e.type === "polyline" || e.type === "spline") && !!(e as { closed?: boolean }).closed;
      };
      const en = yield { k: "entity", msg: tr("Vyberte uzavřený objekt ořezu (uzavřená křivka nebo spline, kružnice, celá elipsa)"), filter: closedObj };
      if (en.k !== "ent") return;
      const e = c.tx.get(en.id)!;
      if (!closedObj(e)) throw new Error(tr("{0} není uzavřený objekt – ořez výřezu potřebuje uzavřenou křivku, spline, kružnici nebo celou elipsu", e.id));
      const pts: Vec2[] = [];
      for (const cv of entityCurves(e, c.kctx())) {
        const [t0, t1] = cRange(cv);
        const n = cv.k === "line" ? 1 : 48;
        for (let k = 0; k < n; k++) pts.push(cPoint(cv, t0 + ((t1 - t0) * k) / n));
      }
      if (pts.length < 3) throw new Error(tr("objekt neurčuje plochu"));
      const s = yield { k: "text", msg: SCALE_MSG(), def: KV.fit.cs };
      return finishNew([addVp(makeViewport(c, boxOf(pts), s.k === "text" ? s.s : "", pts))]);
    }
    const sel = yield { k: "select", msg: tr("Vyberte výřezy"), filter: vpFilter };
    if (sel.k !== "sel" || !sel.ids.length) return c.log(tr("nic nevybráno"));
    const ids = sel.ids;
    if (i.id === "on" || i.id === "off" || i.id === "lock" || i.id === "unlock") {
      const patch: Partial<DViewport> = i.id === "on" ? { on: true } : i.id === "off" ? { on: false } : i.id === "lock" ? { locked: true } : { locked: false };
      const done = updateLayoutEntities(c, l.id, (e) => (ids.includes(e.id) ? ({ ...e, ...patch } as DraftEntity) : e));
      c.out("viewports", done);
      return c.log(tr("✓ {0}: {1}", i.id === "on" ? tr("zapnuto") : i.id === "off" ? tr("vypnuto") : i.id === "lock" ? tr("zamčeno") : tr("odemčeno"), done.join(", ")));
    }
    if (i.id === "scale") {
      const s = yield { k: "text", msg: SCALE_MSG2() };
      if (s.k !== "text") return;
      return setScaleAll(c, l, ids, s.s);
    }
    if (i.id === "center") {
      const vps = ids.map((id) => l.entities.find((e) => e.id === id)).filter((e): e is DViewport => e?.type === "viewport");
      const free = vps.filter((v) => !v.locked);
      const locked = vps.filter((v) => v.locked).map((v) => v.id);
      if (!free.length) throw new Error(tr("výřez {0} je zamčený – odemknout: výřez odemknout", locked.join(", ")));
      // výzva v modelovém prostoru výřezu: klik do výřezu, uchopení i zadání (x,y, @dx,dy od středu, výraz) = souřadnice modelu
      const v0 = free[0];
      const back = c.session.space;
      setSpace(c.session, "model", { layout: l.id, id: v0.id });
      c.session.zoom = { kind: "window", box: boxOf(vpPolygon(v0).map((q) => xfPt(vpInv(v0), q))) };
      let p: Input;
      try {
        p = yield { k: "point", msg: tr("Nový střed pohledu (bod modelu: klikněte do výřezu nebo x,y)"), base: v0.viewCenter };
      } finally {
        setSpace(c.session, back);
        zoomSheet(c, l);
      }
      if (p.k !== "point") return;
      const vc: Vec2 = p.p;
      const fid = new Set(free.map((v) => v.id));
      const done = updateLayoutEntities(c, l.id, (e) => (fid.has(e.id) ? ({ ...e, viewCenter: vc } as DraftEntity) : e));
      c.out("viewports", done);
      c.log(tr("✓ střed pohledu {0}: {1}", c.fmt.pt(vc), done.join(", ")));
      if (locked.length) c.log(tr("⚠ zamčené výřezy (beze změny): {0} – odemknout: výřez odemknout", locked.join(", ")));
      return;
    }
  },
});

// ---------------------------------------------------------------- MODELOVÝ / PAPÍROVÝ PROSTOR

registerCommand({
  id: "MSPACE",
  names: { cs: ["modelový-prostor", "modelovy-prostor"], en: ["mspace"], de: ["mbereich"] },
  alias: ["MS"],
  group: "layout",
  readonly: true,
  desc: () => tr("práce v modelu přes výřez rozvržení (jako poklepání do výřezu): kreslí se v souřadnicích modelu, okolí listu zůstane vidět; zpět PAPÍROVÝ-PROSTOR"),
  usage: () => tr("modelový-prostor | modelový-prostor e7"),
  run: function* (c): CmdGen {
    const m = c.tx.model;
    const l = c.session.space.startsWith("layout:") ? findLayout(m, c.session.space.slice(7)) : currentLayout(c);
    if (!l) throw new Error(tr("výkres nemá rozvržení – modelový prostor je zobrazený"));
    const vps = l.entities.filter((e) => e.type === "viewport" && (e as DViewport).on !== false) as DViewport[];
    if (!vps.length) throw new Error(tr("rozvržení „{0}“ nemá zapnutý výřez – VÝŘEZ", l.name));
    let vp: DViewport | undefined;
    const selVp = c.session.sel.map((id) => vps.find((v) => v.id === id)).find(Boolean);
    if (vps.length === 1) vp = vps[0];
    else if (selVp) vp = selVp;
    if (!vp) {
      if (!c.session.space.startsWith("layout:")) setSpace(c.session, `layout:${l.id}`);
      const en = yield { k: "entity", msg: tr("Vyberte výřez"), filter: (e) => e.type === "viewport", none: true };
      vp = en.k === "ent" ? vps.find((v) => v.id === en.id) : vps[0];
    }
    if (!vp) return;
    setSpace(c.session, "model", { layout: l.id, id: vp.id });
    const inv = vpInv(vp);
    c.session.zoom = { kind: "window", box: boxOf(vpPolygon(vp).map((p) => xfPt(inv, p))) };
    c.out("viewport", { id: vp.id, layout: l.id, scale: vpScaleLabel(m, vp), ratio: scaleToRatio(m, vp.scale) });
    c.log(tr("✓ modelový prostor přes výřez {0} ({1}, měřítko {2}) – souřadnice modelu; zpět: papírový-prostor", vp.id, l.name, vpScaleLabel(m, vp)));
  },
});

registerCommand({
  id: "PSPACE",
  names: { cs: ["papírový-prostor", "papirovy-prostor"], en: ["pspace"], de: ["pbereich"] },
  alias: ["PS"],
  group: "layout",
  readonly: true,
  desc: () => tr("zpět na list rozvržení (papírový prostor) z modelového prostoru výřezu"),
  usage: () => tr("papírový-prostor"),
  line: (c) => {
    const m = c.tx.model;
    const av = activeViewport(c.session, m);
    const key = av?.layout ?? (c.session.space.startsWith("layout:") ? c.session.space.slice(7) : layoutState(c.session).lastLayout);
    const l = key ? findLayout(m, key) : layoutsOf(m)[0];
    if (!l) throw new Error(tr("výkres nemá rozvržení – rozvržení nové A3"));
    setSpace(c.session, `layout:${l.id}`);
    zoomSheet(c, l);
    c.out("space", c.session.space);
    c.log(tr("✓ papírový prostor – rozvržení „{0}“", l.name));
  },
});

// ---------------------------------------------------------------- HLADINY-VÝŘEZU

registerCommand({
  id: "VPLAYER",
  names: { cs: ["hladiny-výřezu", "hladiny-vyrezu"], en: ["vplayer"], de: ["afebene"] },
  group: "layout",
  desc: () => tr("zmrazení hladin jen v některém výřezu: zmrazit / rozmrazit HLADINY (čárkou, * = vše) [výřez e7 | vše | aktuální]; reset = rozmrazit vše; seznam"),
  usage: () => tr("hladiny-výřezu zmrazit KÓTY,OSY výřez e7 | hladiny-výřezu rozmrazit * vše | hladiny-výřezu seznam"),
  line: (c, a) => {
    const m = c.tx.model;
    const l = currentLayout(c);
    if (!l) throw new Error(tr("výkres nemá rozvržení"));
    const all = l.entities.filter((e) => e.type === "viewport") as DViewport[];
    const op = a[0];
    if (!op || isW(op, "seznam", "list", "liste", "?")) {
      const rows = all.map((v) => ({ id: v.id, frozenLayers: v.frozenLayers ?? [] }));
      c.out("viewports", rows);
      for (const r of rows) c.log(`${r.id}: ${r.frozenLayers.join(", ") || "—"}`);
      return;
    }
    const freeze = isW(op, "zmrazit", "freeze", "frieren");
    const thaw = isW(op, "rozmrazit", "thaw", "tauen");
    const reset = isW(op, "reset", "resetovat", "zurücksetzen");
    if (!freeze && !thaw && !reset) throw new Error(tr("hladiny-výřezu: zmrazit, rozmrazit, reset, seznam – ne „{0}“", op));
    let i = 1;
    let names: string[] = [];
    if (!reset) {
      const raw = a[i++] ?? "";
      const pats = raw.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
      if (!pats.length) throw new Error(tr("zadejte hladiny (čárkou oddělené, * = vše)"));
      for (const p of pats) {
        const re = new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "i");
        const hit = m.layers.filter((x) => re.test(x.name)).map((x) => x.name);
        if (!hit.length) throw new Error(tr("hladina „{0}“ neexistuje", p));
        names.push(...hit);
      }
      names = [...new Set(names)];
    }
    let target: string[] = [];
    const av = activeViewport(c.session, m);
    const w = a[i];
    if (isW(w, "výřez", "viewport", "ansichtsfenster")) target = (a[i + 1] ?? "").toLowerCase().split(",").filter(Boolean);
    else if (isW(w, "vše", "vse", "all", "alle", "alles")) target = all.map((v) => v.id);
    else if (av) target = [av.vp.id];
    else target = c.session.sel.filter((id) => all.some((v) => v.id === id));
    if (!target.length) throw new Error(tr("zadejte výřez: „výřez e7“, „vše“, nebo vyberte výřez (v modelovém prostoru výřezu = aktivní)"));
    for (const id of target) if (!all.some((v) => v.id === id)) throw new Error(tr("{0} není výřez rozvržení „{1}“", id, l.name));
    updateLayoutEntities(c, l.id, (e) => {
      if (!target.includes(e.id)) return e;
      const v = e as DViewport;
      const cur = new Set((v.frozenLayers ?? []).map((x) => x));
      if (reset) cur.clear();
      for (const n of names) {
        if (freeze) cur.add(n);
        else for (const x of [...cur]) if (x.toLowerCase() === n.toLowerCase()) cur.delete(x);
      }
      const out = { ...v, frozenLayers: [...cur] } as DViewport;
      if (!cur.size) delete out.frozenLayers;
      return out;
    });
    c.log(tr("✓ {0} ve výřezech {1}: {2}", reset ? tr("rozmrazeno vše") : freeze ? tr("zmrazeno") : tr("rozmrazeno"), target.join(", "), names.join(", ") || "*"));
  },
});

/** stav rozvržení pro agenty (seznam rozvržení a výřezů) */
export { layoutSummary };
/** pomocná: model → jednotky papíru (mm na jednotku modelu) */
export const mmPerUnit = unitMm;
/** pomocná pro GUI: entity papíru rozvržení */
export const layoutEntities = (m: DraftModel, id: string) => spaceEntities(m, `layout:${id}`) ?? [];
