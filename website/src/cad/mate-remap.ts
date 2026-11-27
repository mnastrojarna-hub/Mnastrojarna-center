/**
 * Reference vazeb po změně historie dílu (vlna 22, bod 20 – „u změny historie prověřovat reference ploch a hran ve vazbách,
 * ztracenou referenci neřešit tichým připojením na jinou plochu“).
 *
 * Vazba ukazuje na plochu / hranu / vrchol dílu jen číslem (`MateRef.face`). Po úpravě dílu (smazaný, přidaný nebo změněný prvek)
 * se čísla mění a stejné číslo může patřit úplně jiné ploše. Proto se při každém návratu upraveného dílu do sestavy (text
 * `sestava hotovo`, GUI „Zpět do sestavy“ – obojí cad/asm-agent.ts `finishContextEdit`) každá reference porovná podle geometrie:
 *
 *  * kandidát = entita stejného druhu na téže nosné ploše (rovina: normála + odsazení; válec / kužel: osa + poloměr; koule: střed
 *    + poloměr; hrana: přímka / kružnice; vrchol: bod) – jen tady může vazba geometricky platit stejně jako dřív;
 *  * PŘESNÁ shoda = kandidát i se stejným středem a velikostí (plocha mm², délka válce);
 *  * právě jedna přesná shoda → přečíslováno (nebo totéž číslo); víc přesných → totéž číslo, je-li mezi nimi, jinak nejednoznačné;
 *  * žádná přesná, ale právě jeden kandidát na téže nosné ploše, který se navíc PŘEKRÝVÁ s otiskem staré plochy → přečíslováno
 *    („táž plocha, změnila velikost“ – vazba geometricky platí stejně: rovina / osa / poloměr jsou tytéž). Překryv (vlna 22 kolo 6):
 *    rovina – obálky ploch se protínají v kladné ploše nebo střed staré leží v obálce nové (bez obálek: kotouče o stejné ploše
 *    kolem středů); válec / kužel – rozsahy podél osy se protínají. Plocha na téže rovině jinde (druhý schod se stejnou plochou)
 *    NENÍ táž plocha → ztraceno („none“); bez údajů pro překryv také ztraceno (nikdy tiché připojení);
 *  * žádný kandidát → ZTRACENO („none“), víc kandidátů bez přesné shody → ZTRACENO („ambiguous“) – nikdy se nevybírá „nejbližší“.
 *  * hrany a vrcholy: jen přesná shoda (koncové body, střed, osa, poloměr).
 *
 * Ztracená reference dostane otisk původní entity (`MateRef.lost`), vazba je mimo řešení (cad/mates.ts `mateLost`, stav „lost“),
 * geometrie se pro ni nenačítá (žádná jiná plocha se starým číslem) a uživatel ji vybere znovu (`sestava vazba N plocha …`, panel
 * Vazby) nebo vazbu smaže. Při další úpravě dílu se otisk porovná znovu – přesná shoda (prvek vrácen) referenci obnoví.
 *
 * Čisté funkce bez jádra: geometrii dodá volající (cad/asm-agent.ts).
 */
import type { PartFace } from "./mates";
import type { LostRef, MateRef, Vec3 } from "./types";

/** Otisk entity dílu pro porovnání (souřadnice dílu). U válce `origin` = střed osy v rozsahu plochy, `length` = délka podél osy. */
export type RefPrint = Omit<LostRef, "why">;
/** obálka plochy (min, max) v souřadnicích dílu – ze sítě stavby (`faceBoxes`) */
export type FaceBox = [Vec3, Vec3];
/** plocha dílu z jádra + plocha (mm²) a obálka ze sítě stavby */
export type FaceCand = { face: number; info: PartFace; area?: number; box?: FaceBox };
/** hrana / vrchol dílu z jádra */
export type EntCand = { index: number; info: PartFace };

export type RefMatch =
  | { state: "same" | "renumbered"; face: number; how: "exact" | "surface" }
  | { state: "lost"; why: "none" | "ambiguous"; candidates: number[] };

