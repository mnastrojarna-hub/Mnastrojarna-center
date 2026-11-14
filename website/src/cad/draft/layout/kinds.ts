/**
 * BALÍK 3 (layout) – druhy entit: vložení bloku (`insert`, i pole MINSERT a atributy), definice atributu (`attdef`)
 * a výřez rozvržení (`viewport`).
 *
 * Vložení se kreslí jako vnořené entity (`sub`) s transformací bloku; vrstva 0 uvnitř bloku převezme hladinu vložení
 * a ByBlock vlastnosti vložení (zajistí renderer). Výřez kreslí rám a obsah modelového prostoru oříznutý obrysem –
 * obsah je ve vnitřní pomocné entitě, aby zvýraznění vybraného výřezu obtáhlo jen rám (ne celý model).
 */
import { tr } from "../../i18n";
import { cClosest, cTransform, type Curve } from "../curves";
import { add, boxOf, boxUnion, dist, emptyBox, IDENTITY, isEmptyBox, mid, sub, xfAngle, xfDet, xfPt, xfUniform, xfVec, type Affine, type Box } from "../geom";
import { entityBox, entityCurves, invalidateGeometry, kindOf, noTransform, registerKind, type DraftField, type KindCtx, type Prim, type SnapPt } from "../kinds";
import { parsePt } from "../kinds-core";
import type { DText, DraftEntity, DraftModel, NewEntity, TextHAlign, TextVAlign, Vec2 } from "../model";
import { evalNumber, normDeg } from "../units";
import { attToText, blockDrawList, blockLocalBox, findBlock, insertCells, transformAttrib, withBlock, xfBox } from "./blocks";
import type { DAttDef, DAttrib, DInsert, DViewport } from "./types";
import { cosSinDeg, insertXf, parseRatio, ratioToScale, scaleToRatio, unitMm, vpPolygon, vpScaleLabel, vpXf } from "./util";
import { annoScaledList } from "../annot/anno";

const num = (raw: string, what: string): number => {
  const v = evalNumber(raw, true);
  if (!Number.isFinite(v)) throw new Error(tr("{0}: očekávám číslo, ne „{1}“", what, raw));
  return v;
};
const pos = (raw: string, what: string): number => {
  const v = num(raw, what);
  if (!(v > 0)) throw new Error(tr("{0} musí být kladné", what));
  return v;
};
const bool = (raw: string) => /^(1|true|ano|yes|ja|on|zap|ein)$/i.test(raw.trim());
const unknownField = (key: string, keys: string[]) => new Error(tr("neznámá vlastnost „{0}“ – možné: {1}", key, keys.join(", ")));
const f = (key: string, label: string, value: string | number, kind: DraftField["kind"], readonly?: boolean): DraftField => ({ key, label, value, kind, ...(readonly ? { readonly } : {}) });
const ptStr = (p: Vec2) => `${p[0]},${p[1]}`;
const textKind = () => kindOf("text")!;

// ---------------------------------------------------------------- vložení bloku

/** transformace buněk vložení (bez bloku = žádná) */
function cellXfs(e: DInsert, ctx: KindCtx): { xf: Affine; blk: ReturnType<typeof findBlock> }[] {
  const blk = findBlock(ctx.model, e.block);
  if (!blk) return [];
  return insertCells(e).map(([c, r]) => ({ xf: insertXf(e, blk.base, c, r), blk }));
}

/** atributy jako texty k vykreslení (hladina chybí = hladina vložení, barva chybí = ByBlock) */
function attribTexts(e: DInsert): DText[] {
  return (e.attribs ?? []).filter((a) => !a.invisible && a.value).map((a, i) => attToText(a, a.value, { id: `${e.id}~a${i}`, layer: a.layer ?? e.layer, color: a.color ?? "ByBlock" }));
}

function insertCurves(e: DInsert, ctx: KindCtx): Curve[] {
  return withBlock(
    e.block,
    () => {
      const out: Curve[] = [];
      for (const { xf, blk } of cellXfs(e, ctx)) for (const ch of blockDrawList(blk!)) for (const c of entityCurves(ch, ctx)) out.push(cTransform(c, xf));
      return out;
    },
    [],
  );
}

