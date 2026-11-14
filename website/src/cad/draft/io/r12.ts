/**
 * Vlastní zapisovač DXF R12 (AC1009) – acad-ts R12 neumí. Pro starší programy, CNC / CAM a laserové řezání.
 * R12 zná jen: POINT, LINE, CIRCLE, ARC, POLYLINE (2D s vydutím a šířkami, 3D), TEXT, SOLID, 3DFACE, INSERT + ATTRIB,
 * ATTDEF, DIMENSION (s blokem geometrie) a bloky. Ostatní druhy se převedou: elipsa a spline → POLYLINE (vzorkovaně),
 * přímka / polopřímka → LINE v rozsahu výkresu, MTEXT → řádky TEXT, kóta → DIMENSION + blok *D, odkaz → POLYLINE + SOLID
 * + TEXT, tolerance → rámeček s textem, šrafa → úsečky vzoru / trojúhelníky SOLID. Barvy ACI (pravé barvy přibližně),
 * tloušťky čar R12 nemá. Rozvržení (papírový prostor) se do R12 nezapisují – jen modelový prostor a bloky.
 * Elipsy a splajny se dělí podle odchylky tětivy (0,005 mm), ne pevným počtem úseků. Názvy (hladiny, typy čar, styly,
 * bloky) se upraví pro R12 (velká písmena bez diakritiky, max. 31 znaků) a zůstanou jedinečné (kolize → přípona _2…).
 */
import { tr } from "../../i18n";
import { nearestAci } from "../colors";
import type { DDimension, DHatch, DLeader, DMText, DTolerance } from "../annot/types";
import type { DAttDef, DAttrib, DInsert } from "../layout/types";
import { cPoint, cRange, type Curve } from "../curves";
import { boxOf, boxUnion, closestOnSeg, emptyBox, isEmptyBox, rad, TAU, type Box } from "../geom";
import { entityBox, entityCurves, kindOf, type KindCtx } from "../kinds";
import { textFrame } from "../kinds-core";
import type { DraftColor, DraftEntity, DraftModel, DText, NewEntity, Vec2 } from "../model";
import { UNITS } from "../units";
import { geomKey, H_ALIGN, V_ALIGN } from "./common";
import { dimensionGeometry, leaderGeometry, mtextAsText, toleranceGeometry } from "./dimgeom";
import { hatchPatternSegments, solidTriangles } from "./hatch-explode";

function aci(c: DraftColor | undefined): number | null {
  if (c === undefined || c === "ByLayer") return null;
  if (c === "ByBlock") return 0;
  if (typeof c === "number") return c;
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return nearestAci([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
}

const num = (x: number) => {
  if (!Number.isFinite(x)) return "0.0";
  const s = String(Math.abs(x) < 1e-14 ? 0 : x);
  return /[.e]/i.test(s) ? s : `${s}.0`;
};
/** jméno pro R12: velká písmena, bez mezer a zakázaných znaků (max 31 znaků) */
const r12Name = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9_$\-*]/g, "_").slice(0, 31) || "X";

/**
 * Přidělování názvů R12 v jednom oboru (hladiny, typy čar, styly, bloky): různé zdrojové názvy, které se po úpravě
 * (velká písmena, bez diakritiky, 31 znaků) shodují, dostanou příponu _2, _3… – jinak by se hladiny sloučily
 * a bloky měly dvě definice. Přejmenování se hlásí ve varování.
 */
class Names {
  private used = new Set<string>();
  renamed: string[] = [];
  constructor(reserved: string[] = []) {
    for (const r of reserved) this.used.add(r.toUpperCase());
  }
  /** `fixed` = přesný název bez úpravy (0, CONTINUOUS, *U1…) */
  take(src: string, fixed?: string): string {
    const base = fixed ?? r12Name(src);
    let name = base;
    for (let i = 2; this.used.has(name.toUpperCase()); i++) {
      const suf = `_${i}`;
      name = base.startsWith("*") ? `${base.replace(/\d+$/, "")}${i}` : base.slice(0, 31 - suf.length) + suf;
    }
    this.used.add(name.toUpperCase());
    if (name !== base) this.renamed.push(`${src} → ${name}`);
    return name;
  }
  /** další volný anonymní název s předponou (*D1, *X2 …) */
  anon(prefix: string): string {
    let i = 1;
    while (this.used.has(`${prefix}${i}`)) i++;
    this.used.add(`${prefix}${i}`);
    return `${prefix}${i}`;
  }
}

