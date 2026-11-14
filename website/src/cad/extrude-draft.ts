/**
 * Vysunutí s úkosem – i šikmé (směr není kolmý na skicu), s rovnou částí („břit“) před začátkem úkosu a symetricky na obě strany
 * roviny skici. Běží ve workeru i v Node.
 *
 * Znaménko úkosu (stejně pro přidání i odebrání – tvar nástroje je v obou případech stejný):
 *  - kladný úhel = „dovnitř“: vnější obrys profilu se se vzdáleností od roviny skici zužuje, otvory profilu (vnitřní smyčky)
 *    se rozšiřují – všechny stěny vzniklého tělesa se naklánějí do materiálu (úkos výstupku formy). U odebrání se otvor
 *    do hloubky zužuje (ostrůvky uvnitř kapsy se rozšiřují).
 *  - záporný úhel = „ven“: vnější obrys se rozšiřuje, otvory se zužují. U odebrání se otvor do hloubky rozšiřuje – odlehčení
 *    (vůle) střižnice za břitem.
 * Odsazení obrysu ve výšce h (kolmo od roviny skici) = max(0, h − břit) · tan(úhel). U šikmého směru se obrys odsadí v rovině
 * skici a posune podél směru (stěny jsou skloněné o úhel vůči směru vysunutí měřeno v řezu kolmém na skicu). Symetricky
 * (`back`) leží obrys skici v rovině skici a obě poloviny se od ní odsazují (každá s vlastním břitem).
 * Rohy: `sharp` = rovinné stěny s ostrými rohy (průsečík odsazených stran – jako úkos v desktopových CADech; výchozí pro nový úkos
 * z textu i formuláře). Smyčka jen z úseček se pak staví z rovinných ploch (měřit ukáže normálu a úhel, na stěnu jde položit
 * skicu, STEP nese roviny). Bez `sharp` (starší dokumenty, „zaoblené rohy“) se rohy, od kterých se obrys vzdaluje (vnější při
 * „ven“, vnitřní při „dovnitř“), na konci zaoblí poloměrem rovným odsazení; přímkové plochy pak nejsou přesně rovinné (chování
 * se kvůli zpětné kompatibilitě nemění).
 */
import * as r from "replicad";
import { tr } from "./i18n";
import { V } from "./ref-resolve";
import { noteFeatureWarning } from "./feature-notes";
import type { Vec3 } from "./types";

type Shape = r.Shape3D;

export type DraftSpec = {
  /** jednotkový směr vysunutí (už včetně „obráceně“) */
  dir: Vec3;
  /** jednotková normála roviny skici */
  n0: Vec3;
  /** délka podél směru */
  dist: number;
  /** úhel úkosu (°): + dovnitř, − ven */
  draft: number;
  /** rovná část (mm kolmo od roviny skici) před začátkem úkosu */
  land?: number;
  /** ostré rohy (průsečík odsazených stěn) místo zaoblených */
  sharp?: boolean;
  /** symetricky: délka podél opačného směru (obrys skici zůstane v rovině skici, obě poloviny se od ní odsazují) */
  back?: number;
};

const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");

/** cos úhlu mezi směrem a normálou skici (0 = směr leží v rovině skici) */
export const tiltCos = (dir: Vec3, n0: Vec3) => Math.abs(V.dot(dir, n0));

/** Odsazení vnějšího obrysu (mm, + = zužuje) ve výšce h kolmo od roviny skici. */
export function draftInset(h: number, draft: number, land = 0): number {
  return Math.max(0, h - Math.max(0, land)) * Math.tan((draft * Math.PI) / 180);
}

/** řez nástroje: posun od roviny skici a odsazení vnějšího obrysu (+ = zužuje) */
type Ring = { shift: Vec3; inset: number; h: number };

/** Řezy jedné poloviny (bez řezu v rovině skici) od skici dál: konec břitu, konec vysunutí. */
function halfRings(dir: Vec3, dist: number, c: number, draft: number, land: number): Ring[] {
  const h = dist * c;
  if (land > 0 && land >= h - 1e-9) throw new Error(tr("Břit ({0} mm) musí být kratší než výška vysunutí ({1} mm).", fmt(land), fmt(h)));
  const end: Ring = { shift: V.mul(dir, dist), inset: draftInset(h, draft, land), h };
  return land > 0 ? [{ shift: V.mul(dir, land / c), inset: 0, h: land }, end] : [end];
}

const vt = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const near = (a: Vec3, b: Vec3) => V.len(V.sub(a, b)) < 1e-7;