/** úhel a měřítka vložení po afinní transformaci (zrcadlení = záporné měřítko X jako AutoCAD); null = zkosení */
function decompose(e: DInsert, m: Affine): { rot: number; sx: number; sy: number } | null {
  const sx = e.sx ?? 1;
  const sy = e.sy ?? 1;
  const roundRot = (r: number) => {
    const n = normDeg(r);
    const k = Math.round(n * 1e9) / 1e9;
    return Math.abs(n - Math.round(n)) < 1e-9 ? Math.round(n) % 360 : k;
  };
  const k0 = xfUniform(m);
  const k = k0 !== null && Math.abs(k0 - 1) < 1e-12 ? 1 : k0;
  if (k !== null && xfDet(m) > 0) return { rot: roundRot((e.rot ?? 0) + (xfAngle(m) * 180) / Math.PI), sx: sx * k, sy: sy * k };
  const [c, s] = cosSinDeg(e.rot ?? 0);
  // A = L(m) · R(rot) · S = R(θ) · diag(sx', sy')
  const a1 = xfVec(m, [c * sx, s * sx]);
  const a2 = xfVec(m, [-s * sy, c * sy]);
  const n1 = Math.hypot(a1[0], a1[1]);
  if (n1 < 1e-300) return null;
  const flip = a1[0] * a2[1] - a1[1] * a2[0] < 0;
  const u: Vec2 = flip ? [-a1[0] / n1, -a1[1] / n1] : [a1[0] / n1, a1[1] / n1];
  const nsx = flip ? -n1 : n1;
  const nsy = -u[1] * a2[0] + u[0] * a2[1];
  // kolmost os (jinak zkosení – vložení to nevyjádří)
  if (Math.abs(u[0] * a2[0] + u[1] * a2[1]) > 1e-9 * Math.max(1, Math.abs(nsy))) return null;
  return { rot: roundRot((Math.atan2(u[1], u[0]) * 180) / Math.PI), sx: nsx, sy: nsy };
}

