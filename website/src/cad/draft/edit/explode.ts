/**
 * BALÍK 1 (edit) – ROZLOŽIT (křivka → úsečky a oblouky; druhy balíků přes `kind.explode`), UPRAVIT-KŘIVKU (PEDIT:
 * převod úsečky / oblouku, uzavřít / otevřít, spojit, šířka, proložit oblouky, spline, vyrovnat, obrátit, vložit /
 * odebrat vrchol, více křivek) a UPRAVIT-SPLINE (uzavřít / otevřít, spojit, posunout bod, zjemnit, zvýšit stupeň,
 * převést na křivku, obrátit).
 */
import { tr } from "../../i18n";
import { registerCommand, type CmdCtx, type CmdGen, type Kw } from "../commands";
import { clampedKnots } from "../curves";
import { add, bulgeArc, circle3, deg, dist, dot, mul, polar, rad, rot90, sub, tangentBulge, unit } from "../geom";
import { kindLabel, kindOf, type KindCtx } from "../kinds";
import { splineFromFit } from "../kinds-core";
import type { DPolyline, DSpline, DraftEntity, DraftEntityExt, NewEntity, Vec2 } from "../model";
import { normDeg } from "../units";
import { joinGeometry, reverseGeom } from "./join";
import { chainBeziers, nurbsAt, nurbsRange, subNurbs, toBeziers, toDegree, type Nurbs } from "./nurbs";
import { editCurve, nurbsToSpline } from "./param";
import { addDerived, addExact, doneSel, EK, isLocked, kc, nothing, pickObjects, replaceGeom, Steps, unlocked, askKw } from "./shared";

// ---------------------------------------------------------------- ROZLOŽIT

/** úseky křivky jako samostatné úsečky a oblouky */
export function explodePolyline(e: DPolyline): NewEntity[] {
  const n = e.pts.length;
  const cnt = e.closed ? n : n - 1;
  const out: NewEntity[] = [];
  for (let i = 0; i < cnt; i++) {
    const a = e.pts[i];
    const b = e.pts[(i + 1) % n];
    if (dist(a, b) < 1e-12) continue;
    const bu = e.bulges?.[i] ?? 0;
    if (Math.abs(bu) < 1e-12) out.push({ type: "line", a, b } as NewEntity);
    else {
      const r = bulgeArc(a, b, bu);
      const s = r.sweep > 0 ? r.a0 : r.a0 + r.sweep;
      out.push({ type: "arc", c: r.c, r: r.r, a0: normDeg(deg(s)), a1: normDeg(deg(s + Math.abs(r.sweep))) } as NewEntity);
    }
  }
  return out;
}

registerCommand({
  id: "EXPLODE",
  names: { cs: ["rozložit", "rozlozit"], en: ["explode"], de: ["ursprung"] },
  alias: ["X"],
  group: "modify",
  desc: () => tr("rozloží složené entity na části: křivka → úsečky a oblouky (šířky se ztratí), blok, kóta, mtext, šrafa → jejich prvky"),
  usage: () => tr("rozložit e3 | rozložit typ polyline"),
  run: function* (c): CmdGen {
    const ids = unlocked(c, yield* pickObjects(c, tr("Vyberte objekty k rozložení")));
    if (!ids.length) return nothing(c);
    let n = 0;
    const bad: string[] = [];
    let widths = false;
    for (const id of ids) {
      const e = c.tx.get(id)!;
      let parts: NewEntity[] | null = null;
      if (e.type === "polyline") {
        parts = explodePolyline(e);
        if (e.width || e.widths?.some(([a, b]) => a > 0 || b > 0)) widths = true;
      } else parts = kindOf(e)?.explode?.(e, kc(c)) ?? null;
      if (!parts) {
        bad.push(`${id} (${kindLabel(e.type)})`);
        continue;
      }
      c.tx.remove(id);
      for (const p of parts) {
        if (e.type === "polyline") addDerived(c, e, p);
        else addExact(c, { ...(p as object), layer: (p as { layer?: string }).layer ?? e.layer } as NewEntity);
      }
      n++;
    }
    if (widths) c.log(tr("⚠ šířky křivek se rozložením ztratily"));
    if (bad.length) c.log(tr("⚠ nelze rozložit: {0}", bad.join(", ")));
    c.log(tr("✓ rozloženo: {0} → {1} entit", n, c.tx.created.length));
    doneSel(c);
  },
});

// ---------------------------------------------------------------- UPRAVIT KŘIVKU (PEDIT)