/** text pro R12: Ø / ± / ° jako řídicí kódy %%c / %%p / %%d (R12 a CAM programy z té doby \U+ neznají) */
const r12Text = (s: string) => s.replace(/[Ø⌀∅]/g, "%%c").replace(/±/g, "%%p").replace(/°/g, "%%d");

/** tolerance tětivy při převodu elipsy / splinu na lomenou čáru [mm] */
export const R12_CHORD_TOL_MM = 0.005;

/**
 * Lomená čára křivky s odchylkou od křivky ≤ `tol` (adaptivní půlení podle odchylky středu a čtvrtin úseku od tětivy).
 * Počet vrcholů roste s velikostí a křivostí – malá elipsa má desítky vrcholů, metrová stovky.
 */
export function flattenCurve(c: Curve, tol: number, maxPts = 200000): Vec2[] {
  if (c.k === "line") return [c.a, c.b];
  const [t0, t1] = cRange(c);
  // výchozí dělení: elipsa / oblouk po 1/32 otáčky, NURBS po čtvrtinách každého úseku uzlů
  const starts: number[] = [];
  if (c.k === "nurbs") {
    const ks = [...new Set(c.knots.filter((k) => k >= t0 && k <= t1))].sort((a, b) => a - b);
    for (let i = 0; i + 1 < ks.length; i++) for (let j = 0; j < 4; j++) starts.push(ks[i] + ((ks[i + 1] - ks[i]) * j) / 4);
  } else {
    const n0 = Math.max(8, Math.ceil(((t1 - t0) / TAU) * 32));
    for (let i = 0; i < n0; i++) starts.push(t0 + ((t1 - t0) * i) / n0);
  }
  starts.push(t1);
  const out: Vec2[] = [cPoint(c, t0)];
  const dev = (p: Vec2, a: Vec2, b: Vec2) => closestOnSeg(p, a, b).d;
  const rec = (ta: number, pa: Vec2, tb: number, pb: Vec2, depth: number) => {
    const tm = (ta + tb) / 2;
    if (depth < 32 && out.length < maxPts) {
      const pm = cPoint(c, tm);
      const q1 = cPoint(c, (ta + tm) / 2);
      const q3 = cPoint(c, (tm + tb) / 2);
      if (dev(pm, pa, pb) > tol || dev(q1, pa, pb) > tol || dev(q3, pa, pb) > tol) {
        rec(ta, pa, tm, pm, depth + 1);
        rec(tm, pm, tb, pb, depth + 1);
        return;
      }
    }
    out.push(pb);
  };
  for (let i = 0; i + 1 < starts.length; i++) {
    if (starts[i + 1] - starts[i] <= 0) continue;
    rec(starts[i], out[out.length - 1], starts[i + 1], cPoint(c, starts[i + 1]), 0);
  }
  return out;
}

class W {
  out: string[] = [];
  /** připojit výstup jiného zapisovače (bez rozbalení do argumentů – velké výkresy) */
  append(o: W) {
    const a = this.out;
    for (let i = 0; i < o.out.length; i++) a.push(o.out[i]);
  }
  g(code: number, v: string | number) {
    this.out.push(String(code).padStart(3, " "), typeof v === "number" ? (Number.isInteger(v) && code >= 60 && code < 100 ? String(v) : num(v)) : v);
  }
  pt(c: number, p: Vec2, z = 0) {
    this.g(c, p[0]);
    this.g(c + 10, p[1]);
    this.g(c + 20, z);
  }
}

type Ctx = {
  model: DraftModel;
  kctx: KindCtx;
  w: W;
  warn: Set<string>;
  blocks: Map<string, string>;
  blockNames: Names;
  extra: { name: string; ents: NewEntity[] }[];
  ext: number;
  layer: Map<string, string>;
  lt: Map<string, string>;
  style: Map<string, string>;
  /** styl s písmem gdt.shx pro značky GD&T (rámečky tolerance) */
  gdt: string;
  /** tolerance tětivy ve výkresových jednotkách */
  tol: number;
};

