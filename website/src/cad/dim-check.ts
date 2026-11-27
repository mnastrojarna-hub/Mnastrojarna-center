/**
 * Kontrola kót výkresu: z historie prvků odvodí, jaké rozměry by měl výrobní výkres nést (průměry a hloubky děr,
 * závity, rozměry skic, tloušťky, zaoblení, celkové rozměry…), a porovná je s kótami, které na listu jsou
 * (automatické i uživatelské). Automatické kótování je jen pomocný základ – tato kontrola ukáže, co chybí.
 * Čisté funkce (testovatelné v Node).
 */
import { tr } from "./i18n";
import { threadByName, threadLabel } from "./defaults";
import { threadOfFeature } from "./thread-spec";
import { holeDrillD, holeHeadOf } from "./hole-spec";
import { placementOf } from "./placements";
import type { CadDoc, Feature, Vec3 } from "./types";
import { bodiesAt } from "./bodies";

type Vec2Like = readonly [number, number];

export type DimKind = "lin" | "dia" | "rad" | "thread";
export type DimExpect = { kind: DimKind; value: number; label: string; source: string };
export type DimCheckItem = DimExpect & { present: boolean };

const fmt = (n: number) => (Math.round(n * 100) / 100).toString().replace(".", ",");
const push = (out: DimExpect[], kind: DimKind, value: number, label: string, source: string) => {
  if (!(value > 0) || !Number.isFinite(value)) return;
  if (out.some((o) => o.kind === kind && Math.abs(o.value - value) < 0.005)) return; // stejná hodnota stačí jednou
  out.push({ kind, value, label, source });
};
/** kolikrát se prvek opakuje (pole, která na něj odkazují) */
export function countOf(doc: CadDoc, id: string): number {
  let n = 1;
  for (const f of doc.features) {
    if (f.type !== "pattern" || f.suppressed) continue;
    const ids = f.featureIds?.length ? f.featureIds : [f.featureId];
    if (!ids.includes(id)) continue;
    if (f.kind === "linear") n *= f.count * (f.count2 ?? 1);
    else if (f.kind === "circular" || f.kind === "curve") n *= f.count;
  }
  return n;
}

/** Válec (i odkazem – placements.ts) pokrývá po své ose celou obálku dílu? */
function throughBox(f: Extract<Feature, { type: "cylinder" }>, bbox: [Vec3, Vec3]): boolean {
  const pl = placementOf(f);
  if (!pl) return false;
  const d = pl.dir;
  const ts = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [0, 1, 2].reduce((s, i) => s + d[i] * bbox[(k >> i) & 1][i], 0));
  const t0 = d[0] * pl.position[0] + d[1] * pl.position[1] + d[2] * pl.position[2];
  return t0 <= Math.min(...ts) + 1e-6 && t0 + f.height >= Math.max(...ts) - 1e-6;
}

/**
 * Délka nástroje odebrání v tělese: interval [t0, t1] podél jednotkového směru `d` od bodu `o` proti obálce `bbox`.
 * `through` = interval pokryje celé těleso (průchozí – délka nástroje není rozměr součásti); jinak `len` = délka uvnitř
 * obálky (odebrání vyčnívající z tělesa – např. náběh od čela – má na výkrese jen svou část v tělese).
 */