/** úsečka / oblouk / otevřená spline jako křivka */
export function toPolyline(e: DraftEntity): NewEntity | null {
  if (e.type === "polyline") return { ...(e as object) } as NewEntity;
  if (e.type === "line") return { type: "polyline", pts: [e.a, e.b] } as NewEntity;
  if (e.type === "arc") {
    let S = rad(normDeg(e.a1 - e.a0));
    if (S < 1e-12) S = 2 * Math.PI;
    return { type: "polyline", pts: [polar(e.c, rad(e.a0), e.r), polar(e.c, rad(e.a0) + S, e.r)], bulges: [Math.tan(S / 4), 0] } as NewEntity;
  }
  return null;
}

/** tečna ve vrcholu i (kružnice třemi body sousedů) */
function vertexTangent(P: Vec2[], i: number, closed: boolean): Vec2 {
  const n = P.length;
  const prev = closed ? P[(i - 1 + n) % n] : P[i - 1];
  const next = closed ? P[(i + 1) % n] : P[i + 1];
  if (prev && next) {
    const k = circle3(prev, P[i], next);
    if (!k) return unit(sub(next, prev));
    const r = unit(rot90(sub(P[i], k.c)));
    return dot(r, sub(next, prev)) >= 0 ? r : mul(r, -1);
  }
  // konec otevřené křivky: tečna kružnice prvních / posledních tří bodů
  if (n < 3) return unit(sub(P[Math.min(n - 1, i + 1)], P[Math.max(0, i - 1)]));
  const [a, b, c] = i === 0 ? [P[0], P[1], P[2]] : [P[n - 1], P[n - 2], P[n - 3]];
  const k = circle3(a, b, c);
  let t = k ? unit(rot90(sub(a, k.c))) : unit(sub(b, a));
  if (dot(t, sub(b, a)) < 0) t = mul(t, -1);
  return i === 0 ? t : mul(t, -1);
}

/** PROLOŽIT: dvojice tečných oblouků (biarc) mezi každými dvěma vrcholy – křivka prochází vrcholy */
export function fitPolyline(e: DPolyline): NewEntity {
  const P = e.pts;
  const n = P.length;
  const closed = !!e.closed;
  const T = P.map((_, i) => vertexTangent(P, i, closed));
  const pts: Vec2[] = [];
  const bul: number[] = [];
  const cnt = closed ? n : n - 1;
  for (let i = 0; i < cnt; i++) {
    const p0 = P[i];
    const p1 = P[(i + 1) % n];
    const t0 = T[i];
    const t1 = T[(i + 1) % n];
    const v = sub(p1, p0);
    const vv = dot(v, v);
    pts.push(p0);
    if (vv < 1e-24) {
      bul.push(0);
      continue;
    }
    const tt = add(t0, t1);
    const den = 2 * (1 - dot(t0, t1));
    let d: number;
    if (Math.abs(den) < 1e-12) d = vv / (4 * dot(v, t1) || 1);
    else d = (-dot(v, tt) + Math.sqrt(dot(v, tt) ** 2 + den * vv)) / den;
    const q0 = add(p0, mul(t0, d));
    const q1 = sub(p1, mul(t1, d));
    const J = mul(add(q0, q1), 0.5);
    const tj = unit(sub(q1, q0));
    pts.push(J);
    bul.push(tangentBulge(p0, t0, J), tangentBulge(J, tj, p1));
  }
  if (!closed) {
    pts.push(P[n - 1]);
    bul.push(0);
  }
  return { type: "polyline", pts, bulges: bul, ...(closed ? { closed: true } : {}), ...(e.width ? { width: e.width } : {}) } as NewEntity;
}

/** periodická (uzavřená) B-spline z řídicích bodů – sevřená na rozsahu jedné periody */
export function closedFromCtrl(ctrl: Vec2[], p: number): Nurbs {
  const n = ctrl.length;
  const P = [...ctrl, ...ctrl.slice(0, p)];
  const knots = Array.from({ length: P.length + p + 1 }, (_, i) => i);
  const full: Nurbs = { deg: p, ctrl: P, knots };
  return subNurbs(full, p, n + p) ?? full;
}

/** SPLINE z křivky: řídicí polygon = vrcholy (kubická, u 3 vrcholů kvadratická) */
export function polylineToSpline(e: DPolyline): NewEntity {
  const P = e.pts;
  const p = Math.min(3, P.length - 1);
  if (e.closed && P.length >= 3) {
    const r = nurbsToSpline(closedFromCtrl(P, Math.min(3, P.length - 1))) as NewEntity & { closed?: boolean };
    r.closed = true;
    return r;
  }
  return { type: "spline", degree: p, ctrl: P, knots: clampedKnots(P.length, p) } as NewEntity;
}