registerKind<"insert">({
  type: "insert",
  label: () => tr("Vložení bloku"),
  curves: insertCurves,
  prims: (e, ctx) => {
    const out: Prim[] = [];
    const ltk = insertLtk.get(e);
    for (const { xf, blk } of cellXfs(e, ctx)) out.push({ k: "sub", entities: ltk ? ltScaledList(blockDrawList(blk!), ltk) : blockDrawList(blk!), xf });
    const ats = attribTexts(e);
    if (ats.length) out.push({ k: "sub", entities: ats, xf: IDENTITY });
    if (!out.length) {
      // chybějící definice bloku: značka v bodě vložení
      const r = 2 * Math.max(Math.abs(e.sx ?? 1), 1e-9);
      out.push({ k: "path", segs: [{ k: "L", a: [e.p[0] - r, e.p[1] - r], b: [e.p[0] + r, e.p[1] + r] }, { k: "L", a: [e.p[0] - r, e.p[1] + r], b: [e.p[0] + r, e.p[1] - r] }] });
    }
    return out;
  },
  bbox: (e, ctx) => {
    let b = emptyBox();
    const blk = findBlock(ctx.model, e.block);
    const lb = blk ? blockLocalBox(blk, ctx) : null;
    if (blk && lb) {
      const cells = insertCells(e);
      const cols = Math.max(...cells.map((x) => x[0]));
      const rows = Math.max(...cells.map((x) => x[1]));
      for (const [c, r] of [[0, 0], [cols, 0], [0, rows], [cols, rows]] as [number, number][]) b = boxUnion(b, xfBox(lb, insertXf(e, blk.base, c, r)));
    }
    for (const t of attribTexts(e)) {
      const tb = textKind().bbox(t, ctx);
      if (tb) b = boxUnion(b, tb);
    }
    if (isEmptyBox(b)) b = { x0: e.p[0], y0: e.p[1], x1: e.p[0], y1: e.p[1] };
    return b;
  },
  snaps: (e, ctx) => {
    const out: SnapPt[] = [];
    const cells = cellXfs(e, ctx);
    for (const [c, r] of insertCells(e)) out.push({ kind: "ins", p: c || r ? xfPt(insertXf(e, [0, 0], c, r), [0, 0]) : e.p });
    withBlock(
      e.block,
      () => {
        for (const { xf, blk } of cells) {
          for (const ch of blockDrawList(blk!)) {
            for (const s of kindOf(ch)?.snaps(ch, ctx) ?? []) out.push({ kind: s.kind, p: xfPt(xf, s.p) });
            if (out.length > 4000) return;
          }
        }
      },
      undefined,
    );
    for (const a of e.attribs ?? []) if (!a.invisible) out.push({ kind: "ins", p: a.p });
    return out;
  },
  grips: (e) => [e.p, ...(e.attribs ?? []).filter((a) => !a.invisible).map((a) => a.p)],
  moveGrip: (e, i, p) => {
    if (i === 0) {
      const d = sub(p, e.p);
      return { ...e, p, ...(e.attribs ? { attribs: e.attribs.map((a) => ({ ...a, p: add(a.p, d), ...(a.p2 ? { p2: add(a.p2, d) } : {}) })) } : {}) };
    }
    const vis = (e.attribs ?? []).map((a, k) => [a, k] as const).filter(([a]) => !a.invisible);
    const hit = vis[i - 1];
    if (!hit) return null;
    const [a, k] = hit;
    const d = sub(p, a.p);
    const attribs = [...(e.attribs ?? [])];
    attribs[k] = { ...a, p, ...(a.p2 ? { p2: add(a.p2, d) } : {}) };
    return { ...e, attribs };
  },
  transform: (e, m, ctx) => {
    const dc = decompose(e, m);
    if (!dc) return null;
    const out: DInsert = { ...e, p: xfPt(m, e.p), rot: dc.rot, sx: dc.sx, sy: dc.sy };
    if ((e.cols ?? 1) > 1 || (e.rows ?? 1) > 1) {
      out.colSpacing = (e.colSpacing ?? 0) * (dc.sx / (e.sx || 1));
      out.rowSpacing = (e.rowSpacing ?? 0) * (dc.sy / (e.sy || 1));
    }
    if (e.attribs) {
      const at: DAttrib[] = [];
      for (const a of e.attribs) {
        const t = transformAttrib(a, m, ctx);
        if (!t) return null;
        at.push(t);
      }
      out.attribs = at;
    }
    return out;
  },
  info: (e, ctx, F) => {
    const blk = findBlock(ctx.model, e.block);
    const rows: [string, string][] = [
      [tr("Blok"), blk ? e.block : tr("{0} (definice chybí)", e.block)],
      [tr("Bod vložení"), F.pt(e.p)],
      [tr("Měřítko X / Y"), `${e.sx ?? 1} / ${e.sy ?? 1}`],
      [tr("Natočení"), F.ang(e.rot ?? 0)],
    ];
    if ((e.cols ?? 1) > 1 || (e.rows ?? 1) > 1) rows.push([tr("Pole (sloupce × řádky)"), `${e.cols ?? 1} × ${e.rows ?? 1} · ${F.len(e.colSpacing ?? 0)} / ${F.len(e.rowSpacing ?? 0)}`]);
    for (const a of e.attribs ?? []) rows.push([`${tr("Atribut")} ${a.tag}`, `${a.value}${a.invisible ? ` (${tr("neviditelný")})` : ""}`]);
    return rows;
  },
  fields: (e, _ctx, F) => [
    f("block", tr("Blok"), e.block, "text"),
    f("p", tr("Bod vložení"), ptStr(e.p), "pt"),
    f("sx", tr("Měřítko X"), e.sx ?? 1, "num"),
    f("sy", tr("Měřítko Y"), e.sy ?? 1, "num"),
    f("rot", tr("Natočení"), F.ang(e.rot ?? 0), "angle"),
    ...((e.cols ?? 1) > 1 || (e.rows ?? 1) > 1
      ? [f("cols", tr("Sloupce"), e.cols ?? 1, "int"), f("rows", tr("Řádky"), e.rows ?? 1, "int"), f("colSpacing", tr("Rozteč sloupců"), e.colSpacing ?? 0, "num"), f("rowSpacing", tr("Rozteč řádků"), e.rowSpacing ?? 0, "num")]
      : []),
    ...(e.attribs ?? []).map((a) => f(`att.${a.tag}`, a.tag, a.value, "text")),
  ],
  setField: (e, key, raw, ctx) => {
    if (key === "block") {
      const b = findBlock(ctx.model, raw.trim());
      if (!b) throw new Error(tr("blok „{0}“ ve výkresu není – bloky: {1}", raw, (ctx.model.blocks ?? []).filter((x) => !x.anonymous).map((x) => x.name).join(", ")));
      return { ...e, block: b.name };
    }
    if (key === "p") {
      const p = parsePt(raw);
      const d = sub(p, e.p);
      return { ...e, p, ...(e.attribs ? { attribs: e.attribs.map((a) => ({ ...a, p: add(a.p, d), ...(a.p2 ? { p2: add(a.p2, d) } : {}) })) } : {}) };
    }
    if (key === "sx" || key === "sy" || key === "rot") {
      // změna měřítka / natočení kolem bodu vložení – atributy se transformují s vložením
      const v = num(raw.replace("°", ""), key);
      if (key !== "rot" && v === 0) throw new Error(tr("měřítko nesmí být 0"));
      const target: DInsert = { ...e, [key]: key === "rot" ? normDeg(v) : v };
      const blk = findBlock(ctx.model, e.block);
      if (!e.attribs?.length || !blk) return target;
      const m = mulXf(insertXf(target, blk.base), invXf(insertXf(e, blk.base)));
      const at = e.attribs.map((a) => transformAttrib(a, m, ctx) ?? a);
      return { ...target, attribs: at };
    }
    if (key === "cols" || key === "rows") {
      const v = Math.round(num(raw, key));
      if (v < 1 || v > 10000) throw new Error(tr("počet musí být 1–10 000"));
      return { ...e, [key]: v };
    }
    if (key === "colSpacing" || key === "rowSpacing") return { ...e, [key]: num(raw, key) };
    if (key.startsWith("att.")) {
      const tag = key.slice(4);
      const i = (e.attribs ?? []).findIndex((a) => a.tag.toLowerCase() === tag.toLowerCase());
      if (i < 0) throw new Error(tr("vložení {0} nemá atribut {1} – atributy: {2}", e.id, tag, (e.attribs ?? []).map((a) => a.tag).join(", ") || "—"));
      const attribs = [...e.attribs!];
      attribs[i] = { ...attribs[i], value: raw };
      return { ...e, attribs };
    }
    throw unknownField(key, ["block", "p", "sx", "sy", "rot", "cols", "rows", "colSpacing", "rowSpacing", "att.ZNAČKA"]);
  },
  hitDist: (e, p, ctx) => {
    const cs = entityCurves(e, ctx);
    let d = Infinity;
    for (const c of cs) d = Math.min(d, cClosest(c, p).d);
    for (const t of attribTexts(e)) d = Math.min(d, textKind().hitDist?.(t, p, ctx) ?? Infinity);
    if (Number.isFinite(d)) return d;
    // blok bez křivek (jen texty): vzdálenost od obálky
    const b = entityBox(e, ctx);
    if (!b) return dist(p, e.p);
    const dx = p[0] < b.x0 ? b.x0 - p[0] : p[0] > b.x1 ? p[0] - b.x1 : 0;
    const dy = p[1] < b.y0 ? b.y0 - p[1] : p[1] > b.y1 ? p[1] - b.y1 : 0;
    return Math.hypot(dx, dy);
  },
  explode: (e, ctx) => {
    // jako AutoCAD: obsah bloku v souřadnicích výkresu (vlastnosti beze změny, hladina 0 zůstane 0), definice
    // atributů se vrátí jako definice (hodnoty atributů se ztratí), pole MINSERT = všechny buňky
    const blk = findBlock(ctx.model, e.block);
    if (!blk) return null;
    const out: NewEntity[] = [];
    for (const { xf } of cellXfs(e, ctx)) {
      for (const ch of blk.entities) {
        const t = kindOf(ch)?.transform(ch, xf, ctx);
        if (!t) continue;
        const { id: _id, ...rest } = t as DraftEntity & { id: string };
        void _id;
        out.push(rest as unknown as NewEntity);
      }
    }
    return out;
  },
});