/** tolerance polohy (mm), plochy (mm² nebo relativně) a směru */
const POS = 0.01;
const DIR = 1e-6;
const AREA_REL = 1e-3;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => scale(a, 1 / (len(a) || 1));
const dist = (a: Vec3, b: Vec3) => len(sub(a, b));
/** kolmá vzdálenost bodu `p` od přímky (bod `o`, jednotkový směr `n`) */
const offAxis = (p: Vec3, o: Vec3, n: Vec3) => {
  const r = sub(p, o);
  return len(sub(r, scale(n, dot(r, n))));
};
const sameSize = (a?: number, b?: number) => a === undefined || b === undefined || Math.abs(a - b) <= Math.max(POS, AREA_REL * Math.max(Math.abs(a), Math.abs(b)));

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
/** Obálky jednotlivých ploch tělesa ze sítě (min / max vrcholů trojúhelníků skupiny plochy), index = číslo plochy. */
export function faceBoxes(mesh: { vertices: ArrayLike<number>; triangles: ArrayLike<number>; faceGroups: ArrayLike<number> }): (FaceBox | undefined)[] {
  const { vertices: v, triangles: t, faceGroups: g } = mesh;
  const out: (FaceBox | undefined)[] = [];
  for (let i = 0; i + 2 < g.length; i += 3) {
    const face = g[i + 2];
    if (face < 0) continue;
    const end = Math.min(g[i] + g[i + 1], t.length);
    const b: FaceBox = out[face] ?? [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
    for (let k = g[i]; k < end; k++) {
      const a = t[k] * 3;
      for (let d = 0; d < 3; d++) {
        b[0][d] = Math.min(b[0][d], v[a + d]);
        b[1][d] = Math.max(b[1][d], v[a + d]);
      }
    }
    out[face] = b;
  }
  return out.map((b) => (b && Number.isFinite(b[0][0]) ? [b[0].map(r4) as Vec3, b[1].map(r4) as Vec3] : undefined));
}

/** Otisk plochy dílu (souřadnice dílu) – válec: střed osy v rozsahu plochy a délka; rovina: i obálka (překryv při přečíslování). */
export function facePrint(info: PartFace, area?: number, box?: FaceBox): RefPrint {
  const n = unit(info.normal);
  if (info.kind === "cylinder" && info.extent) {
    const [t0, t1] = info.extent;
    return { kind: info.cone ? "cone" : "cylinder", origin: add(info.origin, scale(n, (t0 + t1) / 2)), normal: n, ...(info.radius !== undefined ? { radius: info.radius } : {}), length: Math.abs(t1 - t0), ...(area !== undefined ? { area } : {}) };
  }
  return { kind: info.kind === "cylinder" && info.cone ? "cone" : info.kind, origin: info.origin, normal: n, ...(info.radius !== undefined ? { radius: info.radius } : {}), ...(area !== undefined ? { area } : {}), ...(box && info.kind === "plane" ? { box } : {}) };
}

/** Otisk hrany / vrcholu (souřadnice dílu). */
export function entPrint(info: PartFace): RefPrint {
  return { kind: info.kind, origin: info.origin, normal: unit(info.normal), ...(info.radius !== undefined ? { radius: info.radius } : {}), ...(info.pts?.length ? { pts: info.kind === "curve" ? [info.pts[0], info.pts[info.pts.length - 1]] : info.pts } : {}) };
}

/** Leží plocha `c` na téže nosné ploše jako otisk `o` (stejný druh, rovina / osa / poloměr / střed koule)? */
function sameCarrier(o: RefPrint, c: RefPrint): boolean {
  if (o.kind !== c.kind) return false;
  const k = dot(o.normal, c.normal);
  switch (o.kind) {
    case "plane":
      return k > 1 - DIR && Math.abs(dot(sub(c.origin, o.origin), o.normal)) <= POS;
    case "cylinder":
    case "cone":
      return Math.abs(k) > 1 - DIR && Math.abs((c.radius ?? 0) - (o.radius ?? 0)) <= POS && offAxis(c.origin, o.origin, o.normal) <= POS;
    case "sphere":
      return dist(c.origin, o.origin) <= POS && Math.abs((c.radius ?? 0) - (o.radius ?? 0)) <= POS;
    default:
      return false; // volné plochy (spline, torus …) se nedají ověřit – jen přesná shoda sítě by stačila, tu jádro nedává
  }
}

/**
 * Překrývá se plocha `c` (na téže nosné ploše) s otiskem staré plochy `o`? Jen pak smí být „táž plocha, změnila velikost“
 * (vlna 22 kolo 6, bod 20 – druhý schod na téže rovině se stejnou plochou dřív dostal vazbu tiše). Bez údajů = ne.
 */
function overlaps(o: RefPrint, c: RefPrint): boolean {
  if (o.kind === "cylinder" || o.kind === "cone") {
    if (o.length === undefined || c.length === undefined) return false;
    // rozsahy podél osy (střed osy v rozsahu ± polovina délky) – osy jsou tytéž (sameCarrier), i obrácené
    const t = dot(sub(c.origin, o.origin), o.normal);
    return Math.abs(t) < (o.length + c.length) / 2 - POS;
  }
  if (o.kind === "sphere") return true; // táž koule (střed + poloměr) je celá táž nosná plocha
  if (o.box && c.box) {
    const ov = [0, 1, 2].map((d) => Math.min(o.box![1][d], c.box![1][d]) - Math.max(o.box![0][d], c.box![0][d]));
    if (ov.some((x) => x < -POS)) return false;
    const inside = [0, 1, 2].every((d) => o.origin[d] >= c.box![0][d] - POS && o.origin[d] <= c.box![1][d] + POS);
    // kladná plocha průniku obálek (aspoň dvě osy s kladným přesahem – plocha jen dotčená hranou nestačí), nebo střed staré uvnitř nové
    return inside || ov.filter((x) => x > POS).length >= 2;
  }
  if (o.area && c.area) {
    // bez obálek (starší uložený otisk): kotouče o stejné ploše kolem středů se musí protínat
    const ro = Math.sqrt(o.area / Math.PI);
    const rc = Math.sqrt(c.area / Math.PI);
    return dist(o.origin, c.origin) < ro + rc - POS;
  }
  return false;
}

/** Přesná shoda: táž nosná plocha a stejný střed i velikost. */
function sameFaceExact(o: RefPrint, c: RefPrint): boolean {
  return sameCarrier(o, c) && dist(c.origin, o.origin) <= POS && sameSize(o.area, c.area) && sameSize(o.length, c.length);
}

/**
 * Táž plocha v upraveném dílu (viz hlavička): `old` = otisk plochy před úpravou (nebo uložený otisk ztracené reference),
 * `faces` = plochy dílu po úpravě, `oldIndex` = číslo plochy ve vazbě.
 */
export function matchFace(old: RefPrint, faces: FaceCand[], oldIndex: number): RefMatch {
  const cands = faces.map((f) => ({ face: f.face, p: facePrint(f.info, f.area, f.box) })).filter((x) => sameCarrier(old, x.p));
  if (!cands.length) return { state: "lost", why: "none", candidates: [] };
  const hit = (face: number, how: "exact" | "surface"): RefMatch => ({ state: face === oldIndex ? "same" : "renumbered", face, how });
  const exact = cands.filter((x) => sameFaceExact(old, x.p));
  if (exact.length === 1) return hit(exact[0].face, "exact");
  if (exact.length > 1) return exact.some((x) => x.face === oldIndex) ? hit(oldIndex, "exact") : { state: "lost", why: "ambiguous", candidates: exact.map((x) => x.face) };
  // víc kandidátů na téže nosné ploše = nejednoznačné; jediný, ale jinde (bez překryvu s otiskem) = ztraceno, ne jiná plocha
  if (cands.length > 1) return { state: "lost", why: "ambiguous", candidates: cands.map((x) => x.face) };
  return overlaps(old, cands[0].p) ? hit(cands[0].face, "surface") : { state: "lost", why: "none", candidates: [] };
}

/** Přesná shoda hrany / vrcholu: druh, body (v libovolném pořadí), střed, osa, poloměr. */
function sameEntExact(o: RefPrint, c: RefPrint): boolean {
  if (o.kind !== c.kind) return false;
  if (o.kind === "point") return dist(o.origin, c.origin) <= POS;
  if (o.kind === "circle") return dist(o.origin, c.origin) <= POS && Math.abs(Math.abs(dot(o.normal, c.normal)) - 1) <= DIR && Math.abs((o.radius ?? 0) - (c.radius ?? 0)) <= POS && samePts(o.pts, c.pts);
  if (o.kind === "line" || o.kind === "curve") {
    if (o.pts?.length && c.pts?.length) return samePts(o.pts, c.pts);
    return dist(o.origin, c.origin) <= POS && Math.abs(Math.abs(dot(o.normal, c.normal)) - 1) <= DIR;
  }
  return false;
}
/** stejné koncové body (v libovolném pořadí); bez bodů = bez rozhodnutí */
function samePts(a?: Vec3[], b?: Vec3[]): boolean {
  if (!a?.length || !b?.length) return true;
  if (a.length !== b.length) return false;
  const used = new Set<number>();
  return a.every((p) => {
    const k = b.findIndex((q, i) => !used.has(i) && dist(p, q) <= POS);
    if (k < 0) return false;
    used.add(k);
    return true;
  });
}

/** Táž hrana / vrchol v upraveném dílu – jen přesná shoda (hrana nemá „nosnou plochu“, kterou by šlo ověřit slaběji). */
export function matchEnt(old: RefPrint, list: EntCand[], oldIndex: number): RefMatch {
  const exact = list.filter((x) => sameEntExact(old, entPrint(x.info)));
  const hit = (face: number): RefMatch => ({ state: face === oldIndex ? "same" : "renumbered", face, how: "exact" });
  if (exact.length === 1) return hit(exact[0].index);
  if (exact.length > 1) return exact.some((x) => x.index === oldIndex) ? hit(oldIndex) : { state: "lost", why: "ambiguous", candidates: exact.map((x) => x.index) };
  return { state: "lost", why: "none", candidates: [] };
}

/** Obnova dříve ztracené reference: jen přesná shoda s uloženým otiskem (žádné „táž rovina“ – to by bylo tiché připojení). */
export function matchLost(lost: LostRef, faces: FaceCand[], ents: EntCand[] | null, oldIndex: number, ent?: MateRef["ent"]): RefMatch {
  const { why: _why, ...print } = lost;
  void _why;
  if (ent) return ents ? matchEnt(print, ents, oldIndex) : { state: "lost", why: "none", candidates: [] };
  const m = matchFace(print, faces, oldIndex);
  return m.state !== "lost" && m.how === "surface" ? { state: "lost", why: lost.why === "ambiguous" ? "ambiguous" : "none", candidates: [m.face] } : m;
}

/** Odkaz označený jako ztracený (otisk původní entity); číslo `face` zůstává pro text. */
export function markLost(ref: MateRef, print: RefPrint | null, why: LostRef["why"]): MateRef {
  const p: RefPrint = print ?? { kind: ref.ent === "edge" ? "line" : ref.ent === "vertex" ? "point" : "plane", origin: [0, 0, 0], normal: [0, 0, 1] };
  return { ...ref, lost: { ...p, why: print ? why : "unknown" } };
}

/** Odkaz s novým číslem entity (bez příznaku ztráty). */
export function withFace(ref: MateRef, face: number): MateRef {
  const { lost: _l, ...rest } = ref;
  void _l;
  return { ...rest, face };
}