/** vloží vrchol křivky v bodě (rozdělí úsek, oblouk zůstane obloukem) */
export function insertVertex(e: DPolyline, P: Vec2, ctx: KindCtx): NewEntity | null {
  const ec = editCurve(e, ctx);
  if (!ec) return null;
  const u = ec.param(P);
  const i = Math.min(Math.floor(u), ec.hi - 1);
  const f = u - i;
  if (f < 1e-9 || f > 1 - 1e-9) return null;
  const n = e.pts.length;
  const bu = e.bulges?.[i] ?? 0;
  const q = ec.at(u);
  const pts = [...e.pts.slice(0, i + 1), q, ...e.pts.slice(i + 1)];
  const bul = Array.from({ length: n }, (_, k) => e.bulges?.[k] ?? 0);
  if (Math.abs(bu) > 1e-12) {
    const sw = 4 * Math.atan(bu);
    bul.splice(i, 1, Math.tan((sw * f) / 4), Math.tan((sw * (1 - f)) / 4));
  } else bul.splice(i, 1, 0, 0);
  const wid = e.widths ? [...e.widths.slice(0, i + 1), e.widths[i], ...e.widths.slice(i + 1)] : undefined;
  return { ...strip(e), pts, ...(bul.some((b) => Math.abs(b) > 1e-12) ? { bulges: bul } : {}), ...(wid ? { widths: wid } : {}) } as NewEntity;
}

/** odebere vrchol křivky nejbližší bodu (sousední úseky se spojí úsečkou) */
export function removeVertex(e: DPolyline, P: Vec2): NewEntity | null {
  if (e.pts.length <= 2) return null;
  let k = 0;
  e.pts.forEach((q, i) => {
    if (dist(q, P) < dist(e.pts[k], P)) k = i;
  });
  const pts = e.pts.filter((_, i) => i !== k);
  const bul = e.bulges ? e.bulges.filter((_, i) => i !== k).map((b, i) => (i === k - 1 ? 0 : b)) : undefined;
  if (bul && k === 0 && e.closed) bul[bul.length - 1] = 0;
  const wid = e.widths ? e.widths.filter((_, i) => i !== k) : undefined;
  return { ...strip(e), pts, ...(bul ? { bulges: bul } : {}), ...(wid ? { widths: wid } : {}) } as NewEntity;
}
const strip = <T extends DraftEntity>(e: T) => {
  const { id: _i, ...rest } = e;
  void _i;
  return rest;
};
/** objekt bez klíčů s hodnotou undefined (čistý JSON modelu) */
const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

const PE_KW = (closed: boolean): Kw[] => [closed ? EK.open : EK.close, EK.join, EK.width, EK.fitCurve, EK.spline, EK.decurve, EK.reverse, EK.insertv, EK.removev, EK.undo];

declare module "../model" {
  interface DraftEntityExt {
    /**
     * PEDIT (balík edit): „fit“ = křivka proložená oblouky (původní vrcholy = sudé vrcholy), „spline“ = spline z PEDIT
     * Spline s řídicím rámem (rám = původní vrcholy křivky). Rám se nikdy nečte naslepo: Vyrovnat / Uzavřít … ho
     * nejdřív ověří proti aktuální geometrii (po posunu / otočení se rám přepočte, po jiné úpravě se značka ignoruje).
     */
    pedit?: { kind: "fit" } | { kind: "spline"; frame: Vec2[]; closed?: boolean; width?: number };
  }
}

/** rám křivky pro PEDIT: řídicí vrcholy, režim zobrazení (rovná / proložená / spline) */
type PFrame = { pts: Vec2[]; bulges?: number[]; widths?: [number, number][]; width?: number; closed: boolean; mode: "none" | "fit" | "spline" };

const sizeOf = (pts: Vec2[]) => Math.max(1, ...pts.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1]))));
const samePts = (a: Vec2[], b: Vec2[], tol: number) => a.length === b.length && a.every((p, i) => dist(p, b[i]) <= tol);