const mulXf = (a: Affine, b: Affine): Affine => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
function invXf(m: Affine): Affine {
  const d = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / d;
  const b = -m[1] / d;
  const c = -m[2] / d;
  const dd = m[0] / d;
  return [a, b, c, dd, -(a * m[4] + c * m[5]), -(b * m[4] + dd * m[5])];
}

// ---------------------------------------------------------------- definice atributu

const attText = (e: DAttDef): DText => attToText(e, e.tag, { id: e.id, layer: e.layer, color: e.color });

registerKind<"attdef">({
  type: "attdef",
  label: () => tr("Definice atributu"),
  curves: () => [],
  prims: (e, ctx) => textKind().prims(attText(e), ctx),
  bbox: (e, ctx) => textKind().bbox(attText(e), ctx),
  snaps: (e) => [{ kind: "ins", p: e.p }, ...(e.p2 ? [{ kind: "ins" as const, p: e.p2 }] : [])],
  grips: (e) => [e.p, ...(e.p2 ? [e.p2] : [])],
  moveGrip: (e, i, p) => (i === 0 ? (e.p2 ? { ...e, p, p2: add(e.p2, sub(p, e.p)) } : { ...e, p }) : { ...e, p2: p }),
  transform: (e, m, ctx) => {
    const t = textKind().transform(attText(e), m, ctx) as DText | null;
    if (!t || t.type !== "text") return null;
    const out: DAttDef = { ...e, p: t.p, h: t.h, ...(t.rot ? { rot: t.rot } : {}), ...(t.p2 ? { p2: t.p2 } : {}) };
    if (!t.rot) delete out.rot;
    return out;
  },
  info: (e, _ctx, F) => [
    [tr("Značka"), e.tag],
    [tr("Výzva"), e.prompt],
    [tr("Výchozí hodnota"), e.def],
    [tr("Bod vložení"), F.pt(e.p)],
    [tr("Výška"), F.len(e.h)],
    [tr("Natočení"), F.ang(e.rot ?? 0)],
    [tr("Režimy"), [e.invisible ? tr("neviditelný") : "", e.constant ? tr("konstantní") : "", e.verify ? tr("ověřit") : "", e.preset ? tr("předvolba") : ""].filter(Boolean).join(", ") || "—"],
  ],
  fields: (e, ctx, F) => [
    f("tag", tr("Značka"), e.tag, "text"),
    f("prompt", tr("Výzva"), e.prompt, "text"),
    f("def", tr("Výchozí hodnota"), e.def, "text"),
    f("p", tr("Bod vložení"), ptStr(e.p), "pt"),
    f("h", tr("Výška"), F.len(e.h), "num"),
    f("rot", tr("Natočení"), F.ang(e.rot ?? 0), "angle"),
    f("style", tr("Styl"), e.style ?? ctx.model.vars.textstyle, "text"),
    f("halign", tr("Zarovnání vodorovně"), e.halign ?? "left", "text"),
    f("valign", tr("Zarovnání svisle"), e.valign ?? "baseline", "text"),
    f("invisible", tr("Neviditelný"), e.invisible ? 1 : 0, "bool"),
    f("constant", tr("Konstantní"), e.constant ? 1 : 0, "bool"),
    f("verify", tr("Ověřit"), e.verify ? 1 : 0, "bool"),
    f("preset", tr("Předvolba"), e.preset ? 1 : 0, "bool"),
  ],
  setField: (e, key, raw, ctx) => {
    if (key === "tag") {
      const t = raw.trim().toUpperCase();
      if (!t || /\s/.test(t)) throw new Error(tr("značka atributu nesmí být prázdná ani obsahovat mezery"));
      return { ...e, tag: t };
    }
    if (key === "prompt") return { ...e, prompt: raw };
    if (key === "def") return { ...e, def: raw };
    if (key === "p") return { ...e, p: parsePt(raw) };
    if (key === "h") return { ...e, h: pos(raw, tr("Výška")) };
    if (key === "rot") return { ...e, rot: normDeg(num(raw.replace("°", ""), tr("Natočení"))) };
    if (key === "invisible" || key === "constant" || key === "verify" || key === "preset") return { ...e, [key]: bool(raw) };
    if (key === "style" || key === "halign" || key === "valign") {
      const t = textKind().setField(attText(e), key, raw, ctx) as DText;
      return { ...e, style: t.style, halign: t.halign as TextHAlign | undefined, valign: t.valign as TextVAlign | undefined };
    }
    throw unknownField(key, ["tag", "prompt", "def", "p", "h", "rot", "style", "halign", "valign", "invisible", "constant", "verify", "preset"]);
  },
  hitDist: (e, p, ctx) => textKind().hitDist?.(attText(e), p, ctx) ?? dist(p, e.p),
  explode: (e) => {
    // definice atributu → text se značkou (jako AutoCAD při rozložení mimo blok nelze; tady pro úplnost)
    const { id: _id, ...t } = attText(e);
    void _id;
    return [t as unknown as NewEntity];
  },
});