function cutSpan(o: Vec3, d: Vec3, t0: number, t1: number, bbox: [Vec3, Vec3]): { through: boolean; len: number } {
  const ts = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [0, 1, 2].reduce((s, i) => s + d[i] * (bbox[(k >> i) & 1][i] - o[i]), 0));
  const lo = Math.min(...ts);
  const hi = Math.max(...ts);
  const a = Math.min(t0, t1);
  const b = Math.max(t0, t1);
  return { through: a <= lo + 1e-6 && b >= hi - 1e-6, len: Math.max(0, Math.min(b, hi) - Math.max(a, lo)) };
}
type PlaneLike = { kind: "base"; name: string; offset: number } | { kind: "custom"; origin: Vec3; normal: Vec3 };
/** počátek a normála roviny skici (jako replicad makePlane: XZ má normálu −Y) */
function planeFrame(pl: PlaneLike): { o: Vec3; n: Vec3 } {
  if (pl.kind === "custom") {
    const l = Math.hypot(...pl.normal) || 1;
    return { o: pl.origin, n: [pl.normal[0] / l, pl.normal[1] / l, pl.normal[2] / l] };
  }
  if (pl.name === "XZ") return { o: [0, -pl.offset, 0], n: [0, -1, 0] };
  if (pl.name === "YZ") return { o: [pl.offset, 0, 0], n: [1, 0, 0] };
  return { o: [0, 0, pl.offset], n: [0, 0, 1] };
}

/**
 * Pomocná (nástrojová) tělesa (vlna 22, bod 18): těleso spotřebované `sloučit … odebrat | průnik` bez `ponechat` není součást
 * výsledného dílu. Jeho prvky se nekótují: u odebrání se kontrolují jako odebrání z dílu (`cut` – výsledný tvar ořezaný obálkou,
 * např. okno 30 × 20 místo výšky nástroje 40), u průniku a u prvků, které nástroj samy ořezávají, vůbec (`skip`).
 */
export type AuxInfo = { cut: Set<string>; skip: Set<string>; bodies: { name: string; op: "cut" | "intersect"; features: string[] }[] };
export function auxInfo(doc: Pick<CadDoc, "features">): AuxInfo {
  const out: AuxInfo = { cut: new Set(), skip: new Set(), bodies: [] };
  const fs = doc.features;
  if (!fs.some((f) => f.type === "combine" && !f.suppressed)) return out;
  // těleso, na kterém prvek pracuje (statická simulace historie – bodies.ts)
  const bodyOf = new Map<string, string>();
  fs.forEach((f, i) => {
    if (!f.suppressed && f.type !== "combine") bodyOf.set(f.id, bodiesAt(doc, i + 1).active);
  });
  fs.forEach((c, ci) => {
    if (c.suppressed || c.type !== "combine" || c.keepTool || c.op === "add") return;
    const tool = c.tool?.trim();
    if (!tool) return;
    const feats = fs.slice(0, ci).filter((f) => bodyOf.get(f.id) === tool && !out.cut.has(f.id) && !out.skip.has(f.id));
    if (!feats.length) return;
    for (const f of feats) {
      const mode = "mode" in f ? (f as { mode?: string }).mode : undefined;
      if (c.op === "cut" && mode !== "cut" && mode !== "intersect") out.cut.add(f.id);
      else out.skip.add(f.id);
    }
    out.bodies.push({ name: tool, op: c.op === "cut" ? "cut" : "intersect", features: feats.map((f) => f.id) });
  });
  return out;
}

/**
 * Očekávané kóty z historie prvků. `opts.aux` = pomocná tělesa (výchozí z historie – `auxInfo`); `opts.noHoles` = díry vynechat
 * (kontrola úplnosti je počítá po skupinách s počtem a polohou – cad/dim-complete.ts).
 */