/** afinní zobrazení ref → cur (nejmenší čtverce; kolineární body = podobnost ze dvou nejvzdálenějších) */
function fitAffine(ref: Vec2[], cur: Vec2[]): ((p: Vec2) => Vec2) | null {
  const n = ref.length;
  if (n < 2 || cur.length !== n) return null;
  const cx = ref.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n] as Vec2, [0, 0] as Vec2);
  const cy = cur.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n] as Vec2, [0, 0] as Vec2);
  let sxx = 0, sxy = 0, syy = 0;
  let ax = 0, bx = 0, ay = 0, by = 0;
  for (let i = 0; i < n; i++) {
    const x = ref[i][0] - cx[0];
    const y = ref[i][1] - cx[1];
    const u = cur[i][0] - cy[0];
    const v = cur[i][1] - cy[1];
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    ax += x * u;
    bx += y * u;
    ay += x * v;
    by += y * v;
  }
  const det = sxx * syy - sxy * sxy;
  if (det > 1e-12 * (sxx + syy) ** 2) {
    // [a b; c d] · (x, y) = (u, v)
    const a = (ax * syy - bx * sxy) / det;
    const b = (bx * sxx - ax * sxy) / det;
    const c = (ay * syy - by * sxy) / det;
    const d = (by * sxx - ay * sxy) / det;
    return (p) => [cy[0] + a * (p[0] - cx[0]) + b * (p[1] - cx[1]), cy[1] + c * (p[0] - cx[0]) + d * (p[1] - cx[1])];
  }
  // kolineární: podobnost (otočení + měřítko) z nejvzdálenějších bodů
  let i0 = 0, i1 = 0, bd = -1;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (dist(ref[i], ref[j]) > bd) {
        bd = dist(ref[i], ref[j]);
        i0 = i;
        i1 = j;
      }
  if (bd <= 0) return (p) => add(p, sub(cur[0], ref[0]));
  const r = sub(ref[i1], ref[i0]);
  const q = sub(cur[i1], cur[i0]);
  const k = dot(r, r);
  const cs = dot(r, q) / k;
  const sn = (r[0] * q[1] - r[1] * q[0]) / k;
  return (p) => {
    const w = sub(p, ref[i0]);
    return [cur[i0][0] + cs * w[0] - sn * w[1], cur[i0][1] + sn * w[0] + cs * w[1]];
  };
}

/** rám entity pro PEDIT (null = nejde: spline bez značky PEDIT, jiný druh) */
function frameOf(e: DraftEntity): PFrame | null {
  if (e.type === "line" || e.type === "arc") {
    const p = toPolyline(e) as unknown as DPolyline;
    return { pts: p.pts, ...(p.bulges ? { bulges: p.bulges } : {}), closed: false, mode: "none" };
  }
  if (e.type === "polyline") {
    const plain: PFrame = { pts: e.pts, ...(e.bulges ? { bulges: e.bulges } : {}), ...(e.widths ? { widths: e.widths } : {}), ...(e.width ? { width: e.width } : {}), closed: !!e.closed, mode: "none" };
    if (e.ext?.pedit?.kind !== "fit") return plain;
    // proložená: původní vrcholy jsou sudé vrcholy – ověří se, že proložení rámu dá aktuální křivku
    const n = e.pts.length;
    if (e.closed ? n % 2 !== 0 || n < 4 : n % 2 !== 1 || n < 3) return plain;
    const frame = e.pts.filter((_, i) => i % 2 === 0);
    const F = fitPolyline({ ...e, pts: frame, bulges: undefined }) as unknown as DPolyline;
    const tol = 1e-9 * sizeOf(e.pts);
    const bu = (x: DPolyline, i: number) => x.bulges?.[i] ?? 0;
    if (!samePts(F.pts, e.pts, tol) || !e.pts.every((_, i) => Math.abs(bu(F, i) - bu(e, i)) <= 1e-9)) return plain;
    return { pts: frame, ...(e.width ? { width: e.width } : {}), closed: !!e.closed, mode: "fit" };
  }
  if (e.type === "spline") {
    const pe = e.ext?.pedit;
    if (pe?.kind !== "spline" || pe.frame.length < 2) return null;
    // rám v aktuální poloze: afinní obraz uloženého rámu, který dá přesně aktuální řídicí body
    const ref = (polylineToSpline({ type: "polyline", id: e.id, layer: e.layer, pts: pe.frame, ...(pe.closed ? { closed: true } : {}) }) as unknown as DSpline).ctrl;
    const A = fitAffine(ref, e.ctrl);
    if (!A) return null;
    const frame = pe.frame.map(A);
    const S = polylineToSpline({ type: "polyline", id: e.id, layer: e.layer, pts: frame, ...(pe.closed ? { closed: true } : {}) }) as unknown as DSpline;
    if (S.degree !== e.degree || !samePts(S.ctrl, e.ctrl, 1e-9 * sizeOf(e.ctrl)) || S.knots.length !== e.knots.length || S.knots.some((k, i) => Math.abs(k - e.knots[i]) > 1e-9 * Math.max(1, Math.abs(k)))) return null;
    return { pts: frame, ...(pe.width ? { width: pe.width } : {}), closed: !!pe.closed, mode: "spline" };
  }
  return null;
}

/** rám jako dočasná křivka (pro spojení, obrácení, vrcholy) */
const framePoly = (e: DraftEntity, f: PFrame): DPolyline =>
  ({ type: "polyline", id: e.id, layer: e.layer, pts: f.pts, ...(f.bulges ? { bulges: f.bulges } : {}), ...(f.widths ? { widths: f.widths } : {}), ...(f.width ? { width: f.width } : {}), ...(f.closed ? { closed: true } : {}) }) as DPolyline;
