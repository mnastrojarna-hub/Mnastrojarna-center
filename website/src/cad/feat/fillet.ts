/**
 * Zaoblení a zkosení – bohaté zadání (5. vlna). Modul přebírá stavbu typů „fillet“ a „chamfer“ přes registr
 * (stavitel vrací nové těleso), build.ts se nemění.
 *
 * Zaoblení (`kind`):
 *  - constant   – jeden poloměr, hrany vybrané / všechny (původní chování)
 *  - asymmetric – R1 → R2: poloměr se mění lineárně od začátku hrany ke konci (OCCT `Add(R1, R2, E)`;
 *                 eliptické zaoblení s různou vzdáleností na každé ploše jádro OCCT nemá)
 *  - variable   – tabulka: poloměr pro každou vybranou hranu zvlášť (`radii` začátek, `radii2` konec)
 *  - faceFace   – zaoblí hrany společné ploše z první a ploše z druhé sady
 *  - fullRound  – plný rádius: prostřední plocha mezi dvěma rovnoběžnými bočními plochami se nahradí válcem
 *                 (přesná konstrukce pro obdélníkovou prostřední plochu; jinak dvojité zaoblení r ≈ w/2)
 *  - tangentChain – výběr hran se rozšíří o tečně navazující hrany (společný vrchol, tečny do 1°)
 * Zkosení (`kind`): equal / twoDistances (D1 na referenční ploše, D2) / distanceAngle (D na referenční ploše + úhel)
 *  / vertex (sražení rohu třemi vzdálenostmi podél hran vrcholu) + tangentChain.
 */
import * as r from "replicad";
import { vertexPositions } from "../inspect";
import { entityIndex, pointOf, V, type ResolveCtx } from "../ref-resolve";
import { fmtVec, isPlaceholder } from "../refs";
import type { Feature, Ref, Vec3 } from "../types";
import { registerFeatureBuilder, type FeatCtx } from "./registry";

type Shape = r.Shape3D;
type FilletF = Extract<Feature, { type: "fillet" }>;
type ChamferF = Extract<Feature, { type: "chamfer" }>;

const vt = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];
const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
/** cos 1° – mez pro „rovnoběžné“ tečny a normály */
const COS1 = Math.cos(Math.PI / 180);
/** sin 1° – mez pro „kolmé“ */
const SIN1 = Math.sin(Math.PI / 180);

const rctx = (ctx: FeatCtx): ResolveCtx => ({ body: ctx.body, sketches: ctx.sketches, features: ctx.features });

/** Tolerance splývání bodů podle velikosti tělesa. */
function tolOf(body: Shape) {
  const [[x0, y0, z0], [x1, y1, z1]] = body.boundingBox.bounds as [Vec3, Vec3];
  return Math.max(1e-4, Math.hypot(x1 - x0, y1 - y0, z1 - z0) * 1e-6);
}

/** Volání jádra s českou hláškou místo vnitřní chyby OCCT. */
function occt<T>(fn: () => T, msg: string): T {
  try {
    return fn();
  } catch {
    throw new Error(msg);
  }
}

const has = <T extends r.Edge | r.Face>(list: T[], x: r.AnyShape) => list.some((e) => e.isSame(x));
const indexOf = (all: r.Edge[], e: r.Edge) => all.findIndex((x) => x.isSame(e));

/** Hrany plochy s pamětí (dotaz na topologii je drahý). */
function edgeCache() {
  const m = new Map<r.Face, r.Edge[]>();
  return (f: r.Face) => {
    let e = m.get(f);
    if (!e) {
      e = f.edges;
      m.set(f, e);
    }
    return e;
  };
}

// ---------------- výběr hran ----------------

/** Vybrané hrany podle indexů (null = všechny), volitelně rozšířené o tečně navazující hrany. */
export function pickEdges(body: Shape, edges: number[] | "all", tangentChain?: boolean): r.Edge[] | null {
  if (edges === "all") return null;
  const all = body.edges;
  const picked = edges.map((i) => all[i]).filter(Boolean);
  if (!picked.length) throw new Error("Vyberte hrany v modelu.");
  return tangentChain ? tangentChainOf(body, picked) : picked;
}