/** 2D model → text DXF R12 */
export function draftToR12(model: DraftModel): { text: string; warnings: string[] } {
  const w = new W();
  const kctx: KindCtx = { model };
  const layerNames = new Names(["0"]);
  const ltNames = new Names(["CONTINUOUS", "BYLAYER", "BYBLOCK"]);
  const styleNames = new Names();
  const blockNames = new Names();
  const ctx: Ctx = {
    model,
    kctx,
    w,
    warn: new Set(),
    blocks: new Map(),
    blockNames,
    extra: [],
    ext: 1000,
    layer: new Map(model.layers.map((l) => [l.name, l.name === "0" ? "0" : layerNames.take(l.name)])),
    lt: new Map(model.linetypes.filter((l) => !/^(continuous|bylayer|byblock)$/i.test(l.name)).map((l) => [l.name.toLowerCase(), ltNames.take(l.name)])),
    style: new Map(model.textStyles.map((s) => [s.name.toLowerCase(), styleNames.take(s.name)])),
    gdt: "",
    tol: R12_CHORD_TOL_MM / (UNITS[model.vars.units]?.mm || 1),
  };
  const hasTolerance = (list: DraftEntity[]) => list.some((e) => e.type === "tolerance");
  if (hasTolerance(model.entities) || (model.blocks ?? []).some((b) => hasTolerance(b.entities))) {
    ctx.gdt = styleNames.take("GDT");
    ctx.style.set(ctx.gdt.toLowerCase(), ctx.gdt);
  }
  // názvy bloků: anonymní (*U1, *T2 …) beze změny; *D se generují znovu při zápisu kót
  for (const b of model.blocks ?? []) if (b.name.startsWith("*") && !/^\*D/i.test(b.name)) ctx.blocks.set(b.name, blockNames.take(b.name, b.name.toUpperCase()));
  for (const b of model.blocks ?? []) if (!b.name.startsWith("*")) ctx.blocks.set(b.name, blockNames.take(b.name));
  // rozsah výkresu včetně vložení bloků, šraf, kót a odkazů ($EXTMIN / $EXTMAX, pohled *ACTIVE, délka přímek)
  let box = emptyBox();
  const memo = new Map<string, Box | null>();
  for (const e of model.entities) {
    const b = extBox(ctx, e, memo, 0);
    if (b) box = boxUnion(box, b);
  }
  if (isEmptyBox(box)) box = { x0: 0, y0: 0, x1: 100, y1: 100 };
  ctx.ext = Math.max(box.x1 - box.x0, box.y1 - box.y0, 1) * 10;
  const v = model.vars;
  // hlavička
  w.g(0, "SECTION");
  w.g(2, "HEADER");
  const hv = (name: string, code: number, val: string | number) => {
    w.g(9, name);
    w.g(code, val);
  };
  hv("$ACADVER", 1, "AC1009");
  hv("$DWGCODEPAGE", 3, "ANSI_1250");
  w.g(9, "$INSBASE");
  w.pt(10, [0, 0]);
  w.g(9, "$EXTMIN");
  w.pt(10, [box.x0, box.y0]);
  w.g(9, "$EXTMAX");
  w.pt(10, [box.x1, box.y1]);
  hv("$LTSCALE", 40, v.ltscale || 1);
  hv("$CLAYER", 8, ctx.layer.get(v.clayer) ?? "0");
  hv("$LUNITS", 70, 2);
  hv("$LUPREC", 70, Math.max(0, Math.min(8, v.prec | 0)));
  hv("$AUPREC", 70, Math.max(0, Math.min(8, v.aprec | 0)));
  hv("$PDMODE", 70, v.pdmode | 0);
  hv("$PDSIZE", 40, v.pdsize || 0);
  hv("$MIRRTEXT", 70, v.mirrtext ? 1 : 0);
  hv("$TEXTSIZE", 40, v.textsize || 2.5);
  hv("$TEXTSTYLE", 7, ctx.style.get((v.textstyle || "Standard").toLowerCase()) ?? "STANDARD");
  hv("$HANDLING", 70, 0);
  w.g(0, "ENDSEC");
  // tabulky
  w.g(0, "SECTION");
  w.g(2, "TABLES");
  const table = (name: string, n: number, body: () => void) => {
    w.g(0, "TABLE");
    w.g(2, name);
    w.g(70, n);
    body();
    w.g(0, "ENDTAB");
  };
  table("VPORT", 1, () => {
    w.g(0, "VPORT");
    w.g(2, "*ACTIVE");
    w.g(70, 0);
    w.g(10, 0);
    w.g(20, 0);
    w.g(11, 1);
    w.g(21, 1);
    w.g(12, (box.x0 + box.x1) / 2);
    w.g(22, (box.y0 + box.y1) / 2);
    w.g(40, Math.max(box.y1 - box.y0, 1) * 1.1);
    w.g(41, Math.max((box.x1 - box.x0) / Math.max(box.y1 - box.y0, 1e-9), 0.1));
  });
  const lts = model.linetypes.filter((l) => !/^(bylayer|byblock)$/i.test(l.name));
  if (!lts.some((l) => /^continuous$/i.test(l.name))) lts.unshift({ name: "Continuous", desc: "Solid line", pattern: [] } as unknown as (typeof lts)[number]);
  table("LTYPE", lts.length, () => {
    for (const l of lts) {
      w.g(0, "LTYPE");
      w.g(2, ctx.lt.get(l.name.toLowerCase()) ?? "CONTINUOUS");
      w.g(70, 0);
      w.g(3, (l.desc ?? "").replace(/[^\x20-\x7e]/g, "_"));
      w.g(72, 65);
      w.g(73, l.pattern.length);
      w.g(40, l.pattern.reduce((s, x) => s + Math.abs(x), 0));
      for (const x of l.pattern) w.g(49, x);
    }
  });
  table("LAYER", model.layers.length, () => {
    for (const l of model.layers) {
      w.g(0, "LAYER");
      w.g(2, ctx.layer.get(l.name)!);
      w.g(70, (l.frozen ? 1 : 0) | (l.locked ? 4 : 0));
      const c = typeof l.color === "number" ? l.color : aci(l.color) ?? 7;
      w.g(62, l.on ? c : -c);
      w.g(6, /^continuous$/i.test(l.linetype) ? "CONTINUOUS" : ctx.lt.get(l.linetype.toLowerCase()) ?? "CONTINUOUS");
    }
  });
  table("STYLE", model.textStyles.length + (ctx.gdt ? 1 : 0), () => {
    for (const s of model.textStyles) {
      w.g(0, "STYLE");
      w.g(2, ctx.style.get(s.name.toLowerCase())!);
      w.g(70, 0);
      w.g(40, s.height || 0);
      w.g(41, s.wf || 1);
      w.g(50, s.oblique || 0);
      w.g(71, 0);
      w.g(42, s.height || 2.5);
      w.g(3, /\.(shx|ttf)$/i.test(s.font) ? s.font : "txt");
      w.g(4, "");
    }
    if (ctx.gdt) {
      w.g(0, "STYLE");
      w.g(2, ctx.gdt);
      w.g(70, 0);
      w.g(40, 0);
      w.g(41, 1);
      w.g(50, 0);
      w.g(71, 0);
      w.g(42, 2.5);
      w.g(3, "gdt.shx");
      w.g(4, "");
    }
  });
  table("VIEW", 0, () => undefined);
  table("UCS", 0, () => undefined);
  table("APPID", 1, () => {
    w.g(0, "APPID");
    w.g(2, "ACAD");
    w.g(70, 0);
  });
  table("DIMSTYLE", 1, () => {
    w.g(0, "DIMSTYLE");
    w.g(2, "STANDARD");
    w.g(70, 0);
  });
  w.g(0, "ENDSEC");
  // entity do vyrovnávací paměti (vznikají i anonymní bloky kót a šraf)
  const main = new W();
  for (const e of model.entities) writeEntity(ctx, main, e);
  // bloky
  w.g(0, "SECTION");
  w.g(2, "BLOCKS");
  for (const b of model.blocks ?? []) {
    if (b.anonymous && /^\*D/i.test(b.name)) continue; // geometrie kót se generuje znovu
    const bw = new W();
    for (const e of b.entities) writeEntity(ctx, bw, e);
    blockHeader(w, ctx.blocks.get(b.name)!, b.base, b.entities.some((e) => e.type === "attdef"));
    w.append(bw);
    w.g(0, "ENDBLK");
    w.g(8, "0");
  }
  for (let i = 0; i < ctx.extra.length; i++) {
    const x = ctx.extra[i];
    const bw = new W();
    for (const [k, p] of x.ents.entries()) writeEntity(ctx, bw, { ...p, id: `${x.name}.${k}`, layer: p.layer ?? "0", ...(p.color === undefined ? { color: "ByBlock" } : {}) } as DraftEntity);
    blockHeader(w, x.name, [0, 0], false);
    w.append(bw);
    w.g(0, "ENDBLK");
    w.g(8, "0");
  }
  w.g(0, "ENDSEC");
  w.g(0, "SECTION");
  w.g(2, "ENTITIES");
  w.append(main);
  w.g(0, "ENDSEC");
  w.g(0, "EOF");
  if (model.layouts?.some((l) => l.entities.length)) ctx.warn.add(tr("DXF R12: rozvržení (papírový prostor) se nezapisují – jen modelový prostor"));
  const renamed = [layerNames, ltNames, styleNames, blockNames].flatMap((n) => n.renamed);
  if (renamed.length) ctx.warn.add(tr("DXF R12: stejné názvy po úpravě pro R12 (velká písmena, bez diakritiky, 31 znaků) – přejmenováno: {0}", renamed.slice(0, 8).join(", ") + (renamed.length > 8 ? " …" : "")));
  return { text: w.out.join("\r\n") + "\r\n", warnings: [...ctx.warn] };
}

