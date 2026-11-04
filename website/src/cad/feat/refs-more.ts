/**
 * Modul „refs-more“ (5. vlna): vrstva zadání pro zbývající prvky + pomocná geometrie.
 *  – primitiva (kvádr, válec, koule, kužel, trubka), pružina, závit, text: poloha odkazem (`positionRef`),
 *    osa libovolným směrem (`dirDef`), u textu rovina definicí (`planeDef`);
 *  – transformace: posun z bodu do bodu, otočení kolem libovolné osy, střed měřítka / otáčení;
 *  – Vytáhnout/Zatlačit: ukončení k vrcholu / k ploše / odsazeně od plochy;
 *  – pomocná osa (`datumAxis`), pomocný bod (`datumPoint`), souřadný systém (`csys`) – bez geometrie, jen ověření.
 * Vše přes `registerFeatureBuilder`; stavitel nástrojového prvku uloží nástroj do `ctx.tools` (pro pole / zrcadlení).
 */
import * as r from "replicad";
import { applyMode, planeOf, threadProfile, THREAD_HINT } from "../build";
import { planeBasis, threadByName } from "../defaults";
import { pushPull, springSolid } from "../direct";
import { axisVec, csysBasis, entityIndex, planeDefToSketchPlane, planeOfRef, pointOf, resolveAxis, resolveDirection, sigOf, V, type ResolveCtx } from "../ref-resolve";
import { planeDefLabel, type AxisDef, type Direction, type Extent, type Ref } from "../refs";
import type { Axis, BoolMode, Feature, SketchPlane, Vec2, Vec3 } from "../types";
import { registerFeatureBuilder, type FeatCtx } from "./registry";

type Shape = r.Shape3D;
type F<T extends Feature["type"]> = Extract<Feature, { type: T }>;

const rc = (ctx: FeatCtx): ResolveCtx => ({ body: ctx.body, sketches: ctx.sketches, features: ctx.features });
const vt = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];

// ---------------- společné pomocné funkce ----------------