type EdgeEnd = { p: Vec3; out: Vec3 };
/** Konce hrany s tečnou směřující VEN z hrany (uzavřené hrany řetězec nešíří). */
function endsOf(e: r.Edge): EdgeEnd[] {
  if (e.isClosed) return [];
  try {
    return [
      { p: vt(e.startPoint), out: V.mul(V.norm(vt(e.tangentAt(0))), -1) },
      { p: vt(e.endPoint), out: V.norm(vt(e.tangentAt(1))) },
    ];
  } catch {
    return [];
  }
}

/** Rozšíří výběr o hrany tečně navazující (společný koncový bod, tečny rovnoběžné do 1°), iterativně. */
export function tangentChainOf(body: Shape, picked: r.Edge[]): r.Edge[] {
  const all = body.edges;
  const tol = tolOf(body);
  const ends = all.map(endsOf);
  const inSet = all.map((e) => has(picked, e));
  let grown = true;
  while (grown) {
    grown = false;
    for (let i = 0; i < all.length; i++) {
      if (!inSet[i]) continue;
      for (const a of ends[i]) {
        for (let j = 0; j < all.length; j++) {
          if (inSet[j]) continue;
          // z hrany i vycházíme směrem a.out; do hrany j vstupujeme proti jejímu b.out
          if (ends[j].some((b) => V.len(V.sub(a.p, b.p)) <= tol && V.dot(a.out, b.out) <= -COS1)) {
            inSet[j] = true;
            grown = true;
          }
        }
      }
    }
  }
  return all.filter((_, i) => inSet[i]);
}

/** Plochy ze seznamu odkazů (s otiskem) a/nebo indexů. */
function facesOf(body: Shape, refs: Ref[] | undefined, idx: number[] | undefined, what: string): r.Face[] {
  const all = body.faces;
  const ids = new Set<number>();
  for (const ref of refs ?? []) {
    if (isPlaceholder(ref)) continue;
    if (ref.kind !== "face") throw new Error(`Odkaz v poli „${what}“ musí být plocha modelu.`);
    ids.add(entityIndex(body, "face", ref.index, ref.sig));
  }
  for (const i of idx ?? []) if (all[i]) ids.add(i);
  const out = [...ids].map((i) => all[i]);
  if (!out.length) throw new Error(`Vyberte ${what}.`);
  return out;
}

// ---------------- zaoblení ----------------

const pair = (a: number, b: number): r.FilletRadius => (Math.abs(a - b) < 1e-9 ? a : [a, b]);

function fillet(f: FilletF, ctx: FeatCtx): Shape {
  const body = ctx.body;
  if (!body) throw new Error("Není co zaoblit – nejdřív vytvořte těleso.");
  const kind = f.kind ?? "constant";
  if (kind === "faceFace") return faceFaceFillet(body, f);
  if (kind === "fullRound") return fullRoundFillet(body, f);
  if (!(f.radius > 0)) throw new Error("Poloměr musí být kladný.");
  const r2 = f.r2 ?? f.radius;
  if (kind === "asymmetric" && !(r2 > 0)) throw new Error("Oba poloměry (R1 i R2) musí být kladné.");
  if (kind === "variable") {
    for (const [k, v] of [...Object.entries(f.radii ?? {}), ...Object.entries(f.radii2 ?? {})]) {
      if (!(v > 0)) throw new Error(`Poloměr u hrany ${Number(k) + 1} musí být kladný.`);
    }
  }
  const picked = pickEdges(body, f.edges, f.tangentChain);
  const all = body.edges;
  const radiusOf = (e: r.Edge): r.FilletRadius | null => {
    if (picked && !has(picked, e)) return null;
    if (kind === "asymmetric") return pair(f.radius, r2);
    if (kind === "variable") {
      const k = String(indexOf(all, e));
      const r1 = f.radii?.[k] ?? f.radius;
      return pair(r1, f.radii2?.[k] ?? r1);
    }
    return f.radius;
  };
  return occt(() => body.clone().fillet(radiusOf), `Zaoblení R${fmt(f.radius)} nelze provést – poloměr je pro vybrané hrany příliš velký nebo se zaoblení kříží.`);
}