/** Vrcholy smyčky v pořadí, má-li jen úsečky (jinak null – oblouky a křivky jdou přes přímkový loft). */
function linePolygon(wire: r.Wire): Vec3[] | null {
  const edges = wire.edges;
  if (!edges.length || edges.length > 400 || edges.some((e) => e.geomType !== "LINE")) return null;
  const segs = edges.map((e) => [vt(e.startPoint), vt(e.endPoint)] as [Vec3, Vec3]);
  const used = segs.map(() => false);
  used[0] = true;
  const pts: Vec3[] = [segs[0][0], segs[0][1]];
  for (let k = 1; k < segs.length; k++) {
    const last = pts[pts.length - 1];
    const j = segs.findIndex((s, i) => !used[i] && (near(s[0], last) || near(s[1], last)));
    if (j < 0) return null;
    used[j] = true;
    pts.push(near(segs[j][0], last) ? segs[j][1] : segs[j][0]);
  }
  if (!near(pts[pts.length - 1], pts[0])) return null;
  pts.pop();
  return pts.length >= 3 ? pts : null;
}

/**
 * Ostré odsazení mnohoúhelníku v jeho rovině: vrchol i se posune o g · m_i (g > 0 = ven), m_i = (n_{i−1} + n_i) / (1 + n_{i−1}·n_i)
 * – průsečík odsazených přímek sousedních stran. null = obrys by změnil tvar (strana zanikne / otočí se, strany se protnou).
 */
function miterOffset(pts: Vec3[], n0: Vec3): ((g: number) => Vec3[] | null) | null {
  const n = pts.length;
  const e = pts.map((p, i) => V.sub(pts[(i + 1) % n], p));
  let area = 0;
  for (let i = 0; i < n; i++) area += V.dot(V.cross(pts[i], pts[(i + 1) % n]), n0);
  const s = area > 0 ? 1 : -1; // proti směru hodinových ručiček vůči n0 → vnější normála strany = e × n0
  const nrm: Vec3[] = [];
  for (const v of e) {
    const l = V.len(v);
    if (l < 1e-9) return null;
    nrm.push(V.mul(V.cross(v, n0), s / l));
  }
  const m: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = nrm[(i + n - 1) % n];
    const b = nrm[i];
    const den = 1 + V.dot(a, b);
    if (den < 1e-6) return null;
    m.push(V.mul(V.add(a, b), 1 / den));
  }
  const orient = (a: Vec3, b: Vec3, c: Vec3) => V.dot(V.cross(V.sub(b, a), V.sub(c, a)), n0);
  return (g: number) => {
    const q = pts.map((p, i) => V.add(p, V.mul(m[i], g)));
    for (let i = 0; i < n; i++) {
      const l = V.len(e[i]);
      if (V.dot(V.sub(q[(i + 1) % n], q[i]), e[i]) / l < 1e-6) return null;
    }
    // odsazené strany se nesmí protnout (úzká drážka / zářez při velkém odsazení)
    if (Math.abs(g) > 1e-12)
      for (let i = 0; i < n; i++)
        for (let j = i + 2; j < n; j++) {
          if (i === 0 && j === n - 1) continue;
          const [a, b, c, d] = [q[i], q[(i + 1) % n], q[j], q[(j + 1) % n]];
          if (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0) return null;
        }
    return q;
  };
}

/** Těleso z rovinných ploch: řezy mnohoúhelníku (víka + čtyřúhelníky mezi sousedními řezy). null = nepodařilo se (použije se loft). */
function polygonSolid(pts: Vec3[], n0: Vec3, rings: { shift: Vec3; delta: number }[]): Shape | null {
  const off = miterOffset(pts, n0);
  if (!off) return null;
  const R: Vec3[][] = [];
  for (const rg of rings) {
    const q = off(rg.delta);
    if (!q) return null;
    R.push(q.map((p) => V.add(p, rg.shift)));
  }
  try {
    const n = pts.length;
    const faces: r.Face[] = [r.makePolygon(R[0]), r.makePolygon(R[R.length - 1])];
    for (let k = 0; k + 1 < R.length; k++) for (let i = 0; i < n; i++) faces.push(r.makePolygon([R[k][i], R[k][(i + 1) % n], R[k + 1][(i + 1) % n], R[k + 1][i]]));
    const solid = r.makeSolid(faces) as Shape;
    return r.measureVolume(solid) > 1e-9 ? solid : null;
  } catch {
    return null;
  }
}