/**
 * Obálka entity pro rozsah výkresu R12: druhy jádra přes registr, ostatní (vložení bloku, šrafa, kóta, odkaz,
 * tolerance, MTEXT, atributy) z vlastní náhradní geometrie – i když balík druhu není načtený.
 */
function extBox(ctx: Ctx, e: DraftEntity, memo: Map<string, Box | null>, depth: number): Box | null {
  const b = entityBox(e, ctx.kctx);
  if (b || depth > 8) return b;
  const sub = (parts: NewEntity[]) => {
    let bb = emptyBox();
    for (const [i, p] of parts.entries()) {
      const x = extBox(ctx, { ...p, id: `${e.id}.${i}`, layer: p.layer ?? e.layer } as DraftEntity, memo, depth + 1);
      if (x) bb = boxUnion(bb, x);
    }
    return isEmptyBox(bb) ? null : bb;
  };
  try {
    switch (e.type) {
      case "insert": {
        const ins = e as DInsert;
        const def = (ctx.model.blocks ?? []).find((x) => x.name === ins.block);
        if (!def) return null;
        if (!memo.has(def.name)) {
          memo.set(def.name, null); // ochrana proti cyklu
          let bb = emptyBox();
          for (const c of def.entities) {
            const x = c.type === "attdef" ? null : extBox(ctx, c, memo, depth + 1);
            if (x) bb = boxUnion(bb, x);
          }
          memo.set(def.name, isEmptyBox(bb) ? null : bb);
        }
        const bb = memo.get(def.name);
        const pts: Vec2[] = [];
        const r = rad(ins.rot ?? 0);
        const co = Math.cos(r);
        const si = Math.sin(r);
        const cols = Math.max(1, ins.cols ?? 1);
        const rows = Math.max(1, ins.rows ?? 1);
        for (const [cx, cy] of [[0, 0], [cols - 1, 0], [0, rows - 1], [cols - 1, rows - 1]]) {
          const ox = cx * (ins.colSpacing ?? 0);
          const oy = cy * (ins.rowSpacing ?? 0);
          const corners: Vec2[] = bb ? [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x1, bb.y1], [bb.x0, bb.y1]] : [def.base];
          for (const q of corners) {
            const x = (q[0] - def.base[0]) * ins.sx + ox;
            const y = (q[1] - def.base[1]) * ins.sy + oy;
            pts.push([ins.p[0] + x * co - y * si, ins.p[1] + x * si + y * co]);
          }
        }
        for (const a of ins.attribs ?? []) if (!a.invisible) pts.push(a.p);
        return boxOf(pts);
      }
      case "hatch":
        return boxOf((e as DHatch).loops.flatMap((l) => l.pts));
      case "dimension":
        return sub(explodeOf(ctx, e) ?? dimensionGeometry(e as DDimension, ctx.model).ents);
      case "leader":
        return sub(explodeOf(ctx, e) ?? leaderGeometry(e as DLeader, ctx.model));
      case "tolerance":
        return sub(toleranceGeometry(e as DTolerance));
      case "mtext":
        return sub(explodeOf(ctx, e) ?? mtextAsText(e as DMText));
      case "attdef": {
        const a = e as DAttDef;
        return entityBox({ ...a, type: "text", s: a.def || a.tag } as unknown as DraftEntity, ctx.kctx);
      }
      case "viewport":
        return null;
      default: {
        const parts = explodeOf(ctx, e);
        return parts ? sub(parts) : null;
      }
    }
  } catch {
    return null;
  }
}