function faceFaceFillet(body: Shape, f: FilletF): Shape {
  if (!(f.radius > 0)) throw new Error("Poloměr musí být kladný.");
  const A = facesOf(body, f.faceRefs, f.faces, "první sadu ploch");
  const B = facesOf(body, f.faceRefs2, f.faces2, "druhou sadu ploch");
  const edgesOf = edgeCache();
  const common = body.edges.filter((e) => A.some((a) => has(edgesOf(a), e) && B.some((b) => !b.isSame(a) && has(edgesOf(b), e))));
  if (!common.length) throw new Error("Vybrané sady ploch nemají společnou hranu – zaoblení plocha–plocha není kde vytvořit.");
  return occt(
    () => body.clone().fillet((e) => (has(common, e) ? f.radius : null)),
    `Zaoblení plocha–plocha R${fmt(f.radius)} nelze provést – poloměr je pro společné hrany příliš velký.`,
  );
}

/**
 * Plný rádius: boční plochy A a B (rovnoběžné, vzdálenost w), prostřední plocha M se nahradí válcem r = w/2.
 * Obdélníková M kolmá na A/B: přesně (odříznout hranol M × r, přidat půlválec). Jinak dvojité zaoblení r·(1 − 1e-4).
 */
function fullRoundFillet(body: Shape, f: FilletF): Shape {
  const A = facesOf(body, f.faceRefs, f.faces, "boční plochu 1");
  const B = facesOf(body, f.faceRefs2, f.faces2, "boční plochu 2");
  const edgesOf = edgeCache();
  const tol = tolOf(body);
  const touch = (x: r.Face, y: r.Face) => !x.isSame(y) && edgesOf(x).some((e) => has(edgesOf(y), e));
  let mids: r.Face[];
  if (f.faceRefsMid?.length) mids = facesOf(body, f.faceRefsMid, undefined, "prostřední plochu");
  else {
    mids = body.faces.filter((m) => !has(A, m) && !has(B, m) && A.some((a) => touch(a, m)) && B.some((b) => touch(b, m)));
    if (!mids.length) throw new Error("Mezi bočními plochami není žádná prostřední plocha (plocha sousedící s oběma).");
    if (mids.length > 1) throw new Error(`Mezi bočními plochami leží ${mids.length} ploch – vyberte prostřední plochu, která se má zaoblit.`);
  }
  const exact: { prism: Shape; half: Shape }[] = [];
  const approx: { e: r.Edge; radius: number }[] = [];
  for (const m of mids) {
    const a = A.find((x) => touch(x, m));
    const b = B.find((x) => touch(x, m));
    if (!a || !b) throw new Error("Prostřední plocha musí sousedit s oběma bočními plochami.");
    if ([a, b, m].some((x) => x.geomType !== "PLANE")) throw new Error("Plný rádius: boční i prostřední plochy musí být rovinné.");
    const na = V.norm(vt(a.normalAt()));
    const nb = V.norm(vt(b.normalAt()));
    const nm = V.norm(vt(m.normalAt()));
    if (Math.abs(V.dot(na, nb)) < COS1) throw new Error("Boční plochy nejsou rovnoběžné – plný rádius vyžaduje dvě rovnoběžné boční plochy.");
    const w = Math.abs(V.dot(V.sub(vt(b.center), vt(a.center)), na));
    const rad = w / 2;
    if (!(rad > tol)) throw new Error("Boční plochy splývají – vzdálenost mezi nimi je nulová.");
    const me = edgesOf(m);
    const eA = me.filter((e) => has(edgesOf(a), e));
    const eB = me.filter((e) => has(edgesOf(b), e));
    const rect =
      eA.length === 1 &&
      eB.length === 1 &&
      me.length === 4 &&
      me.every((e) => e.geomType === "LINE") &&
      Math.abs(eA[0].length - eB[0].length) <= tol * 100 &&
      Math.abs(V.dot(nm, na)) < SIN1;
    if (rect) {
      const L = eA[0].length;
      const d = V.norm(V.sub(vt(eA[0].endPoint), vt(eA[0].startPoint)));
      const axisPt = V.sub(vt(m.center), V.mul(nm, rad));
      const prism = r.basicFaceExtrusion(m, new r.Vector(V.mul(nm, -rad))) as Shape;
      // půlkruh v rovině kolmé na osu: lokální +X = ven z tělesa (normála M), vytažení podél osy
      const plane = new r.Plane(V.sub(axisPt, V.mul(d, L / 2)), nm, d);
      const half = r
        .drawCircle(rad)
        .cut(r.drawRectangle(2 * rad, 2 * rad).translate(-rad, 0))
        .sketchOnPlane(plane)
        .extrude(L) as Shape;
      exact.push({ prism, half });
    } else {
      for (const e of [...eA, ...eB]) approx.push({ e, radius: rad * (1 - 1e-4) });
    }
  }
  let out: Shape = body;
  if (approx.length) {
    out = occt(
      () => out.clone().fillet((e) => approx.find((x) => x.e.isSame(e))?.radius ?? null),
      "Plný rádius se nepodařilo vytvořit – prostřední plocha není obdélník kolmý na boční plochy a přibližné zaoblení selhalo.",
    );
  }
  for (const { prism, half } of exact) out = occt(() => out.cut(prism).fuse(half), "Plný rádius se nepodařilo vytvořit (booleovská operace jádra selhala).");
  return out;
}

