/**
 * Plochy třídy A (karta „Plochy“, 7. vlna): N-stranná výplň G0/G1/G2, přechodová plocha G1/G2 s napětím, prodloužení
 * plochy přes hranu G1/G2 a úprava řídicích bodů (CV) B-spline plochy. Analýza návaznosti hran a hřebeny křivosti
 * jsou akce (tlačítko bez prvku v historii) – panel v UI, výpočet ve workeru (surf-a.ts).
 * Jádro: cad/surf-a.ts, geometrie: cad/surf-geom.ts.
 */
import * as r from "replicad";
import { tr } from "../i18n";
import { noteFeatureWarning } from "../feature-notes";
import { blendSurface, cvEdit, extensionStrip, nSidedFill, type CvMove, type CvRowMove } from "../surf-a";
import type { Vec3 } from "../types";
import { registerExt, type ExtBuildCtx } from "./registry";
import { freeFaces, replaceFree, sew, withSurface } from "./surface";

const TAB = "surface" as const;
const GROUP = "Plochy třídy A";
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const ids = (v: unknown): number[] => (Array.isArray(v) ? (v.filter((x) => typeof x === "number") as number[]) : []);
const contOf = (v: unknown, d: 0 | 1 | 2): 0 | 1 | 2 => (v === "G0" || v === 0 ? 0 : v === "G1" || v === 1 ? 1 : v === "G2" || v === 2 ? 2 : d);
const vec3 = (v: unknown): Vec3 | null => (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x)) ? (v as Vec3) : null);
const CONT = [
  { v: "G0", l: tr("G0 – jen dotyk") },
  { v: "G1", l: tr("G1 – tečně") },
  { v: "G2", l: tr("G2 – křivostně") },
];
const CONT12 = CONT.slice(1);
const fmt = (v: number, d = 3) => String(Math.round(v * 10 ** d) / 10 ** d);

function needBody(ctx: ExtBuildCtx) {
  if (!ctx.body) throw new Error(tr("Nejdřív vytvořte plochu nebo těleso s hranami."));
  return ctx.body;
}

/** sešije nové plochy se sousedními volnými plochami (jedna skořepina) – nebo je jen přidá */
function addSurfaces(ctx: ExtBuildCtx, add: r.Face[], sewWith: boolean) {
  if (!sewWith) return withSurface(ctx, add);
  const free = freeFaces(ctx.body);
  return replaceFree(ctx, [sew([...free, ...add], 1e-3)]);
}

// ───────── N-stranná výplň ─────────
registerExt({
  ext: "surf.fill",
  label: tr("Výplň N-stran (G0/G1/G2)"),
  icon: "surf-fill",
  tone: "create",
  tab: TAB,
  group: GROUP,
  big: true,
  order: 40,
  hint: tr("hladká plocha vyplní uzavřenou smyčku hran (otvor) s návazností G0 / G1 / G2 na sousední plochy (BRepOffsetAPI_MakeFilling)"),
  pick: { kind: "edges", key: "edges" },
  rollback: true,
  make: (_doc, extra) => ({ edges: ids(extra?.edges), continuity: "G1", sew: false }),
  params: [
    { key: "edges", label: tr("Hrany smyčky"), kind: "edges", hint: tr("hrany otvoru – v libovolném pořadí") },
    { key: "continuity", label: tr("Návaznost na sousední plochy"), kind: "enum", options: CONT },
    { key: "sew", label: tr("Sešít s okolními plochami"), kind: "bool" },
  ],
  build: (d, ctx) => {
    const body = needBody(ctx);
    const sel = ids(d.edges);
    if (!sel.length) throw new Error(tr("Vyberte hrany tvořící uzavřenou smyčku (otvor v ploše)."));
    const cont = contOf(d.continuity, 1);
    const res = nSidedFill(body, sel, cont);
    if (cont > 0 && res.supported < sel.length) noteFeatureWarning(tr("Výplň: {0} z {1} hran nemá sousední plochu – u nich je jen G0.", sel.length - res.supported, sel.length));
    if (cont > 0 && res.g1 > 0.1) noteFeatureWarning(tr("Výplň: dosažená tečnost {0}° (cíl < 0,1°) – zkuste méně hran nebo G0.", fmt(res.g1)));
    return addSurfaces(ctx, [res.face], !!d.sew);
  },
});