// ---------------------------------------------------------------- výřez

/** vnitřní pomocná entita s obsahem modelu (zvýraznění vybraného výřezu obtáhne jen rám) */
const innerSet = new WeakSet<DraftEntity>();
const innerOf = new WeakMap<DViewport, { inner: DViewport; list: DraftEntity[] }>();
/** seznam modelu, ze kterého byl obsah výřezu naposledy spočítán (GUI podle něj zahodí zastaralou mezipaměť) */
export const vpContentSource = new WeakMap<DraftEntity, DraftEntity[]>();
function innerFor(e: DViewport): { inner: DViewport; list: DraftEntity[] } {
  let r = innerOf.get(e);
  if (!r) {
    // hladina „*VP“ neexistuje → obsah je vidět a tiskne se podle hladin svých entit (rám podle hladiny výřezu)
    const inner = { ...e, id: `${e.id}~vp`, layer: "*VP" } as DViewport;
    innerSet.add(inner);
    r = { inner, list: [inner] };
    innerOf.set(e, r);
  }
  return r;
}
export const isViewportInner = (e: DraftEntity) => innerSet.has(e);
/**
 * Obsah výřezu jako samostatně kreslitelný seznam (vnitřní entita s ořezem). GUI ho kreslí zvlášť, když je hladina
 * výřezu vypnutá / zmrazená – skryje se jen rám, obsah zůstane (jako AutoCAD; tak se rámy výřezů schovávají).
 */