// ---------------- zkosení ----------------

function chamfer(f: ChamferF, ctx: FeatCtx): Shape {
  const body = ctx.body;
  if (!body) throw new Error("Není co srazit – nejdřív vytvořte těleso.");
  const kind = f.kind ?? "equal";
  if (kind === "vertex") return vertexChamfer(body, f, rctx(ctx));
  if (!(f.distance > 0)) throw new Error("Velikost sražení musí být kladná.");
  const fail = `Sražení ${fmt(f.distance)} mm nelze provést – vzdálenost je pro vybrané hrany příliš velká nebo se sražení kříží.`;
  if (kind === "equal") {
    const picked = pickEdges(body, f.edges, f.tangentChain);
    return occt(() => body.clone().chamfer(picked ? (e) => (has(picked, e) ? f.distance : null) : f.distance), fail);
  }
  // dvě vzdálenosti / vzdálenost + úhel: první vzdálenost se měří na referenční ploše
  if (!f.faceRef || isPlaceholder(f.faceRef)) throw new Error("Vyberte referenční plochu – na ní se měří první vzdálenost sražení.");
  if (f.faceRef.kind !== "face") throw new Error("Referenční odkaz sražení musí být plocha modelu.");
  const face = body.faces[entityIndex(body, "face", f.faceRef.index, f.faceRef.sig)];
  const faceEdges = face.edges;
  const picked = pickEdges(body, f.edges, f.tangentChain) ?? faceEdges;
  const off = picked.find((e) => !has(faceEdges, e));
  if (off) throw new Error(`Referenční plocha musí sousedit se všemi vybranými hranami (hrana ${indexOf(body.edges, off) + 1} s ní nesousedí).`);
  const selectedFace = (ff: r.FaceFinder) => ff.when(({ element }) => face.isSame(element));
  let cfg: r.ChamferRadius;
  if (kind === "twoDistances") {
    const d2 = f.d2 ?? f.distance;
    if (!(d2 > 0)) throw new Error("Druhá vzdálenost sražení musí být kladná.");
    cfg = { distances: [f.distance, d2], selectedFace };
  } else {
    const angle = f.angle ?? 45;
    if (!(angle > 0 && angle < 90)) throw new Error("Úhel sražení musí být mezi 0° a 90°.");
    cfg = { distance: f.distance, angle, selectedFace };
  }
  return occt(() => body.clone().chamfer((e) => (has(picked, e) ? cfg : null)), fail);
}