// ───────── přechodová plocha ─────────
registerExt({
  ext: "surf.blend",
  label: tr("Přechodová plocha (G1/G2)"),
  icon: "surf-blend",
  tone: "create",
  tab: TAB,
  group: GROUP,
  big: true,
  order: 41,
  hint: tr("plocha mezi dvěma hranami ploch s tečnou (G1) nebo křivostní (G2) návazností a nastavitelným napětím"),
  pick: { kind: "edges", key: "edges" },
  rollback: true,
  make: (_doc, extra) => ({ edges: ids(extra?.edges).slice(0, 2), contA: "G2", contB: "G2", tensionA: 1, tensionB: 1, flip: false, sew: false }),
  params: [
    { key: "edges", label: tr("Dvě hrany (1. a 2. strana)"), kind: "edges", hint: tr("první vybraná hrana = strana 1, druhá = strana 2") },
    { key: "contA", label: tr("Návaznost strany 1"), kind: "enum", options: CONT12 },
    { key: "tensionA", label: tr("Napětí strany 1"), kind: "number", unit: "", min: 0.05, step: 0.1, hint: tr("1 = přirozené; větší = plocha se déle drží směru plochy") },
    { key: "contB", label: tr("Návaznost strany 2"), kind: "enum", options: CONT12 },
    { key: "tensionB", label: tr("Napětí strany 2"), kind: "number", unit: "", min: 0.05, step: 0.1 },
    { key: "flip", label: tr("Obrátit směr druhé hrany (zkroucení)"), kind: "bool" },
    { key: "sew", label: tr("Sešít s okolními plochami"), kind: "bool" },
  ],
  build: (d, ctx) => {
    const body = needBody(ctx);
    const sel = ids(d.edges);
    if (sel.length !== 2) throw new Error(tr("Vyberte právě dvě hrany (každou na jiné ploše)."));
    const tA = num(d.tensionA, 1);
    const tB = num(d.tensionB, 1);
    if (!(tA > 0 && tB > 0)) throw new Error(tr("Napětí musí být kladné."));
    const face = blendSurface(body, sel[0], sel[1], { contA: contOf(d.contA, 2) === 2 ? 2 : 1, contB: contOf(d.contB, 2) === 2 ? 2 : 1, tensionA: tA, tensionB: tB, flip: !!d.flip });
    return addSurfaces(ctx, [face], !!d.sew);
  },
});

// ───────── prodloužení G1/G2 ─────────
registerExt({
  ext: "surf.extendEdge",
  label: tr("Prodloužit přes hranu (G1/G2)"),
  icon: "surf-extend-g",
  tone: "feature",
  tab: TAB,
  group: GROUP,
  order: 42,
  hint: tr("plocha pokračuje přes vybrané hrany o danou délku: G1 = tečně (rovně), G2 = pokračuje křivost"),
  pick: { kind: "edges", key: "edges" },
  rollback: true,
  make: (_doc, extra) => ({ edges: ids(extra?.edges), length: 10, continuity: "G2" }),
  params: [
    { key: "edges", label: tr("Hrany volných ploch"), kind: "edges" },
    { key: "length", label: tr("Délka prodloužení"), kind: "number", min: 0.01 },
    { key: "continuity", label: tr("Návaznost"), kind: "enum", options: CONT12 },
  ],
  build: (d, ctx) => {
    const body = needBody(ctx);
    const sel = ids(d.edges);
    if (!sel.length) throw new Error(tr("Vyberte hranu volné plochy, přes kterou se má plocha prodloužit."));
    const len = num(d.length);
    if (!(len > 0)) throw new Error(tr("Délka musí být kladná."));
    const cont = contOf(d.continuity, 2) === 2 ? 2 : 1;
    const free = freeFaces(body);
    const strips = sel.map((i) => extensionStrip(body, i, len, cont));
    for (const s of strips) if (!free.some((f) => f.isSame(s.face))) throw new Error(tr("Prodloužit lze jen volnou plochu (ne stěnu tělesa) – hrana E{0}.", sel[strips.indexOf(s)] + 1));
    // každá prodlužovaná plocha se se svými pásy sešije do jedné skořepiny a nahradí původní plochu na stejném místě
    const parts = free.map((f) => {
      const mine = strips.filter((s) => s.face.isSame(f)).map((s) => s.strip);
      return mine.length ? sew([f, ...mine], 1e-3) : f;
    });
    return replaceFree(ctx, parts);
  },
});