function blockHeader(w: W, name: string, base: Vec2, attribs: boolean) {
  w.g(0, "BLOCK");
  w.g(8, "0");
  w.g(2, name);
  w.g(70, (name.startsWith("*") ? 1 : 0) | (attribs ? 2 : 0));
  w.pt(10, base);
  w.g(3, name);
}

function common(ctx: Ctx, w: W, type: string, e: DraftEntity) {
  w.g(0, type);
  w.g(8, ctx.layer.get(e.layer) ?? "0");
  if (e.linetype && !/^bylayer$/i.test(e.linetype)) w.g(6, /^byblock$/i.test(e.linetype) ? "BYBLOCK" : /^continuous$/i.test(e.linetype) ? "CONTINUOUS" : ctx.lt.get(e.linetype.toLowerCase()) ?? "CONTINUOUS");
  const c = aci(e.color);
  if (c !== null) w.g(62, c);
}

function textOut(ctx: Ctx, w: W, type: "TEXT" | "ATTRIB" | "ATTDEF", t: DText, extra?: (w: W) => void) {
  common(ctx, w, type, t);
  const fr = textFrame(t, ctx.kctx);
  const two = t.halign === "aligned" || t.halign === "fit";
  w.pt(10, two ? t.p : fr.s);
  w.g(40, t.h);
  w.g(1, r12Text(t.s));
  if (t.rot) w.g(50, t.rot);
  if (t.wf && t.wf !== 1) w.g(41, t.wf);
  if (t.oblique) w.g(51, t.oblique);
  if (t.style) w.g(7, ctx.style.get(t.style.toLowerCase()) ?? "STANDARD");
  const ha = H_ALIGN.indexOf(t.halign ?? "left");
  const va = V_ALIGN.indexOf(t.valign ?? "baseline");
  if (ha > 0) w.g(72, ha);
  if (ha > 0 || va > 0) w.pt(11, two ? t.p2 ?? t.p : t.p);
  extra?.(w);
  if (va > 0) w.g(type === "TEXT" ? 73 : 74, va);
}