/** Sražení vrcholu: roh (tři hrany) se odřízne rovinou body ve vzdálenostech D1–D3 podél hran (v pořadí čísel hran). */
function vertexChamfer(body: Shape, f: ChamferF, rc: ResolveCtx): Shape {
  const d = [f.distance, f.d2 ?? f.distance, f.d3 ?? f.d2 ?? f.distance];
  if (d.some((x) => !(x > 0))) throw new Error("Všechny tři vzdálenosti sražení vrcholu musí být kladné.");
  const pts: Vec3[] = [];
  for (const ref of f.vertexRefs ?? []) if (!isPlaceholder(ref)) pts.push(pointOf(rc, ref, "vrchol"));
  if (f.vertices?.length) {
    const vp = vertexPositions(body);
    for (const i of f.vertices) if (i * 3 + 2 < vp.length) pts.push([vp[i * 3], vp[i * 3 + 1], vp[i * 3 + 2]]);
  }
  if (!pts.length) throw new Error("Vyberte vrcholy, které se mají srazit.");
  const all = body.edges;
  const tol = tolOf(body);
  const tools: Shape[] = [];
  for (const P of pts) {
    const at = all
      .map((e) => {
        if (e.isClosed) return null;
        const s = V.len(V.sub(vt(e.startPoint), P)) <= tol;
        const t = !s && V.len(V.sub(vt(e.endPoint), P)) <= tol;
        return s || t ? { e, fromStart: s } : null;
      })
      .filter((x): x is { e: r.Edge; fromStart: boolean } => !!x);
    if (at.length !== 3) throw new Error(`Ve vrcholu [${fmtVec(P)}] se musí stýkat právě 3 hrany (nalezeno ${at.length}).`);
    const Q = at.map(({ e, fromStart }, k) => {
      if (d[k] >= e.length) throw new Error(`Vzdálenost D${k + 1} = ${fmt(d[k])} mm je delší než hrana ${indexOf(all, e) + 1} (${fmt(e.length)} mm).`);
      const t = d[k] / e.length;
      return vt(e.pointAt(fromStart ? t : 1 - t));
    });
    const dirs = Q.map((q) => V.norm(V.sub(q, P)));
    const inward = V.add(V.add(dirs[0], dirs[1]), dirs[2]);
    if (V.len(inward) < 1e-9) throw new Error("Hrany ve vrcholu jsou degenerované – roh nelze srazit.");
    // vrchol nástroje mírně vně tělesa, aby boční stěny čtyřstěnu nesplývaly s plochami tělesa
    const Vp = V.sub(P, V.mul(V.norm(inward), Math.min(...d) * 0.05));
    tools.push(
      occt(
        () => r.makeSolid([r.makePolygon([Vp, Q[0], Q[1]]), r.makePolygon([Vp, Q[1], Q[2]]), r.makePolygon([Vp, Q[2], Q[0]]), r.makePolygon([Q[0], Q[1], Q[2]])]) as Shape,
        "Roh nelze srazit – body sražení neurčují čtyřstěn.",
      ),
    );
  }
  let out: Shape = body;
  for (const t of tools) out = occt(() => out.cut(t), "Sražení vrcholu se nepodařilo (booleovská operace jádra selhala).");
  return out;
}

registerFeatureBuilder("fillet", (f, ctx) => fillet(f, ctx));
registerFeatureBuilder("chamfer", (f, ctx) => chamfer(f, ctx));