/** Těleso vysunutí s úkosem: po smyčkách (otvory se odečtou) přes řezy skica → (konec břitu) → odsazený konec, symetricky i dozadu. */
export function draftedExtrusion(wires: { wire: r.Wire; depth: number }[], o: DraftSpec): Shape {
  const c = tiltCos(o.dir, o.n0);
  if (c < 1e-6) throw new Error(tr("Směr vysunutí nesmí ležet v rovině skici."));
  if (Math.abs(o.draft) >= 45) throw new Error(tr("Úkos vysunutí musí být menší než 45°."));
  const land = Math.max(0, o.land ?? 0);
  const fwd = halfRings(o.dir, o.dist, c, o.draft, land);
  const back = o.back && o.back > 1e-9 ? halfRings(V.mul(o.dir, -1), o.back, c, o.draft, land).reverse() : [];
  const rings: Ring[] = [...back, { shift: [0, 0, 0], inset: 0, h: 0 }, ...fwd];
  const kind = o.sharp ? "intersection" : "arc";
  const collapse = (rg: Ring) => new Error(tr("Úkos {0}° je pro tento profil příliš velký – obrys by se ve výšce {1} mm od roviny skici odsadil o {2} mm a zanikl. Zmenšete úhel nebo výšku.", fmt(o.draft), fmt(rg.h), fmt(Math.abs(rg.inset))));
  const parts = wires.map(({ wire, depth }) => {
    const sgn = depth % 2 === 0 ? -1 : 1; // vnější obrys se při kladném úkosu zužuje, otvory rozšiřují
    if (o.sharp) {
      const pts = linePolygon(wire);
      const solid = pts && polygonSolid(pts, o.n0, rings.map((rg) => ({ shift: rg.shift, delta: sgn * rg.inset })));
      if (solid) return { solid, depth };
    }
    const sections = rings.map((rg) => {
      if (!rg.inset) return V.len(rg.shift) < 1e-12 ? wire : (wire.clone().translate(rg.shift) as r.Wire);
      for (const k of kind === "intersection" ? (["intersection", "arc"] as const) : (["arc"] as const)) {
        try {
          const w = wire.clone().offset2D(sgn * rg.inset, k).translate(rg.shift) as r.Wire;
          if (k !== kind) noteFeatureWarning(tr("Ostré rohy úkosu se u tohoto profilu nepodařilo vytvořit – rohy jsou zaoblené."));
          return w;
        } catch {
          /* zkusí zaoblené rohy, jinak chyba níže */
        }
      }
      throw collapse(rg);
    });
    return { solid: r.loft(sections, { ruled: true }) as Shape, depth };
  });
  let acc: Shape | null = null;
  for (const { solid, depth } of parts.sort((a, b) => a.depth - b.depth)) acc = !acc ? solid : depth % 2 === 0 ? acc.fuse(solid) : acc.cut(solid);
  if (!acc) throw new Error(tr("Profil je prázdný."));
  return acc;
}

/**
 * Délka nástroje s úkosem po obálku `bounds` ve směru vysunutí (měřeno podél směru, s malou rezervou): „skrz“ jen kousek za těleso,
 * „k dalšímu“ kousek za nalezenou stěnu. Dlouhý nástroj by se při úkosu dovnitř zúžil do ztracena a při úkosu ven zbytečně rozrostl;
 * uvnitř tělesa je tvar stejný. null = obálka ve směru vysunutí za rovinou skici není.
 */
export function throughLength(bounds: [Vec3, Vec3], origin: Vec3, dir: Vec3, n0: Vec3): number | null {
  const c = V.dot(dir, n0);
  if (Math.abs(c) < 1e-6) return null;
  const [lo, hi] = bounds;
  let hMax = -Infinity;
  for (let i = 0; i < 8; i++) {
    const p: Vec3 = [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]];
    hMax = Math.max(hMax, V.dot(V.sub(p, origin), n0) * Math.sign(c));
  }
  if (!(hMax > 1e-6)) return null;
  const margin = Math.max(1, hMax * 0.02);
  return (hMax + margin) / Math.abs(c);
}

/** obálka drátů profilu */
export function wireBounds(wires: r.Wire[]): [Vec3, Vec3] {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const w of wires) {
    const [a, b] = w.boundingBox.bounds as [Vec3, Vec3];
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], a[k]);
      hi[k] = Math.max(hi[k], b[k]);
    }
  }
  return [lo, hi];
}

/**
 * Délka nástroje s úkosem po šikmou cílovou rovinu (bod `o2`, normála `nn`): nejdelší dosah rohů obálky profilu `bounds` podél směru
 * (u úkosu ven se obálka zvětší o odsazení), s malou rezervou – nástroj se pak rovinou rozřízne.
 */
export function planeReach(bounds: [Vec3, Vec3], o2: Vec3, nn: Vec3, dir: Vec3, n0: Vec3, draft: number): number {
  const den = V.dot(dir, nn);
  const reachOf = (grow: number) => {
    let t = -Infinity;
    for (let i = 0; i < 8; i++) {
      const p: Vec3 = [0, 1, 2].map((k) => ((i >> k) & 1 ? bounds[1][k] + grow : bounds[0][k] - grow)) as Vec3;
      t = Math.max(t, V.dot(V.sub(o2, p), nn) / den);
    }
    return t;
  };
  let t = reachOf(0);
  if (draft < 0) for (let k = 0; k < 2; k++) t = reachOf(Math.max(0, t) * tiltCos(dir, n0) * Math.tan((-draft * Math.PI) / 180) + 0.1);
  return t + Math.max(0.5, Math.abs(t) * 0.01);
}