export function expectedDims(doc: CadDoc, bbox: [Vec3, Vec3] | null, opts: { aux?: AuxInfo; noHoles?: boolean } = {}): DimExpect[] {
  const aux = opts.aux ?? auxInfo(doc);
  const out: DimExpect[] = [];
  if (bbox) {
    const L = bbox[1][0] - bbox[0][0];
    const W = bbox[1][1] - bbox[0][1];
    const H = bbox[1][2] - bbox[0][2];
    push(out, "lin", L, tr("{0} (délka X)", fmt(L)), tr("celkové rozměry"));
    push(out, "lin", W, tr("{0} (šířka Y)", fmt(W)), tr("celkové rozměry"));
    push(out, "lin", H, tr("{0} (výška Z)", fmt(H)), tr("celkové rozměry"));
  }
  const sketchUsed = new Set(doc.features.flatMap((f) => ("sketchId" in f && typeof f.sketchId === "string" ? [f.sketchId] : "profileId" in f ? [f.profileId] : [])));
  for (const f0 of doc.features as Feature[]) {
    if (f0.suppressed || aux.skip.has(f0.id) || (opts.noHoles && f0.type === "hole")) continue;
    // prvek nástrojového tělesa spotřebovaného odebráním = odebrání z dílu
    const f = (aux.cut.has(f0.id) && "mode" in f0 ? { ...f0, mode: "cut" } : f0) as Feature;
    const src = f.name;
    switch (f.type) {
      case "hole": {
        const n = countOf(doc, f.id);
        const cnt = n > 1 ? `${n}× ` : "";
        if (f.kind === "tapped" && f.thread) {
          const t = threadByName(f.thread);
          push(out, "thread", t?.d ?? parseFloat(f.thread.replace(/^m/i, "")), `${cnt}${f.depth > 0 ? tr("{0} hl. {1}", threadLabel(f.thread), fmt(f.depth)) : threadLabel(f.thread)}`, src);
          // vrták jiný než tabulkový (jádro D1, zadaný průměr) patří na výkres – výroba ho jinak nepozná
          if (f.tapDrill === "minor" || f.tapDrill === "custom") push(out, "dia", holeDrillD(f), tr("Ø{0} (vrták závitu {1})", String(Math.round(holeDrillD(f) * 1000) / 1000).replace(".", ","), threadLabel(f.thread)), src);
        } else push(out, "dia", f.diameter, `${cnt}${f.depth > 0 ? tr("{0} hl. {1}", `Ø${fmt(f.diameter)}`, fmt(f.depth)) : tr("{0} skrz", `Ø${fmt(f.diameter)}`)}`, src);
        if (f.depth > 0) push(out, "lin", f.depth, tr("{0} (hloubka díry)", fmt(f.depth)), src);
        // zahloubení – i u závitové díry se zahloubením (zahloubení + vrták + závit); vrták pod zahloubením patří na výkres
        const hd = holeHeadOf(f);
        if (hd?.kind === "counterbore" && hd.d > 0) {
          push(out, "dia", hd.d, tr("Ø{0} (zahloubení)", fmt(hd.d)), src);
          push(out, "lin", hd.depth, tr("{0} (hloubka zahloubení)", fmt(hd.depth)), src);
        }
        if (hd?.kind === "countersink" && hd.d > 0) push(out, "dia", hd.d, tr("Ø{0} (kuželové zahloubení)", fmt(hd.d)), src);
        if (hd && f.kind === "tapped" && f.thread && f.tapDrill !== "minor" && f.tapDrill !== "custom") push(out, "dia", holeDrillD(f), tr("Ø{0} (vrták závitu {1})", String(Math.round(holeDrillD(f) * 1000) / 1000).replace(".", ","), threadLabel(f.thread)), src);
        break;
      }
      case "cylinder":
        push(out, "dia", 2 * f.radius, `Ø${fmt(2 * f.radius)}`, src);
        // odebraný válec skrz celý díl (díra „skrz“): délka nástroje není rozměr součásti
        if (!(f.mode === "cut" && bbox && throughBox(f, bbox))) push(out, "lin", f.height, tr("{0} (výška)", fmt(f.height)), src);
        break;
      case "tube":
        push(out, "dia", f.outer, `Ø${fmt(f.outer)}`, src);
        if (f.inner > 0) push(out, "dia", f.inner, `Ø${fmt(f.inner)}`, src);
        push(out, "lin", f.height, tr("{0} (výška)", fmt(f.height)), src);
        break;
      case "sphere":
        push(out, "dia", 2 * f.radius, tr("Ø{0} (koule)", fmt(2 * f.radius)), src);
        break;
      case "cone":
        push(out, "dia", 2 * f.radius1, `Ø${fmt(2 * f.radius1)}`, src);
        if (f.radius2 > 0) push(out, "dia", 2 * f.radius2, `Ø${fmt(2 * f.radius2)}`, src);
        // odebraný kužel se špičkou (zahloubení, sedlo hrotu) se kótuje průměrem × úhlem, výška z nich plyne
        if (!(f.mode === "cut" && (f.radius1 === 0 || f.radius2 === 0))) push(out, "lin", f.height, tr("{0} (výška)", fmt(f.height)), src);
        break;
      case "box":
        f.size.forEach((v, k) => {
          // odebraný kvádr: rozměr skrz celé těleso není rozměr součásti, vyčnívající část se nekótuje
          if (f.mode === "cut" && bbox && !f.dirDef) {
            const lo = f.centered ? f.position[k] - v / 2 : f.position[k];
            const ax: Vec3 = [0, 0, 0];
            ax[k] = 1;
            const sp = cutSpan([0, 0, 0], ax, lo, lo + v, bbox);
            if (sp.through) return;
            if (sp.len < v - 1e-6) return push(out, "lin", sp.len, tr("{0} (v tělese)", fmt(sp.len)), src);
          }
          push(out, "lin", v, `${fmt(v)}`, src);
        });
        break;
      case "extrude": {
        if (f.extent && f.extent.kind !== "blind") break;
        const d = f.extent?.kind === "blind" ? f.extent.d : f.distance;
        // průchozí odebrání (řez skrz celý díl): délka nástroje není rozměr součásti
        if (f.mode === "cut" && bbox && d >= Math.max(bbox[1][0] - bbox[0][0], bbox[1][1] - bbox[0][1], bbox[1][2] - bbox[0][2]) - 1e-6) break;
        // odebrání podél normály skici: skrz těleso (i šikmá rovina) → bez kóty; vyčnívá-li z tělesa → jen část v tělese
        const sk = doc.features.find((x): x is Extract<Feature, { type: "sketch" }> => x.type === "sketch" && x.id === f.sketchId);
        if (f.mode === "cut" && bbox && sk) {
          const { o, n } = planeFrame(sk.plane as PlaneLike);
          const sp = f.symmetric ? cutSpan(o, n, -d / 2, d / 2, bbox) : cutSpan(o, n, 0, f.reverse ? -d : d, bbox);
          if (sp.through) break;
          if (sp.len > 1e-6 && sp.len < d - 1e-6) {
            push(out, "lin", sp.len, tr("{0} (hloubka odebrání v tělese)", fmt(sp.len)), src);
            break;
          }
        }
        push(out, "lin", d, tr("{0} ({1})", fmt(d), f.mode === "cut" ? tr("hloubka odebrání") : tr("výška vysunutí")), src);
        break;
      }
      case "revolve": {
        // rotační díl: průměry z radiálních souřadnic profilu a délky úseků rovnoběžných s osou
        const sk = doc.features.find((x): x is Extract<Feature, { type: "sketch" }> => x.type === "sketch" && x.id === f.sketchId);
        if (!sk) break;
        const ax = f.axis === "x" ? 0 : 1; // osa skici; radiální souřadnice je ta druhá
        const rad = 1 - ax;
        for (const e of sk.entities) {
          if (e.construction) continue;
          const pts: Vec2Like[] = e.type === "polyline" ? e.points : e.type === "line" ? [e.a, e.b] : e.type === "rect" ? [[e.cx - e.w / 2, e.cy - e.h / 2], [e.cx + e.w / 2, e.cy + e.h / 2]] : [];
          for (const p of pts) if (Math.abs(p[rad]) > 1e-6) push(out, "dia", 2 * Math.abs(p[rad]), `Ø${fmt(2 * Math.abs(p[rad]))}`, src);
          if (e.type === "rect") {
            push(out, "lin", e.type === "rect" ? (ax === 0 ? e.w : e.h) : 0, tr("{0} (délka)", fmt(ax === 0 ? e.w : e.h)), src);
            continue;
          }
          for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1];
            const b = pts[i];
            if (Math.abs(a[rad] - b[rad]) < 1e-6 && Math.abs(a[ax] - b[ax]) > 1e-6) push(out, "lin", Math.abs(a[ax] - b[ax]), tr("{0} (délka Ø{1})", fmt(Math.abs(a[ax] - b[ax])), fmt(2 * Math.abs(a[rad]))), src);
          }
          if (e.type === "polyline" && e.closed && pts.length > 2) {
            const a = pts[pts.length - 1];
            const b = pts[0];
            if (Math.abs(a[rad] - b[rad]) < 1e-6 && Math.abs(a[ax] - b[ax]) > 1e-6) push(out, "lin", Math.abs(a[ax] - b[ax]), tr("{0} (délka Ø{1})", fmt(Math.abs(a[ax] - b[ax])), fmt(2 * Math.abs(a[rad]))), src);
          }
        }
        break;
      }
      case "thread": {
        const t = threadByName(f.designation);
        push(out, "thread", t?.d ?? 0, f.length > 0 ? tr("{0} délka {1}", threadLabel(f.designation), fmt(f.length)) : threadLabel(f.designation), src);
        break;
      }
      case "ext": {
        // tažení po šroubovici s profilem závitu: závit M(velký Ø)×stoupání
        const d = f.data ?? {};
        // katalogové označení (thread=M18×1,5) má přednost: poloměr / hloubku / stoupání doplní až stavba (22d)
        const tv = f.ext === "surf.helixSweep" ? threadOfFeature(f) : null;
        if (tv) push(out, "thread", tv.t.d, tv.length > 0 ? tr("{0} délka {1}", threadLabel(tv.designation), fmt(tv.length)) : threadLabel(tv.designation), src);
        else if (f.ext === "surf.helixSweep" && d.profile === "thread60" && typeof d.radius === "number" && typeof d.pitch === "number") {
          const h = typeof d.depth === "number" ? d.depth : 0;
          const internal = d.side === "internal";
          const removing = d.mode === "cut" || d.mode === "intersect";
          const major = 2 * ((internal ? removing : !removing) ? d.radius + h : d.radius);
          push(out, "thread", major, typeof d.turns === "number" ? tr("{0} ({1} dl.)", threadLabel(`M${fmt(major)}×${fmt(d.pitch)}`), fmt(d.turns * d.pitch)) : threadLabel(`M${fmt(major)}×${fmt(d.pitch)}`), src);
        }
        break;
      }
      case "sketch":
        if (!sketchUsed.has(f.id)) break;
        for (const e of f.entities) {
          if (e.construction) continue;
          if (e.type === "circle") push(out, "dia", 2 * e.r, `Ø${fmt(2 * e.r)}`, src);
          else if (e.type === "rect") {
            push(out, "lin", e.w, `${fmt(e.w)}`, src);
            push(out, "lin", e.h, `${fmt(e.h)}`, src);
            if (e.r > 0) push(out, "rad", e.r, tr("R{0} (rohy)", fmt(e.r)), src);
          } else if (e.type === "slot") {
            push(out, "lin", e.length, tr("{0} (délka drážky)", fmt(e.length)), src);
            push(out, "lin", e.width, tr("{0} (šířka drážky)", fmt(e.width)), src);
          } else if (e.type === "polygon") push(out, "dia", 2 * e.r, tr("Ø{0} (opsaná kružnice {1}-úhelníku)", fmt(2 * e.r), e.sides), src);
          else if (e.type === "ellipse") {
            push(out, "lin", 2 * e.rx, tr("{0} (elipsa)", fmt(2 * e.rx)), src);
            push(out, "lin", 2 * e.ry, tr("{0} (elipsa)", fmt(2 * e.ry)), src);
          }
        }
        break;
      case "fillet":
        push(out, "rad", f.radius, `R${fmt(f.radius)}`, src);
        break;
      case "chamfer":
        push(out, "lin", f.distance, tr("{0}×45° (sražení)", fmt(f.distance)), src);
        break;
      case "shell":
        push(out, "lin", f.thickness, tr("{0} (tloušťka stěny)", fmt(f.thickness)), src);
        break;
      case "pattern":
        if (f.kind === "linear") {
          push(out, "lin", f.spacing, tr("{0} (rozteč)", fmt(f.spacing)), src);
          if (f.spacing2) push(out, "lin", f.spacing2, tr("{0} (rozteč)", fmt(f.spacing2)), src);
        }
        break;
      case "spring":
        push(out, "dia", 2 * f.radius, tr("Ø{0} (pružina)", fmt(2 * f.radius)), src);
        push(out, "lin", f.pitch, tr("{0} (stoupání)", fmt(f.pitch)), src);
        break;
      default:
        break;
    }
  }
  return out;
}