export const viewportContent = (e: DViewport): DraftEntity[] => (e.on !== false && e.scale > 0 ? innerFor(e).list : []);

const frozenCache = new WeakMap<DraftEntity[], Map<string, DraftEntity[]>>();
/** entity modelu viditelné ve výřezu (bez hladin zmrazených v tomto výřezu) – stabilní identita pro prostorový index */
export function vpModelList(list: DraftEntity[], frozen: string[] | undefined): DraftEntity[] {
  if (!frozen?.length) return list;
  const key = frozen
    .map((x) => x.toLowerCase())
    .sort()
    .join("\u0001");
  let m = frozenCache.get(list);
  if (!m) frozenCache.set(list, (m = new Map()));
  let out = m.get(key);
  if (!out) {
    const fz = new Set(frozen.map((x) => x.toLowerCase()));
    out = list.filter((e) => !fz.has(e.layer.toLowerCase()));
    if (m.size > 20) m.clear();
    m.set(key, out);
  }
  return out;
}

/**
 * Entity modelu kreslené ve výřezu: bez hladin zmrazených ve výřezu a anotativní poznámky (texty, kóty se stylem
 * DIMANNO, odkazy…) v měřítku výřezu – smlouva balíku annot (`annoScaledList`, násobitel = 1 / poměr papír : skutečnost).
 * Stabilní identita seznamu (mezipaměti prostorového indexu a geometrie platí).
 */
export function vpDrawList(m: DraftModel, vp: Pick<DViewport, "scale" | "frozenLayers">): DraftEntity[] {
  const base = vpModelList(m.entities, vp.frozenLayers);
  const r = scaleToRatio(m, vp.scale);
  return r > 0 && Number.isFinite(r) ? annoScaledList(base, 1 / r, m) : base;
}

const polyClosed = (pts: Vec2[]) => ({ k: "path" as const, segs: [{ k: "P" as const, pts }], closed: true });

/**
 * PSLTSCALE = 1 (výchozí, jako AutoCAD): vzor typu čáry ve výřezu má délku v jednotkách papíru nezávisle na měřítku
 * výřezu. Renderer jádra násobí vzor měřítkem transformace (výřez 1:5 → 0,2×), proto obsah výřezu kreslí kopie entit
 * s LTSCALE objektu × `k` (= mm na jednotku / měřítko výřezu) – stejné délky čárek jako při tisku (plot.ts).
 * Kopie mají stabilní identitu (mezipaměť podle entity a `k`), vnořené bloky dostanou stejný násobek (insertLtk).
 */
const ltCopies = new WeakMap<DraftEntity, Map<number, DraftEntity>>();
const insertLtk = new WeakMap<DraftEntity, number>();
function ltScaled(e: DraftEntity, k: number): DraftEntity {
  let m = ltCopies.get(e);
  if (!m) ltCopies.set(e, (m = new Map()));
  let c = m.get(k);
  if (!c) {
    c = { ...e, ltscale: (e.ltscale ?? 1) * k } as DraftEntity;
    if (e.type === "insert") insertLtk.set(c, k);
    if (m.size > 8) m.clear();
    m.set(k, c);
  }
  return c;
}
const ltListCache = new WeakMap<readonly DraftEntity[], Map<number, DraftEntity[]>>();
/** seznam entit s násobkem vzoru čar `k` (k = 1 → beze změny) */
export function ltScaledList(list: readonly DraftEntity[], k: number): DraftEntity[] {
  if (!(k > 0) || Math.abs(k - 1) < 1e-12) return list as DraftEntity[];
  let m = ltListCache.get(list);
  if (!m) ltListCache.set(list, (m = new Map()));
  let out = m.get(k);
  if (!out) {
    out = list.map((e) => ltScaled(e, k));
    if (m.size > 8) m.clear();
    m.set(k, out);
  }
  return out;
}
/** násobek vzoru čar obsahu výřezu na obrazovce (PSLTSCALE = 1 → mm na jednotku / měřítko výřezu; 0 → 1) */
export const vpLtFactor = (m: { vars: { psltscale?: 0 | 1; units: string } }, vp: Pick<DViewport, "scale">, mmPerUnit: number): number => (m.vars.psltscale === 0 || !(vp.scale > 0) ? 1 : mmPerUnit / vp.scale);