const polyFrame = (p: DPolyline, mode: PFrame["mode"]): PFrame => ({ pts: p.pts, ...(p.bulges ? { bulges: p.bulges } : {}), ...(p.widths ? { widths: p.widths } : {}), ...(p.width ? { width: p.width } : {}), closed: !!p.closed, mode });

/** geometrie entity z rámu (rovná křivka, proložená, spline) se značkou PEDIT; XDATA a handle zdroje zůstanou */
function buildFrame(src: DraftEntity, f: PFrame): NewEntity {
  const { pedit: _p, ...ext0 } = src.ext ?? {};
  void _p;
  // `ext` vždy výslovně (i undefined): replaceGeom jinak ponechá původní ext se starou značkou
  const ext = (marker?: DraftEntityExt["pedit"]) => {
    const x = { ...ext0, ...(marker ? { pedit: marker } : {}) };
    return { ext: Object.keys(x).length ? x : undefined };
  };
  const poly = framePoly(src, f);
  if (f.mode === "fit") return { ...(fitPolyline({ ...poly, bulges: undefined }) as object), ...ext({ kind: "fit" }) } as NewEntity;
  if (f.mode === "spline" && f.pts.length >= 2) {
    const sp = polylineToSpline({ ...poly, bulges: undefined });
    return { ...(sp as object), ...ext({ kind: "spline", frame: f.pts, ...(f.closed ? { closed: true } : {}), ...(f.width ? { width: f.width } : {}) }) } as NewEntity;
  }
  const { id: _i, layer: _l, ...g } = poly;
  void _i;
  void _l;
  return { ...clean({ ...g, closed: f.closed ? true : undefined }), ...ext() } as NewEntity;
}

/** vrcholy křivky / rámu (bez vydutí) */
const straight = (f: PFrame): PFrame => {
  const { bulges: _b, ...rest } = f;
  void _b;
  return rest;
};

const PE_TYPES = ["polyline", "line", "arc", "spline"];