const num = (s: string) => parseFloat(s.replace(",", "."));
/** Kóty přítomné na listu – z textů vrstvy „dim“ (automatické i uživatelské): „Ø18“, „4× Ø18“, „165“, „R3“, „M6 hl. 12“, „Ø50 H8“. */
export function presentDims(texts: { s: string; layer?: string }[]): { kind: DimKind; value: number; text: string }[] {
  const out: { kind: DimKind; value: number; text: string }[] = [];
  for (const t of texts) {
    if (t.layer && t.layer !== "dim") continue;
    // pomocná kóta v závorce „(50)“, značky zahloubení „⌴ Ø14“ / „⌵ Ø16,5“, počet „4× “ (s mezerou – „1×45°“ je sražení)
    const raw = t.s.replace(/^\s*\((.*)\)\s*$/, "$1").replace(/^\s*\d+\s*[×x]\s+/i, "").replace(/^\s*[⌴⌵]\s*/, "").trim();
    let m: RegExpExecArray | null;
    if ((m = /^(\d+(?:[.,]\d+)?)\s*[×x]\s*\d+(?:[.,]\d+)?°/.exec(raw))) out.push({ kind: "lin", value: num(m[1]), text: t.s });
    else if ((m = /^M\s*(\d+(?:[.,]\d+)?)/i.exec(raw))) out.push({ kind: "thread", value: num(m[1]), text: t.s });
    else if ((m = /^[Øø⌀]\s*(\d+(?:[.,]\d+)?)/.exec(raw))) out.push({ kind: "dia", value: num(m[1]), text: t.s });
    else if ((m = /^R\s*(\d+(?:[.,]\d+)?)/.exec(raw))) out.push({ kind: "rad", value: num(m[1]), text: t.s });
    else if ((m = /^(\d+(?:[.,]\d+)?)/.exec(raw))) out.push({ kind: "lin", value: num(m[1]), text: t.s });
    // další čísla v textu (např. „hl. 12“) jako lineární
    for (const h of raw.matchAll(/(?:hl\.|↧)\s*(\d+(?:[.,]\d+)?)/g)) out.push({ kind: "lin", value: num(h[1]), text: t.s });
  }
  return out;
}

/** Porovnání: která očekávaná kóta na listu je (stejný druh a hodnota ±0,01) a která chybí. */
export function dimCheck(doc: CadDoc, bbox: [Vec3, Vec3] | null, texts: { s: string; layer?: string }[]): DimCheckItem[] {
  const have = presentDims(texts);
  const tol = (v: number) => Math.max(0.01, Math.abs(v) * 1e-4);
  // celkový rozměr rotačního dílu = jeho největší Ø; průměr se závitem nese označení závitu (M20 místo Ø20)
  const same = (e: DimExpect, h: { kind: DimKind; value: number }) => h.kind === e.kind || (e.kind === "lin" && h.kind === "dia" && e.source === tr("celkové rozměry")) || (e.kind === "dia" && h.kind === "thread");
  return expectedDims(doc, bbox).map((e) => ({ ...e, present: have.some((h) => same(e, h) && Math.abs(h.value - e.value) <= tol(e.value)) }));
}