// ───────── řídicí body (CV) ─────────
registerExt({
  ext: "surf.cv",
  label: tr("Řídicí body plochy (CV)"),
  icon: "surf-cv",
  tone: "feature",
  tab: TAB,
  group: GROUP,
  order: 43,
  hint: tr("posun řídicích bodů (CV) nebo celých řad B-spline plochy; síť lze přesně zjemnit (stupeň 3, vložení uzlů)"),
  pick: { kind: "faces", key: "faces" },
  rollback: true,
  make: (_doc, extra) => ({ faces: ids(extra?.faces).slice(0, 1), gridU: 0, gridV: 0, moves: [], rows: [] }),
  params: [
    { key: "faces", label: tr("Plocha"), kind: "faces" },
    { key: "gridU", label: tr("Síť CV ve směru u (0 = původní)"), kind: "number", unit: "", min: 0, step: 1 },
    { key: "gridV", label: tr("Síť CV ve směru v (0 = původní)"), kind: "number", unit: "", min: 0, step: 1 },
  ],
  build: (d, ctx) => {
    const body = needBody(ctx);
    const fi = ids(d.faces)[0];
    const face = fi === undefined ? undefined : body.faces[fi];
    if (!face) throw new Error(tr("Vyberte plochu (F…), jejíž řídicí body se mají posunout."));
    const free = freeFaces(body);
    const at = free.findIndex((f) => f.isSame(face));
    if (at < 0) throw new Error(tr("Řídicí body lze upravit jen u volné plochy (karta Plochy), ne u stěny tělesa."));
    const gu = Math.round(num(d.gridU));
    const gv = Math.round(num(d.gridV));
    const grid: [number, number] | null = gu > 0 || gv > 0 ? [Math.max(2, gu || 4), Math.max(2, gv || 4)] : null;
    const moves: CvMove[] = (Array.isArray(d.moves) ? d.moves : []).flatMap((m: unknown) => {
      const o = m as { i?: unknown; j?: unknown; d?: unknown };
      const v = vec3(o?.d);
      return typeof o?.i === "number" && typeof o?.j === "number" && v ? [{ i: o.i, j: o.j, d: v }] : [];
    });
    const rows: CvRowMove[] = (Array.isArray(d.rows) ? d.rows : []).flatMap((m: unknown) => {
      const o = m as { dir?: unknown; index?: unknown; d?: unknown };
      const v = vec3(o?.d);
      return (o?.dir === "u" || o?.dir === "v") && typeof o?.index === "number" && v ? [{ dir: o.dir, index: o.index, d: v }] : [];
    });
    const areaBefore = r.measureArea(face);
    const res = cvEdit(face, moves, rows, grid);
    if (!res.exact) noteFeatureWarning(tr("CV: plocha nebyla B-spline – převedla se prokladem sítí bodů (přibližně)."));
    // ořezaná plocha (otvory, neobdélníkový obrys) se po úpravě CV vrátí v celém rozsahu parametrů
    const natural = cvEdit(face, [], [], grid).face;
    if (Math.abs(r.measureArea(natural) - areaBefore) > 1e-3 * Math.max(1, areaBefore)) noteFeatureWarning(tr("CV: ořez plochy se nezachová – upravená plocha má celý rozsah parametrů (otvory a obrys znovu ořízněte)."));
    // nahradit na stejném místě (čísla ploch zůstanou)
    const parts = free.map((f, k) => (k === at ? res.face : f));
    return replaceFree(ctx, parts);
  },
});

// ───────── analýza návaznosti (akce – panel v UI) ─────────
registerExt({
  ext: "surf.analysis",
  label: tr("Návaznost a křivost hran"),
  icon: "surf-analysis",
  tone: "view",
  tab: TAB,
  group: "Analýza ploch",
  big: true,
  order: 50,
  hint: tr("G0 mezera, G1 úhel a G2 rozdíl křivostí napříč vybranými hranami (barvy hran), hřebeny křivosti, zebra a mapa křivosti"),
  action: true,
  make: () => ({}),
});

export {};