registerKind<"viewport">({
  type: "viewport",
  label: () => tr("Výřez listu"),
  curves: (e) => {
    const pg = vpPolygon(e);
    return pg.map((p, i): Curve => ({ k: "line", a: p, b: pg[(i + 1) % pg.length], seg: i }));
  },
  prims: (e, ctx) => {
    const pg = vpPolygon(e);
    if (innerSet.has(e)) {
      vpContentSource.set(e, ctx.model.entities);
      const list = ltScaledList(vpDrawList(ctx.model, e), vpLtFactor(ctx.model, e, unitMm(ctx.model)));
      return [{ k: "sub", entities: list, xf: vpXf(e), clip: pg, byBlock: { color: 7, linetype: "Continuous", lineweight: ctx.model.vars.lwdefault } }];
    }
    const out: Prim[] = [polyClosed(pg)];
    if (e.on !== false && e.scale > 0) out.push({ k: "sub", entities: innerFor(e).list, xf: IDENTITY, clip: pg });
    return out;
  },
  bbox: (e) => boxOf(vpPolygon(e)),
  snaps: (e) => {
    const pg = vpPolygon(e);
    return [...pg.map((p) => ({ kind: "end" as const, p })), ...pg.map((p, i) => ({ kind: "mid" as const, p: mid(p, pg[(i + 1) % pg.length]) })), { kind: "cen", p: e.c }];
  },
  grips: (e) => [...vpPolygon(e), e.c],
  moveGrip: (e, i, p) => {
    const pg = vpPolygon(e);
    if (i === pg.length) {
      // střed: posun výřezu s obsahem (pohled do modelu zůstane)
      const d = sub(p, e.c);
      return { ...e, c: p, ...(e.clip ? { clip: e.clip.map((q) => add(q, d)) } : {}) };
    }
    if (e.clip && e.clip.length >= 3) {
      const clip = [...e.clip];
      clip[i] = p;
      const b = boxOf(clip);
      // střed pohledu na papíře se nemění (obsah zůstane na místě) – střed výřezu = střed obálky
      const nc: Vec2 = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
      return keepView(e, { ...e, clip, c: nc, w: b.x1 - b.x0, h: b.y1 - b.y0 });
    }
    // roh obdélníku: protější roh zůstane
    const opp = pg[(i + 2) % 4];
    const w = Math.abs(p[0] - opp[0]);
    const h = Math.abs(p[1] - opp[1]);
    if (w < 1e-9 || h < 1e-9) return null;
    return keepView(e, { ...e, c: [(p[0] + opp[0]) / 2, (p[1] + opp[1]) / 2], w, h });
  },
  transform: (e, m) => {
    const k = xfUniform(m);
    if (k === null || xfDet(m) < 0) return null;
    const ang = (xfAngle(m) * 180) / Math.PI;
    const rot = Math.abs(ang) < 1e-12 ? 0 : normDeg(ang);
    const c = xfPt(m, e.c);
    const out: DViewport = { ...e, c, scale: e.scale * k, w: e.w * k, h: e.h * k };
    if (rot) {
      out.twist = normDeg((e.twist ?? 0) + rot);
      if (Math.abs(out.twist) < 1e-12 || Math.abs(out.twist - 360) < 1e-12) delete out.twist;
      if (!e.clip && (rot === 90 || rot === 270)) {
        out.w = e.h * k;
        out.h = e.w * k;
      } else out.clip = vpPolygon(e).map((p) => xfPt(m, p));
    } else if (e.clip) out.clip = e.clip.map((p) => xfPt(m, p));
    return out;
  },
  info: (e, ctx, F) => [
    [tr("Střed na papíře"), F.pt(e.c)],
    [tr("Šířka × výška"), `${F.len(e.w)} × ${F.len(e.h)}`],
    [tr("Měřítko"), vpScaleLabel(ctx.model, e)],
    [tr("Střed pohledu (model)"), F.pt(e.viewCenter)],
    [tr("Natočení pohledu"), F.ang(e.twist ?? 0)],
    [tr("Zamčený"), e.locked ? tr("ano") : tr("ne")],
    [tr("Zapnutý"), e.on === false ? tr("ne") : tr("ano")],
    [tr("Zmrazené hladiny"), (e.frozenLayers ?? []).join(", ") || "—"],
    ...(e.clip ? [[tr("Ořez"), tr("mnohoúhelník ({0} vrcholů)", e.clip.length)] as [string, string]] : []),
  ],
  fields: (e, ctx, F) => [
    f("scale", tr("Měřítko"), vpScaleLabel(ctx.model, e), "text"),
    f("c", tr("Střed na papíře"), ptStr(e.c), "pt"),
    f("w", tr("Šířka"), F.len(e.w), "num"),
    f("h", tr("Výška"), F.len(e.h), "num"),
    f("viewCenter", tr("Střed pohledu (model)"), ptStr(e.viewCenter), "pt"),
    f("twist", tr("Natočení pohledu"), F.ang(e.twist ?? 0), "angle"),
    f("locked", tr("Zamčený"), e.locked ? 1 : 0, "bool"),
    f("on", tr("Zapnutý"), e.on === false ? 0 : 1, "bool"),
    f("frozenLayers", tr("Zmrazené hladiny"), (e.frozenLayers ?? []).join(","), "text"),
  ],
  setField: (e, key, raw, ctx) => {
    const view = key === "scale" || key === "viewCenter" || key === "twist";
    if (view && e.locked) throw new Error(tr("výřez {0} je zamčený – nejdřív ho odemkněte (locked=0)", e.id));
    if (key === "scale") return { ...e, scale: ratioToScale(ctx.model, parseRatio(raw)) };
    if (key === "viewCenter") return { ...e, viewCenter: parsePt(raw) };
    if (key === "twist") {
      const t = normDeg(num(raw.replace("°", ""), key));
      const out: DViewport = { ...e, twist: t };
      if (!t) delete out.twist;
      return out;
    }
    if (key === "c") {
      const c = parsePt(raw);
      const d = sub(c, e.c);
      return { ...e, c, ...(e.clip ? { clip: e.clip.map((p) => add(p, d)) } : {}) };
    }
    if (key === "w" || key === "h") {
      if (e.clip) throw new Error(tr("výřez s nepravoúhlým ořezem – rozměr změňte úchopy"));
      return { ...e, [key]: pos(raw, key) };
    }
    if (key === "locked") return { ...e, locked: bool(raw) };
    if (key === "on") return { ...e, on: bool(raw) };
    if (key === "frozenLayers") {
      const names = raw
        .split(/[,;]/)
        .map((x) => x.trim())
        .filter(Boolean);
      for (const n of names) if (!ctx.model.layers.some((l) => l.name.toLowerCase() === n.toLowerCase())) throw new Error(tr("hladina „{0}“ neexistuje", n));
      const out = { ...e, frozenLayers: names.map((n) => ctx.model.layers.find((l) => l.name.toLowerCase() === n.toLowerCase())!.name) };
      if (!names.length) delete (out as Partial<DViewport>).frozenLayers;
      return out;
    }
    throw unknownField(key, ["scale", "c", "w", "h", "viewCenter", "twist", "locked", "on", "frozenLayers"]);
  },
  measure: (e) => ({ area: e.w * e.h, closed: true }),
});