registerCommand({
  id: "PEDIT",
  names: { cs: ["upravit-křivku", "upravit-krivku"], en: ["pedit"], de: ["pedit"] },
  alias: ["PE"],
  group: "modify",
  desc: () => tr("úprava křivky: úsečku / oblouk převede na křivku; Uzavřít / Otevřít, Spojit (navazující objekty), Šířka, Proložit (oblouky přes vrcholy), Spline (rám zůstane – Vyrovnat ho vrátí), Vyrovnat (zruší oblouky i proložení), Obrátit, Vložit / Odebrat vrchol, Více křivek, Zpět"),
  usage: () => tr("upravit-křivku e3 uzavřít | upravit-křivku e3 šířka 0.5 | upravit-křivku e1 ano spojit e2 e3 | upravit-křivku více e1 e2 ano proložit (ano = převést úsečky / oblouky / splajny – ptá se jen, jsou-li ve výběru)"),
  run: function* (c): CmdGen {
    const s = yield { k: "entity", msg: tr("Vyberte křivku nebo"), kw: [EK.multiple], filter: (e) => PE_TYPES.includes(e.type) };
    let targets: string[] = [];
    /** převod na křivku: úsečka / oblouk přesně, spline bez rámu PEDIT lomenou čarou s přesností */
    const convert = (e: DraftEntity) => {
      if (e.type === "line" || e.type === "arc") replaceGeom(c, e, toPolyline(e)!);
      else if (e.type === "spline" && !frameOf(e)) replaceGeom(c, e, splineToPolyline(e, Math.max(1e-9, ...e.ctrl.flat().map(Math.abs)) * 1e-4));
    };
    const needsConvert = (e: DraftEntity) => e.type === "line" || e.type === "arc" || (e.type === "spline" && !frameOf(e));
    if (s.k === "kw") {
      targets = unlocked(c, yield* pickObjects(c, tr("Vyberte objekty"), (e) => PE_TYPES.includes(e.type)));
      if (!targets.length) return nothing(c);
      if (targets.some((id) => needsConvert(c.tx.get(id)!))) {
        const k = yield* askKw(tr("Převést úsečky, oblouky a splajny na křivky?"), [EK.yes, EK.no], "yes");
        if (k.k === "kw" && k.id === "no") targets = targets.filter((id) => !needsConvert(c.tx.get(id)!));
      }
    } else if (s.k === "ent") {
      const e = c.tx.get(s.id)!;
      if (isLocked(c, e)) throw new Error(tr("entita {0} je na zamčené hladině „{1}“", e.id, e.layer));
      if (needsConvert(e)) {
        const k = yield* askKw(tr("Objekt není křivka. Převést na křivku?"), [EK.yes, EK.no], "yes");
        if (!(k.k === "kw" && k.id === "yes")) return;
      }
      targets = [e.id];
    } else return;
    for (const id of targets) convert(c.tx.get(id)!);
    const steps = new Steps(c);
    let ops = 0;
    for (;;) {
      const f0 = targets.length === 1 ? frameOf(c.tx.get(targets[0])!) : null;
      const k = yield { k: "kw", msg: tr("Zadejte volbu (Enter = konec)"), kw: PE_KW(!!f0?.closed), none: true };
      if (k.k !== "kw") break;
      if (k.id === "undo") {
        if (!steps.undo()) c.log(tr("není co vrátit"));
        continue;
      }
      steps.begin();
      if (k.id === "join") {
        let fuzz = 0;
        if (targets.length > 1) {
          const f = yield { k: "dist", msg: tr("Zadejte vzdálenost přichycení (mezery)"), def: 0, min: 0 };
          if (f.k === "num") fuzz = f.v;
        }
        const extra = targets.length > 1 ? [] : unlocked(c, yield* pickObjects(c, tr("Vyberte objekty ke spojení"))).filter((id) => !targets.includes(id));
        // cíle se spojují svým rámem (proložená / spline křivka po spojení zůstane proložená / spline)
        const frames = new Map<string, PFrame>();
        const ents = [...targets, ...extra]
          .map((id) => c.tx.get(id)!)
          .filter(Boolean)
          .map((e) => {
            const f = targets.includes(e.id) ? frameOf(e) : null;
            if (!f) return e;
            frames.set(e.id, f);
            return framePoly(e, f);
          });
        // vzdálenost přichycení je absolutní (výkresové jednotky)
        const tol = fuzz > 0 ? fuzz : 1e-6;
        const res = joinGeometry(ents, tol).filter((r) => r.geom.type === "polyline");
        const gone = new Set<string>();
        for (const r of res) {
          const src = c.tx.get(r.src.id)!;
          const mode = frames.get(src.id)?.mode ?? "none";
          steps.replace(src, buildFrame(src, polyFrame({ ...(r.geom as object), id: src.id, layer: src.layer } as DPolyline, mode === "fit" || mode === "spline" ? mode : "none")));
          for (const id of r.used) {
            steps.remove(id);
            gone.add(id);
          }
        }
        if (gone.size) targets = targets.filter((t) => !gone.has(t));
        c.log(tr("spojeno: {0}", res.reduce((a, r) => a + r.used.length, 0)));
      } else {
        let w: number | null = null;
        if (k.id === "width") {
          const v = yield { k: "dist", msg: tr("Zadejte novou šířku všech úseků"), def: 0, min: 0 };
          if (v.k !== "num") {
            steps.commit();
            continue;
          }
          w = v.v;
        }
        let pt: Vec2 | null = null;
        if (k.id === "insertvertex" || k.id === "removevertex") {
          const v = yield { k: "point", msg: k.id === "insertvertex" ? tr("Zadejte bod nového vrcholu na křivce") : tr("Zadejte bod u odebíraného vrcholu") };
          if (v.k !== "point") {
            steps.commit();
            continue;
          }
          pt = v.p;
        }
        for (const id of [...targets]) {
          const e = c.tx.get(id);
          const f = e ? frameOf(e) : null;
          if (!e || !f) continue;
          let n: PFrame | null = null;
          if (k.id === "close") n = { ...f, closed: true };
          else if (k.id === "open") n = { ...f, closed: false };
          else if (k.id === "width") {
            const { widths: _w, ...rest } = f;
            void _w;
            n = { ...rest, width: w ?? 0 };
          } else if (k.id === "fit") n = { ...straight(f), mode: "fit" };
          else if (k.id === "spline") n = { ...straight(f), mode: "spline" };
          else if (k.id === "decurve") n = { ...straight(f), mode: "none" };
          else if (k.id === "reverse") {
            const r = reverseGeom(framePoly(e, f));
            if (r) n = polyFrame(r as unknown as DPolyline, f.mode);
          } else if ((k.id === "insertvertex" || k.id === "removevertex") && pt) {
            const r = k.id === "insertvertex" ? insertVertex(framePoly(e, f), pt, kc(c)) : removeVertex(framePoly(e, f), pt);
            if (r) n = polyFrame(r as unknown as DPolyline, f.mode);
          }
          if (n) steps.replace(e, buildFrame(e, n));
        }
        if (k.id === "spline") c.log(tr("křivka převedena na spline"));
      }
      steps.commit();
      ops++;
    }
    c.log(tr("✓ upraveno křivek: {0} ({1} operací)", targets.length, ops));
    doneSel(c);
  },
});

// ---------------------------------------------------------------- UPRAVIT SPLINE

const nurbsOf = (e: DSpline): Nurbs => ({ deg: e.degree, ctrl: e.ctrl, knots: e.knots, ...(e.weights ? { w: e.weights } : {}) });