function polyOut(ctx: Ctx, w: W, e: DraftEntity, pts: Vec2[], o: { closed?: boolean; bulges?: number[]; widths?: [number, number][]; width?: number; z?: number[] } = {}) {
  if (pts.length < 2) return;
  const is3d = !!o.z;
  common(ctx, w, "POLYLINE", e);
  w.g(66, 1);
  w.pt(10, [0, 0]);
  w.g(70, (o.closed ? 1 : 0) | (is3d ? 8 : 0));
  if (o.width) {
    w.g(40, o.width);
    w.g(41, o.width);
  }
  pts.forEach((p, i) => {
    w.g(0, "VERTEX");
    w.g(8, ctx.layer.get(e.layer) ?? "0");
    w.pt(10, p, o.z?.[i] ?? 0);
    const wd = o.widths?.[i];
    if (wd && !is3d) {
      w.g(40, wd[0]);
      w.g(41, wd[1]);
    }
    const b = o.bulges?.[i] ?? 0;
    if (b && !is3d) w.g(42, b);
    if (is3d) w.g(70, 32);
  });
  w.g(0, "SEQEND");
  w.g(8, ctx.layer.get(e.layer) ?? "0");
}

/** entity rozkladu v souřadnicích výkresu (stejné vlastnosti jako zdroj) */
function writeParts(ctx: Ctx, w: W, e: DraftEntity, parts: NewEntity[]) {
  parts.forEach((p, i) => writeEntity(ctx, w, { ...e, ...p, id: `${e.id}.${i}`, layer: p.layer ?? e.layer, ext: undefined } as DraftEntity));
}
const explodeOf = (ctx: Ctx, e: DraftEntity): NewEntity[] | null => {
  try {
    return kindOf(e)?.explode?.(e, ctx.kctx) ?? null;
  } catch {
    return null;
  }
};