/** po změně rámu (úchopy) zůstane obsah na papíře na místě: střed pohledu se posune o změnu středu rámu */
function keepView(old: DViewport, nv: DViewport): DViewport {
  const d = sub(nv.c, old.c);
  if (Math.abs(d[0]) < 1e-15 && Math.abs(d[1]) < 1e-15) return nv;
  // posun na papíře d ↔ posun v modelu R(−twist)·d / scale
  const [c, s] = cosSinDeg(-(old.twist ?? 0));
  const md: Vec2 = [(c * d[0] - s * d[1]) / old.scale, (s * d[0] + c * d[1]) / old.scale];
  return { ...nv, viewCenter: add(old.viewCenter, md) };
}

/** obálka všech výřezů (pomůcka GUI) */
export function viewportsBox(list: readonly DraftEntity[]): Box | null {
  let b = emptyBox();
  for (const e of list) if (e.type === "viewport") b = boxUnion(b, boxOf(vpPolygon(e as DViewport)));
  return isEmptyBox(b) ? null : b;
}

export { noTransform };

let syncBlocks: unknown = null;
let syncEntities: unknown = null;
/**
 * GUI: zahodí mezipaměť geometrie, když se od posledního vykreslení změnily definice bloků (zpět / znovu, úprava bloku)
 * nebo – při zobrazeném rozvržení – modelový prostor (obsah výřezů). Volá se před vykreslením plátna.
 */
export function syncGeometry(m: { blocks?: unknown; entities: unknown }, layoutShown: boolean): boolean {
  let stale = false;
  if (syncBlocks !== null && m.blocks !== syncBlocks) stale = true;
  if (layoutShown && syncEntities !== null && m.entities !== syncEntities) stale = true;
  syncBlocks = m.blocks ?? null;
  if (layoutShown || syncEntities === null) syncEntities = m.entities;
  if (stale) invalidateGeometry();
  return stale;
}