/** spline → křivka z úseček s tolerancí tětivy */
export function splineToPolyline(e: DSpline, tol: number): NewEntity {
  const N = nurbsOf(e);
  const lo = N.knots[N.deg];
  const hi = N.knots[N.ctrl.length];
  const pts: Vec2[] = [nurbsAt(N, lo)];
  const rec = (a: number, b: number, pa: Vec2, pb: Vec2, depth: number) => {
    const m = (a + b) / 2;
    const pm = nurbsAt(N, m);
    const chord = sub(pb, pa);
    const L = Math.hypot(chord[0], chord[1]);
    const dev = L > 1e-15 ? Math.abs(chord[0] * (pm[1] - pa[1]) - chord[1] * (pm[0] - pa[0])) / L : dist(pm, pa);
    if (depth < 14 && (dev > tol || depth < 2)) {
      rec(a, m, pa, pm, depth + 1);
      rec(m, b, pm, pb, depth + 1);
    } else pts.push(pb);
  };
  const ks = [...new Set(N.knots.filter((k) => k >= lo && k <= hi))];
  for (let i = 1; i < ks.length; i++) rec(ks[i - 1], ks[i], nurbsAt(N, ks[i - 1]), nurbsAt(N, ks[i]), 0);
  const closed = !!e.closed && dist(pts[0], pts[pts.length - 1]) < 1e-9;
  if (closed) pts.pop();
  return { type: "polyline", pts, ...(closed ? { closed: true } : {}) } as NewEntity;
}

/** vložení uzlu v parametru (tvar beze změny, o řídicí bod víc) */
export function refineSpline(e: DSpline, u: number): NewEntity | null {
  const N = nurbsOf(e);
  const [lo, hi] = nurbsRange(N);
  if (!(u > lo + 1e-12 && u < hi - 1e-12)) return null;
  const p = N.deg;
  const Pw = N.ctrl.map((q, i) => [q[0] * (N.w?.[i] ?? 1), q[1] * (N.w?.[i] ?? 1), N.w?.[i] ?? 1]);
  // A5.1 – jedno vložení
  const n = Pw.length - 1;
  let k = -1;
  for (let i = 0; i < N.knots.length; i++) if (N.knots[i] <= u) k = i;
  const s = N.knots.filter((x) => x === u).length;
  if (s >= p) return null;
  const Q: number[][] = [];
  for (let i = 0; i <= k - p; i++) Q[i] = Pw[i];
  for (let i = k - p + 1; i <= k - s; i++) {
    const a = (u - N.knots[i]) / (N.knots[i + p] - N.knots[i]);
    Q[i] = [a * Pw[i][0] + (1 - a) * Pw[i - 1][0], a * Pw[i][1] + (1 - a) * Pw[i - 1][1], a * Pw[i][2] + (1 - a) * Pw[i - 1][2]];
  }
  for (let i = k - s; i <= n; i++) Q[i + 1] = Pw[i];
  const knots = [...N.knots.slice(0, k + 1), u, ...N.knots.slice(k + 1)];
  const rational = Q.some((h) => Math.abs(h[2] - 1) > 1e-14);
  return clean({ ...strip(e), ctrl: Q.map((h) => [h[0] / h[2], h[1] / h[2]] as Vec2), knots, weights: rational ? Q.map((h) => h[2]) : undefined, fit: undefined }) as NewEntity;
}

/** zvýšení stupně (rozklad na Bézierovy úseky, zvýšení, spojení – tvar stejný) */
export function elevateSpline(e: DSpline, to: number): NewEntity {
  const bz = toBeziers(nurbsOf(e)).map((b) => toDegree(b, to));
  const r = chainBeziers(bz);
  return clean({ ...strip(e), degree: r.deg, ctrl: r.ctrl, knots: r.knots, weights: r.w, fit: undefined }) as NewEntity;
}

const SPE_KW = (closed: boolean): Kw[] => [closed ? EK.open : EK.close, EK.join, EK.movev, EK.refine, EK.elevate, EK.polyline, EK.reverse, EK.undo];