/** Odkazy na pomocnou geometrii (osa / bod / souřadný systém) smí mířit jen na dřívější prvek historie. */
export function checkDatumOrder(f: Feature, ctx: { features: Feature[]; index: number }) {
  const ids: string[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(walk);
    const o = v as Record<string, unknown>;
    if ((o.kind === "datumAxis" || o.kind === "datumPoint") && typeof o.featureId === "string") ids.push(o.featureId);
    for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(f);
  for (const id of ids) {
    const k = ctx.features.findIndex((x) => x.id === id);
    if (k < 0) continue; // chybějící prvek ohlásí řešič odkazů
    if (k >= ctx.index) throw new Error(`Pomocná geometrie „${ctx.features[k].name}“ musí být v historii před prvkem „${f.name}“ – přesuňte ji výš.`);
  }
}

/** Natočí těleso tak, aby jeho lokální osa +Z mířila do `dir` (otáčí kolem bodu `about`). */
export function alignZ(s: Shape, dir: Vec3, about: Vec3 = [0, 0, 0]): Shape {
  const d = V.norm(dir);
  const c = d[2];
  if (c > 0.999999) return s;
  if (c < -0.999999) return s.rotate(180, about, [1, 0, 0]);
  return s.rotate((Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI, about, V.norm(V.cross([0, 0, 1], d)));
}

/** Rotační profil (poloměr, výška) kolem osy +Z v počátku. */
function revolvedZ(profile: [number, number][]): Shape {
  let pen = r.draw(profile[0]);
  for (const p of profile.slice(1)) pen = pen.lineTo(p);
  return pen.close().sketchOnPlane("XZ").revolve([0, 0, 1]) as Shape;
}

/** Poloha prvku: odkazem (má přednost), jinak čísla. */
function placeOf(f: { position: Vec3; positionRef?: Ref }, ctx: FeatCtx, what = "polohu"): Vec3 {
  return f.positionRef ? pointOf(rc(ctx), f.positionRef, what) : f.position;
}
/** Směr osy prvku: definicí směru (má přednost), jinak globální osa X / Y / Z. */
function dirDefOf(f: { axis: Axis; dirDef?: Direction }, ctx: FeatCtx): Vec3 {
  return f.dirDef ? resolveDirection(rc(ctx), f.dirDef, { normal: axisVec(f.axis) }) : axisVec(f.axis);
}

function modeOf(f: Feature): BoolMode {
  if (f.type === "thread") return "cut";
  return "mode" in f ? f.mode : "add";
}

/** Nástrojový prvek: postaví nástroj, uloží ho pro pole / zrcadlení a provede booleovskou operaci. */
function toolBuilder<T extends Feature["type"]>(type: T, make: (f: F<T>, ctx: FeatCtx) => Shape | null | Promise<Shape | null>) {
  registerFeatureBuilder(type, async (f, ctx) => {
    checkDatumOrder(f, ctx);
    const tool = await make(f, ctx);
    if (!tool) return null;
    const mode = modeOf(f);
    ctx.tools.set(f.id, { tool: tool.clone(), mode });
    return applyMode(ctx.body, tool, mode);
  });
}

// ---------------- primitiva ----------------

toolBuilder("box", (f, ctx) => {
  const [w, h, d] = f.size;
  if (!(w > 0 && h > 0 && d > 0)) throw new Error("Rozměry musí být kladné.");
  const at = placeOf(f, ctx);
  const c1: Vec3 = f.centered ? [at[0] - w / 2, at[1] - h / 2, at[2] - d / 2] : at;
  const box = r.makeBox(c1, [c1[0] + w, c1[1] + h, c1[2] + d]) as Shape;
  return f.dirDef ? alignZ(box, resolveDirection(rc(ctx), f.dirDef, { normal: [0, 0, 1] }), at) : box;
});

toolBuilder("cylinder", (f, ctx) => {
  if (!(f.radius > 0 && f.height > 0)) throw new Error("Rozměry musí být kladné.");
  return r.makeCylinder(f.radius, f.height, placeOf(f, ctx, "polohu podstavy"), dirDefOf(f, ctx)) as Shape;
});

toolBuilder("sphere", (f, ctx) => {
  if (!(f.radius > 0)) throw new Error("Poloměr musí být kladný.");
  return r.makeSphere(f.radius).translate(placeOf(f, ctx, "střed koule")) as Shape;
});

toolBuilder("cone", (f, ctx) => {
  if (!(f.height > 0) || f.radius1 < 0 || f.radius2 < 0 || f.radius1 + f.radius2 <= 0) throw new Error("Neplatné rozměry kuželu.");
  const s = revolvedZ([[0, 0], [Math.max(f.radius1, 1e-4), 0], [Math.max(f.radius2, 1e-4), f.height], [0, f.height]]);
  return alignZ(s, dirDefOf(f, ctx)).translate(placeOf(f, ctx, "polohu podstavy"));
});

toolBuilder("tube", (f, ctx) => {
  if (!(f.outer > f.inner && f.inner >= 0 && f.height > 0)) throw new Error("Vnější průměr musí být větší než vnitřní.");
  let t = r.makeCylinder(f.outer / 2, f.height) as Shape;
  if (f.inner > 0) t = t.cut(r.makeCylinder(f.inner / 2, f.height));
  return alignZ(t, dirDefOf(f, ctx)).translate(placeOf(f, ctx, "polohu podstavy"));
});

// ---------------- pružina, závit, text ----------------

toolBuilder("spring", (f, ctx) => {
  const at = placeOf(f, ctx);
  if (!f.dirDef) return springSolid({ ...f, position: at });
  return alignZ(springSolid({ ...f, position: [0, 0, 0], axis: "Z" }), dirDefOf(f, ctx)).translate(at);
});

toolBuilder("thread", (f, ctx) => {
  if (!ctx.body) throw new Error("Závit potřebuje těleso (válcovou plochu nebo díru).");
  if (!f.modeled) return null; // kosmetický závit – jen ve výkrese
  const t = threadByName(f.designation);
  if (!t) throw new Error(`Neznámý závit „${f.designation}“ – ${THREAD_HINT}.`);
  if (!(f.length > 0)) throw new Error("Délka závitu musí být kladná.");
  return alignZ(revolvedZ(threadProfile(t, f.length, f.internal)), dirDefOf(f, ctx)).translate(placeOf(f, ctx, "začátek závitu"));
});

const FONT_FAMILY = "MnRoboto";
let fontLoading: Promise<void> | null = null;
/** Písmo textu: v Node ho registruje `registerTextFont` (build.ts), v prohlížeči se stáhne z /fonts. */
async function ensureFont() {
  if (r.getFont(FONT_FAMILY)) return;
  if (!fontLoading) {
    fontLoading = (async () => {
      if (typeof fetch !== "function" || typeof location === "undefined") throw new Error("no fetch");
      const res = await fetch(new URL("/fonts/Roboto-Bold.ttf", location.origin).toString());
      if (!res.ok) throw new Error("font");
      await r.loadFont(await res.arrayBuffer(), FONT_FAMILY, true);
    })();
    fontLoading.catch(() => (fontLoading = null));
  }
  try {
    await fontLoading;
  } catch {
    throw new Error("Písmo pro text se nepodařilo načíst – zkontrolujte připojení a zkuste to znovu.");
  }
}

toolBuilder("text", async (f, ctx) => {
  if (!f.text.trim()) throw new Error("Zadejte text.");
  if (!(f.height > 0 && f.depth > 0)) throw new Error("Výška písma a hloubka musí být kladné.");
  await ensureFont();
  const c = rc(ctx);
  const plane: SketchPlane = f.planeDef ? planeDefToSketchPlane(c, f.planeDef, planeDefLabel(f.planeDef)) : f.plane;
  let pos: Vec2 = f.position;
  if (f.positionRef) {
    // střed textu = kolmý průmět odkazovaného bodu do roviny textu
    const p = pointOf(c, f.positionRef, "střed textu");
    const b = planeBasis(plane);
    const d = V.sub(p, b.origin);
    pos = [V.dot(d, b.x), V.dot(d, b.y)];
  }
  let d = r.drawText(f.text, { fontSize: f.height, fontFamily: FONT_FAMILY });
  const bc = d.boundingBox.center;
  d = d.translate(-bc[0], -bc[1]);
  if (f.angle) d = d.rotate(f.angle, [0, 0]);
  d = d.translate(pos[0], pos[1]);
  // gravírování jde proti normále roviny (do materiálu), vystouplý text po normále
  return d.sketchOnPlane(planeOf(plane)).extrude(f.mode === "cut" ? -f.depth : f.depth) as Shape;
});

// ---------------- transformace ----------------

registerFeatureBuilder("transform", (f, ctx) => {
  if (!ctx.body) throw new Error("Není těleso k transformaci.");
  if (!(f.scale > 0)) throw new Error("Měřítko musí být kladné.");
  checkDatumOrder(f, ctx);
  const c = rc(ctx);
  const center: Vec3 = f.centerRef ? pointOf(c, f.centerRef, "střed transformace") : [0, 0, 0];
  let s: Shape = ctx.body;
  if (Math.abs(f.scale - 1) > 1e-12) s = s.scale(f.scale, center);
  if (f.rotateAngle) {
    const ax = f.rotateAxisDef ? axisOf(c, f.rotateAxisDef) : { origin: center, dir: axisVec(f.rotateAxis) };
    s = s.rotate(f.rotateAngle, ax.origin, ax.dir);
  }
  let t = f.translate;
  if (f.translateRef) t = V.add(t, V.sub(pointOf(c, f.translateRef.b, "cílový bod posunu"), pointOf(c, f.translateRef.a, "výchozí bod posunu")));
  if (t.some((v) => v)) s = s.translate(t);
  return s;
});

/** Osa bez skici (transformace, pomocná osa): osy skici tu nemají smysl. */
function axisOf(c: ResolveCtx, def: AxisDef) {
  if (def.kind === "sketchX" || def.kind === "sketchY" || def.kind === "sketchLine") throw new Error("Zvolte osu modelem: hranu, válcovou plochu, dva body, globální osu, pomocnou rovinu, průsečnici rovin nebo pomocnou osu.");
  return resolveAxis(c, def, null);
}

// ---------------- Vytáhnout / Zatlačit s ukončením ----------------

/** Posun plochy (střed → cílová rovina podél normály plochy) pro ukončení odkazem. */
export function pushPullDistance(c: ResolveCtx, e: Extent, center: Vec3, n: Vec3): number {
  switch (e.kind) {
    case "blind":
      return e.d;
    case "toVertex":
      return V.dot(V.sub(pointOf(c, e.ref, "vrchol / bod"), center), n);
    case "toFace":
    case "offsetFromFace": {
      const pl = planeOfRef(c, e.ref, "plochu");
      const o = V.add(pl.origin, V.mul(pl.normal, e.kind === "toFace" ? (e.offset ?? 0) : e.d));
      const den = V.dot(n, pl.normal);
      if (Math.abs(den) < 1e-6) throw new Error("Cílová rovina je rovnoběžná se směrem posunu – vyberte plochu, která není kolmá na posouvanou plochu.");
      return V.dot(V.sub(o, center), pl.normal) / den;
    }
    default:
      throw new Error("Pro Vytáhnout/Zatlačit použijte ukončení Na vzdálenost, K vrcholu, K ploše nebo Odsazeně od plochy.");
  }
}

registerFeatureBuilder("pushPull", (f, ctx) => {
  const body = ctx.body;
  if (!body) throw new Error("Není těleso – nejdřív vytvořte nebo importujte model.");
  checkDatumOrder(f, ctx);
  const e = f.extent;
  if (!e || e.kind === "blind") return pushPull(body, f.faces, e ? e.d : f.distance);
  const c = rc(ctx);
  const faces = [...new Set(f.faces)].filter((i) => body.faces[i]);
  if (!faces.length) throw new Error("Vyberte rovinné plochy v modelu.");
  const jobs = faces.map((i) => {
    const face = body.faces[i];
    if (face.geomType !== "PLANE") throw new Error("Vytáhnout/zatlačit lze jen rovinné plochy – pro zakřivené použijte Odsadit plochu.");
    const n = V.norm(vt(face.normalAt(face.center)));
    return { index: i, sig: sigOf(body, "face", i), d: pushPullDistance(c, e, vt(face.center), n) };
  });
  const live = jobs.filter((j) => Math.abs(j.d) > 1e-6); // plocha už v cílové rovině → beze změny
  if (!live.length) throw new Error("Vybrané plochy už leží v cílové rovině – není co posouvat.");
  // stejná vzdálenost pro všechny plochy → jedna operace; jinak postupně (plochy se po každém kroku znovu najdou otiskem)
  if (live.every((j) => Math.abs(j.d - live[0].d) < 1e-6)) return pushPull(body, live.map((j) => j.index), live[0].d);
  let acc = body;
  for (const j of live) acc = pushPull(acc, [entityIndex(acc, "face", j.index, j.sig ?? undefined)], j.d);
  return acc;
});

// ---------------- pomocná geometrie (bez geometrie – jen ověření řešitelnosti) ----------------

registerFeatureBuilder("datumAxis", (f, ctx) => {
  checkDatumOrder(f, ctx);
  if (!(f.length > 0)) throw new Error("Délka zobrazení osy musí být kladná.");
  axisOf(rc(ctx), f.def);
  return null;
});

registerFeatureBuilder("datumPoint", (f, ctx) => {
  checkDatumOrder(f, ctx);
  pointOf(rc(ctx), f.ref, "bod");
  return null;
});

registerFeatureBuilder("csys", (f, ctx) => {
  checkDatumOrder(f, ctx);
  csysBasis(rc(ctx), f);
  return null;
});

/** Geometrie pomocného prvku pro zobrazení (viewport) – osa, bod nebo souřadný systém; `null` u ostatních prvků. */
export type DatumDisplay =
  | { kind: "axis"; origin: Vec3; dir: Vec3; length: number }
  | { kind: "point"; p: Vec3 }
  | { kind: "csys"; origin: Vec3; x: Vec3; y: Vec3; z: Vec3; size: number };

export function datumDisplay(c: ResolveCtx, f: Feature): DatumDisplay | null {
  if (f.type === "datumAxis") {
    const a = axisOf(c, f.def);
    return { kind: "axis", origin: a.origin, dir: a.dir, length: f.length };
  }
  if (f.type === "datumPoint") return { kind: "point", p: pointOf(c, f.ref, "bod") };
  if (f.type === "csys") return { kind: "csys", ...csysBasis(c, f), size: f.size ?? 50 };
  return null;
}