function writeEntity(ctx: Ctx, w: W, e: DraftEntity) {
  switch (e.type) {
    case "point":
      common(ctx, w, "POINT", e);
      w.pt(10, e.p);
      return;
    case "line":
      common(ctx, w, "LINE", e);
      w.pt(10, e.a);
      w.pt(11, e.b);
      return;
    case "circle":
      common(ctx, w, "CIRCLE", e);
      w.pt(10, e.c);
      w.g(40, e.r);
      return;
    case "arc":
      common(ctx, w, "ARC", e);
      w.pt(10, e.c);
      w.g(40, e.r);
      w.g(50, e.a0);
      w.g(51, e.a1);
      return;
    case "xline":
    case "ray": {
      const L = ctx.ext;
      const a: Vec2 = e.type === "ray" ? e.p : [e.p[0] - e.dir[0] * L, e.p[1] - e.dir[1] * L];
      common(ctx, w, "LINE", e);
      w.pt(10, a);
      w.pt(11, [e.p[0] + e.dir[0] * L, e.p[1] + e.dir[1] * L]);
      return;
    }
    case "polyline": {
      const same = !!e.ext?.key && e.ext.key === geomKey(e);
      if (same && e.ext?.dxf === "3DFACE") {
        const z = e.ext.z ?? [];
        common(ctx, w, "3DFACE", e);
        for (let i = 0; i < 4; i++) w.pt(10 + i, e.pts[Math.min(i, e.pts.length - 1)], z[Math.min(i, z.length - 1)] ?? 0);
        return;
      }
      polyOut(ctx, w, e, e.pts, { closed: e.closed, bulges: e.bulges, widths: e.widths, width: e.width, ...(same && e.ext?.dxf === "POLYLINE3D" ? { z: e.ext.z } : {}) });
      return;
    }
    case "ellipse":
    case "spline": {
      // odchylka od křivky ≤ 0,005 mm bez ohledu na velikost (CAM / laser)
      const pts = entityCurves(e, ctx.kctx).flatMap((c, i) => flattenCurve(c, ctx.tol).slice(i ? 1 : 0));
      const closed = e.type === "spline" ? !!e.closed : e.t0 === undefined;
      if (closed && pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < ctx.tol) pts.pop();
      polyOut(ctx, w, e, pts, { closed });
      return;
    }
    case "text":
      textOut(ctx, w, "TEXT", e);
      return;
    case "mtext":
      writeParts(ctx, w, e, explodeOf(ctx, e) ?? mtextAsText(e as DMText));
      return;
    case "dimension": {
      const d = e as DDimension;
      const parts = explodeOf(ctx, e) ?? dimensionGeometry(d, ctx.model).ents;
      const name = ctx.blockNames.anon("*D");
      ctx.extra.push({ name, ents: parts });
      common(ctx, w, "DIMENSION", e);
      w.g(2, name);
      const z: Vec2 = [0, 0];
      const def = d.kind === "linear" || d.kind === "aligned" ? d.line ?? z : d.kind === "radius" ? d.center ?? z : d.kind === "diameter" ? d.far ?? z : d.kind === "angular" ? d.l2?.[1] ?? z : d.kind === "ordinate" ? d.origin ?? z : d.arc ?? z;
      w.pt(10, def);
      const tp = d.textPos ?? (parts.find((p) => p.type === "text") as { p: Vec2 } | undefined)?.p ?? def;
      w.pt(11, tp);
      const type = { linear: 0, aligned: 1, angular: 2, diameter: 3, radius: 4, angular3: 5, ordinate: 6, arc: 1 }[d.kind] | (d.xAxis ? 64 : 0);
      w.g(70, type);
      if (d.text) w.g(1, d.text);
      if (d.kind === "linear" || d.kind === "aligned" || d.kind === "arc") {
        w.pt(13, d.p1 ?? z);
        w.pt(14, d.p2 ?? z);
        if (d.kind === "linear") w.g(50, d.rot ?? 0);
      } else if (d.kind === "radius" || d.kind === "diameter") w.pt(15, d.chord ?? z);
      else if (d.kind === "angular") {
        w.pt(13, d.l1?.[0] ?? z);
        w.pt(14, d.l1?.[1] ?? z);
        w.pt(15, d.l2?.[0] ?? z);
        w.pt(16, d.arc ?? z);
      } else if (d.kind === "angular3") {
        w.pt(13, d.p1 ?? z);
        w.pt(14, d.p2 ?? z);
        w.pt(15, d.vertex ?? z);
      } else if (d.kind === "ordinate") {
        w.pt(13, d.p1 ?? z);
        w.pt(14, d.p2 ?? z);
      }
      if (d.kind === "arc") ctx.warn.add(tr("DXF R12: kóta délky oblouku zapsána jako zarovnaná (R12 ji nezná)"));
      return;
    }
    case "leader":
      writeParts(ctx, w, e, explodeOf(ctx, e) ?? leaderGeometry(e as DLeader, ctx.model));
      return;
    case "tolerance":
      // rámeček vlastní geometrií: značky GD&T stylem s písmem gdt.shx (jako AutoCAD), ne obecným rozkladem
      writeParts(ctx, w, e, toleranceGeometry(e as DTolerance).map((p) => (p.type === "text" && (p as { gdt?: boolean }).gdt ? ({ ...p, style: ctx.gdt || undefined } as NewEntity) : p)));
      return;
    case "hatch": {
      const hh = e as DHatch;
      if (hh.solid || /^solid$/i.test(hh.pattern) || hh.gradient) {
        const tris = hh.loops.length === 1 && hh.loops[0].pts.length <= 4 && !hh.loops[0].bulges?.some((b) => b) ? [hh.loops[0].pts] : solidTriangles(hh);
        if (tris) {
          for (const t of tris) {
            common(ctx, w, "SOLID", e);
            w.pt(10, t[0]);
            w.pt(11, t[1]);
            w.pt(12, t[3] ?? t[2]);
            w.pt(13, t[2]);
          }
          return;
        }
        ctx.warn.add(tr("DXF R12: plná šrafa s ostrovy zapsána jen hranicí"));
        for (const l of hh.loops) polyOut(ctx, w, e, l.pts, { closed: true, bulges: l.bulges });
        return;
      }
      const segs = hatchPatternSegments(hh, ctx.model.vars.measurement === 1);
      const name = ctx.blockNames.anon("*X");
      ctx.extra.push({ name, ents: segs.map(([a, b]) => ({ type: "line", a, b }) as NewEntity) });
      common(ctx, w, "INSERT", e);
      w.g(2, name);
      w.pt(10, [0, 0]);
      return;
    }
    case "insert": {
      const ins = e as DInsert;
      const name = ctx.blocks.get(ins.block);
      if (!name) {
        ctx.warn.add(tr("DXF R12: blok {0} chybí", ins.block));
        return;
      }
      common(ctx, w, "INSERT", e);
      if (ins.attribs?.length) w.g(66, 1);
      w.g(2, name);
      w.pt(10, ins.p);
      if (ins.sx !== 1) w.g(41, ins.sx);
      if (ins.sy !== 1) w.g(42, ins.sy);
      if (ins.rot) w.g(50, ins.rot);
      if ((ins.cols ?? 1) > 1 || (ins.rows ?? 1) > 1) {
        w.g(70, ins.cols ?? 1);
        w.g(71, ins.rows ?? 1);
        w.g(44, ins.colSpacing ?? 0);
        w.g(45, ins.rowSpacing ?? 0);
      }
      if (ins.attribs?.length) {
        for (const a of ins.attribs) attribOut(ctx, w, a, ins);
        w.g(0, "SEQEND");
        w.g(8, ctx.layer.get(e.layer) ?? "0");
      }
      return;
    }
    case "attdef": {
      const a = e as DAttDef;
      textOut(ctx, w, "ATTDEF", { ...a, type: "text", s: a.def ?? "" } as unknown as DText, (ww) => {
        ww.g(3, r12Text(a.prompt ?? ""));
        ww.g(2, r12Name(a.tag));
        ww.g(70, (a.invisible ? 1 : 0) | (a.constant ? 2 : 0) | (a.verify ? 4 : 0) | (a.preset ? 8 : 0));
      });
      return;
    }
    case "viewport":
      ctx.warn.add(tr("DXF R12: výřezy rozvržení se nezapisují"));
      return;
  }
  otherKind(ctx, w, e as DraftEntity);
}

/** druh, který tento modul nezná (budoucí balík): rozložit, umí-li to */
function otherKind(ctx: Ctx, w: W, e: DraftEntity) {
  const parts: NewEntity[] = explodeOf(ctx, e) ?? [];
  if (parts.length) writeParts(ctx, w, e, parts);
  else ctx.warn.add(tr("DXF R12: druh {0} nelze zapsat", e.type));
}

function attribOut(ctx: Ctx, w: W, a: DAttrib, ins: DInsert) {
  const t = { type: "text", id: "", layer: a.layer ?? ins.layer, color: a.color ?? ins.color, p: a.p, h: a.h, s: a.value ?? "", rot: a.rot, style: a.style, halign: a.halign, valign: a.valign, p2: a.p2, wf: a.wf } as DText;
  textOut(ctx, w, "ATTRIB", t, (ww) => {
    ww.g(2, r12Name(a.tag));
    ww.g(70, a.invisible ? 1 : 0);
  });
}