registerCommand({
  id: "SPLINEDIT",
  names: { cs: ["upravit-spline", "upravit-splajn"], en: ["splinedit"], de: ["splineedit", "splinebearb"] },
  alias: ["SPE"],
  group: "modify",
  desc: () => tr("úprava splajnu: Uzavřít / Otevřít, Spojit (navazující úsečky, oblouky, splajny), Posunout-bod (bod proložení nebo řídicí bod), Zjemnit (vložit uzel), Zvýšit-stupeň, Křivka (převod na křivku s přesností), Obrátit, Zpět"),
  usage: () => tr("upravit-spline e3 uzavřít | upravit-spline e3 posunout-bod 2 10,5 | upravit-spline e3 křivka 0.01 | upravit-spline e3 zvýšit-stupeň 4"),
  run: function* (c): CmdGen {
    const s = yield { k: "entity", msg: tr("Vyberte spline"), filter: (e) => e.type === "spline" };
    if (s.k !== "ent") return;
    const id = s.id;
    if (isLocked(c, c.tx.get(id)!)) throw new Error(tr("entita {0} je na zamčené hladině", id));
    const steps = new Steps(c);
    const sp = () => c.tx.get(id) as DSpline;
    for (;;) {
      const e = sp();
      if (!e || e.type !== "spline") break;
      const k = yield { k: "kw", msg: tr("Zadejte volbu (Enter = konec)"), kw: SPE_KW(!!e.closed), none: true };
      if (k.k !== "kw") break;
      if (k.id === "undo") {
        if (!steps.undo()) c.log(tr("není co vrátit"));
        continue;
      }
      steps.begin();
      try {
        if (k.id === "close") {
          if (e.fit?.length) steps.replace(e, { ...strip(e), ...splineFromFit(e.fit, true) } as NewEntity);
          else {
            const r = nurbsToSpline(closedFromCtrl(e.ctrl, e.degree)) as NewEntity & { closed?: boolean };
            steps.replace(e, clean({ ...strip(e), ...(r as object), closed: true, fit: undefined, weights: (r as { weights?: number[] }).weights }) as NewEntity);
          }
        } else if (k.id === "open") {
          if (e.fit?.length) steps.replace(e, { ...strip(e), ...splineFromFit(e.fit, false), closed: false } as NewEntity);
          else steps.replace(e, { ...strip(e), closed: false } as NewEntity);
        } else if (k.id === "reverse") steps.replace(e, reverseGeom(e)!);
        else if (k.id === "join") {
          const extra = unlocked(c, yield* pickObjects(c, tr("Vyberte objekty ke spojení"))).filter((x) => x !== id);
          const res = joinGeometry([e, ...extra.map((x) => c.tx.get(x)!)]);
          const r = res.find((x) => x.src.id === id);
          if (!r) c.log(tr("nic nespojeno – konce se musí dotýkat"));
          else {
            const g = r.geom.type === "spline" ? r.geom : null;
            if (g) {
              steps.replace(e, g);
              for (const u of r.used) steps.remove(u);
            } else c.log(tr("výsledek spojení není spline"));
          }
        } else if (k.id === "movevertex") {
          const list = e.fit?.length ? e.fit : e.ctrl;
          const i = yield { k: "int", msg: e.fit?.length ? tr("Zadejte číslo bodu proložení (1–{0})", list.length) : tr("Zadejte číslo řídicího bodu (1–{0})", list.length), min: 1, max: list.length };
          if (i.k === "num") {
            const old = list[i.v - 1];
            const q = yield { k: "point", msg: tr("Zadejte novou polohu bodu"), base: old };
            if (q.k === "point") {
              if (e.fit?.length) steps.replace(e, { ...strip(e), ...splineFromFit(e.fit.map((p, j) => (j === i.v - 1 ? q.p : p)), !!e.closed) } as NewEntity);
              else steps.replace(e, clean({ ...strip(e), ctrl: e.ctrl.map((p, j) => (j === i.v - 1 ? q.p : p)), fit: undefined }) as NewEntity);
            }
          }
        } else if (k.id === "refine") {
          const q = yield { k: "point", msg: tr("Zadejte bod na splajnu pro nový uzel") };
          if (q.k === "point") {
            const ec = editCurve(e, kc(c))!;
            const g = refineSpline(e, ec.param(q.p));
            if (g) steps.replace(e, g);
            else c.log(tr("uzel nelze vložit (konec nebo plná násobnost)"));
          }
        } else if (k.id === "elevate") {
          const d = yield { k: "int", msg: tr("Zadejte nový stupeň ({0}–26)", e.degree + 1), min: e.degree + 1, max: 26, def: e.degree + 1 };
          if (d.k === "num") steps.replace(e, elevateSpline(e, d.v));
        } else if (k.id === "polyline") {
          const size = Math.max(1e-9, ...e.ctrl.flat().map(Math.abs));
          const t = yield { k: "dist", msg: tr("Zadejte přesnost (odchylka tětivy)"), def: Math.round(size * 1e-4 * 1e6) / 1e6 || 0.01, min: 1e-12 };
          if (t.k === "num") {
            steps.replace(e, splineToPolyline(e, t.v));
            steps.commit();
            c.log(tr("spline převedena na křivku"));
            break;
          }
        }
      } finally {
        steps.commit();
      }
    }
    c.log(tr("✓ spline {0} upravena", id));
    doneSel(c);
  },
});

