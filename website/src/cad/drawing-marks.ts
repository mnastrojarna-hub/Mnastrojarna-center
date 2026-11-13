/**
 * Kóty a značky výkresu zadané textem (cad/agent-drawing.ts → cad/drawing-agent.ts): popisky a id poznámek (a1, a2…),
 * převod souřadnic agenta (mm modelu v rovině pohledu, y nahoru; mm listu od levého dolního rohu) na souřadnice pohledu
 * a listu, přichycení ke geometrii jako myš, značky (poznámka, drsnost, GD&T, základna, text) a ruční kóty, úpravy,
 * rozsahy souřadnic pohledů pro „výkres stav“. Čisté funkce nad výsledkem výkresu – testovatelné v Node.
 */
import type { ManualDim, MarkSpec, MarkTarget, AnnPatch } from "./agent-drawing";
import { VIEW_CS } from "./agent-drawing";
import { angleGeom, annotationGeometry, annToSheet, viewExtent, dimLabel, GDT_LABEL, isRadialDim, modelViewKey, pickViewEnt, scaleLabel, sheetToAnn, textBox, type DimAnn, type DrawingOptions, type DrawingResult, type PlacedView, type ViewEnt } from "./drawing";
import { calloutLines } from "./drawing-symbols";
import { tr } from "./i18n";
import { uid, type DrawingAnnotation, type Vec2, type Vec3 } from "./types";

const fmtN = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",").replace(/^-/, "−");
const fmtP = (p: Vec2) => `[${fmtN(p[0])}; ${fmtN(p[1])}]`;

// ---------------------------------------------------------------- popisky

/** hodnota kóty (mm modelu nebo °) */
export function dimValue(views: PlacedView[], a: Extract<DrawingAnnotation, { type: "dim" }>): number {
  if (isRadialDim(a)) return a.kind === "diameter" ? 2 * a.r : a.r;
  if (a.kind === "angle") {
    const S = (q: [number, number]) => annToSheet(views, a.view, q);
    return angleGeom(S(a.a), S(a.b), S(a.a2), S(a.b2), a.ang)?.angle ?? 0;
  }
  // kóty v mm listu („sheet“) mají hodnotu v měřítku listu – tady jen kóty pohledů (mm modelu)
  if (a.kind === "horizontal") return Math.abs(a.b[0] - a.a[0]);
  if (a.kind === "vertical") return Math.abs(a.b[1] - a.a[1]);
  return Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1]);
}

/** Popisek poznámky, jak je na listu (kóty s hodnotou, popisy po řádcích). */
export function annLabel(views: PlacedView[], a: DrawingAnnotation): string {
  switch (a.type) {
    case "dim":
      return dimLabel(a, dimValue(views, a));
    case "callout":
      return calloutLines(a).join(" / ");
    case "note":
    case "text":
      return a.text;
    case "roughness":
      return a.ra;
    case "gdt":
      return `${tr(GDT_LABEL[a.symbol])} ${a.value}${a.datum ? ` ${a.datum}` : ""}`;
    case "datum":
      return a.label;
    case "centerline":
      return tr("osa souměrnosti");
  }
}

const num = (s: string) => parseFloat(s.replace(",", "."));
/** Kóty / popisy, které odpovídají zadání (popisek kóty bez počtu, nebo první označení popisu: M8, Ø8,5, R2). */
export function findDims(views: PlacedView[], anns: DrawingAnnotation[], target: string): DrawingAnnotation[] {
  const t = target.trim().replace(/^ø/i, "Ø");
  const tn = num(t.replace(/^[ØMR]/, ""));
  const pre = /^[ØMR]/.exec(t)?.[0] ?? "";
  return anns.filter((a) => {
    if (a.type === "dim") {
      const label = dimLabel({ kind: a.kind, prefix: a.prefix === "(" ? "" : a.prefix, text: a.text }, dimValue(views, a)).replace(/^\d+× /, "");
      if (label === t) return true;
      const lp = /^[ØMR]/.exec(label)?.[0] ?? "";
      return lp === pre && Math.abs(num(label.replace(/^[ØMR]/, "")) - tn) < 1e-6;
    }
    if (a.type === "callout") {
      const first = a.lines[0].replace(/^\d+× /, "").split(" ")[0];
      if (first === t) return true;
      const fp = /^[ØMR]/.exec(first)?.[0] ?? "";
      return !!pre && fp === pre && Math.abs(num(first.replace(/^[ØMR]/, "")) - tn) < 1e-6;
    }
    return false;
  });
}

// ---------------------------------------------------------------- id poznámek (a1, a2…)

/** krátké id poznámky listu podle pořadí (a1 = první) – platí do další změny seznamu */
export const shortId = (i: number) => `a${i + 1}`;
const isId = (t: string) => /^a\d+$/i.test(t.trim());
const NAME = (k: string, o?: Partial<DrawingOptions>) =>
  k.startsWith("m:") ? (o?.models?.find((m) => modelViewKey(m.id) === k)?.name ?? k) : k.startsWith("aux:") ? tr("pohled {0}", k.slice(4)) : k.startsWith("cut:") ? tr("řez {0}–{0}", k.slice(4)) : tr(k === "section" ? "řez" : k === "sheet" ? "list" : VIEW_CS[k as keyof typeof VIEW_CS] ?? k);

/** Seznam „a1 Ø40 (přední)“ pro chybové hlášky a stav. */
export function annList(views: PlacedView[], anns: DrawingAnnotation[], o?: Partial<DrawingOptions>, filter: (a: DrawingAnnotation) => boolean = () => true): string {
  return anns.map((a, i) => (filter(a) ? `${shortId(i)} ${annLabel(views, a)} (${NAME(a.view, o)})` : "")).filter(Boolean).join(" · ") || "—";
}

/**
 * Indexy poznámek podle zadání: id (a3), popisek kóty / popisu (jako `výkres tolerance`: Ø40, 25, M8) nebo text značky
 * (Ra 1,6, Kolmost 0,02 A, poznámka). `dimsOnly` = jen kóty a popisy (cíl značky).
 */
export function resolveAnns(views: PlacedView[], anns: DrawingAnnotation[], target: string, dimsOnly = false): number[] {
  const t = target.trim();
  if (isId(t)) {
    const i = Number(t.slice(1)) - 1;
    if (!(i >= 0 && i < anns.length)) throw new Error(tr("{0} na listu není – id jsou a1…a{1} (výkres stav)", t, anns.length));
    if (dimsOnly && anns[i].type !== "dim" && anns[i].type !== "callout") throw new Error(tr("{0} není kóta ani popis – značka se váže na kótu", t));
    return [i];
  }
  const dims = new Set(findDims(views, anns, t));
  const low = t.toLowerCase();
  return anns.flatMap((a, i) => (dims.has(a) || (!dimsOnly && a.type !== "dim" && a.type !== "callout" && annLabel(views, a).toLowerCase() === low) ? [i] : []));
}

/** Právě jedna poznámka podle zadání, jinak srozumitelná chyba se seznamem. */
export function resolveOne(views: PlacedView[], anns: DrawingAnnotation[], target: string, o: Partial<DrawingOptions>, dimsOnly = false): number {
  const hits = resolveAnns(views, anns, target, dimsOnly);
  const pick = (a: DrawingAnnotation) => !dimsOnly || a.type === "dim" || a.type === "callout";
  if (!hits.length) throw new Error(tr("„{0}“ na listu není – {1}", target, annList(views, anns, o, pick)));
  if (hits.length > 1) throw new Error(tr("„{0}“ není jednoznačné ({1}×: {2}) – zadejte id", target, hits.length, hits.map((i) => `${shortId(i)} ${annLabel(views, anns[i])} (${NAME(anns[i].view, o)})`).join(", ")));
  return hits[0];
}

// ---------------------------------------------------------------- souřadnice agenta → pohled / list

const AX = ["X", "Y", "Z"];
const up = (c: { d: Vec3; x: Vec3 }): Vec3 => [c.d[1] * c.x[2] - c.d[2] * c.x[1], c.d[2] * c.x[0] - c.d[0] * c.x[2], c.d[0] * c.x[1] - c.d[1] * c.x[0]];
/** název osy modelu ve směru vektoru (X, −Y…) nebo prázdný u šikmého směru */
const axisName = (v: Vec3) => {
  const k = v.findIndex((x) => Math.abs(Math.abs(x) - 1) < 1e-6);
  // šikmý směr (pomocný pohled, řez lomenou čarou): vektor v souřadnicích modelu
  return k < 0 ? `[${v.map((x) => fmtN(Math.round(x * 1000) / 1000)).join("; ")}]` : `${v[k] < 0 ? "−" : ""}${AX[k]}`;
};

/** bod agenta (x, y nahoru) → souřadnice pohledu (y dolů) a zpět */
export const agentToView = (p: Vec2): Vec2 => [p[0], -p[1]];
export const viewToAgent = (q: Vec2): Vec2 => [q[0], -q[1]];
/** bod listu agenta (od levého dolního rohu) ↔ list výkresu (od levého horního rohu) */
export const agentToSheet = (H: number, p: Vec2): Vec2 => [p[0], H - p[1]];
export const sheetToAgent = (H: number, q: Vec2): Vec2 => [q[0], H - q[1]];

/** Pohled výkresu podle odkazu (front…, section, model:<název>) – chyba se seznamem pohledů na listu. */
export function findView(res: Pick<DrawingResult, "views">, o: Partial<DrawingOptions>, ref: string): PlacedView {
  let key = ref;
  if (ref.startsWith("model:")) {
    const name = ref.slice(6).toLowerCase();
    const m = o.models?.find((x) => x.name.toLowerCase() === name);
    key = m ? modelViewKey(m.id) : ref;
  }
  const v = res.views.find((x) => x.key === key);
  if (v) return v;
  const list = res.views.map((x) => NAME(x.key, o)).join(", ") || "—";
  if (ref === "iso") throw new Error(tr("izometrie nemá souřadnice pro značky a kóty – použijte pravoúhlý pohled ({0}) nebo místo na listu", list));
  throw new Error(tr("pohled „{0}“ na listu není – pohledy: {1}", ref.startsWith("model:") ? ref.slice(6) : NAME(ref, o), list));
}

/** rozsah pohledu v souřadnicích agenta: x0…x1, y0…y1 (mm modelu v rovině pohledu, y nahoru) */
export const viewBox = (v: PlacedView) => {
  // přerušený pohled: skutečný rozsah (souřadnice kót a značek jsou skutečné)
  const e = viewExtent(v);
  return { x0: e.x0, x1: e.x1, y0: -e.y1, y1: -e.y0 };
};

/**
 * Přichycení bodu ke geometrii pohledu jako myš (do `tolSheet` mm listu): konec hrany / střed kružnice, jinak pata na hraně
 * nebo kružnici. Vrací bod v souřadnicích pohledu a co se přichytilo.
 */
export function snapView(v: PlacedView, q: Vec2, tolSheet = 1.5, want: "any" | "point" = "any"): { q: Vec2; what: "point" | "edge" | "circle" | null } {
  const tol = tolSheet / v.s;
  const pick = pickViewEnt(v.ents ?? [], q, tol, want);
  if (!pick) return { q, what: null };
  if (pick.kind === "point") return { q: pick.p, what: "point" };
  if (pick.kind === "line") {
    const dx = pick.b[0] - pick.a[0];
    const dy = pick.b[1] - pick.a[1];
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((q[0] - pick.a[0]) * dx + (q[1] - pick.a[1]) * dy) / l2));
    return { q: [pick.a[0] + dx * t, pick.a[1] + dy * t], what: "edge" };
  }
  const d = Math.hypot(q[0] - pick.c[0], q[1] - pick.c[1]) || 1;
  return { q: [pick.c[0] + ((q[0] - pick.c[0]) / d) * pick.r, pick.c[1] + ((q[1] - pick.c[1]) / d) * pick.r], what: "circle" };
}

/** bod pohledu musí ležet v pohledu (s okrajem 10 % a aspoň 2 mm) */
function inView(v: PlacedView, q: Vec2, name: string) {
  const m = Math.max(2, 0.1 * Math.max(v.w, v.h));
  if (q[0] < v.x0 - m || q[0] > v.x0 + v.w + m || q[1] < v.y0 - m || q[1] > v.y0 + v.h + m) {
    const b = viewBox(v);
    throw new Error(tr("bod {0} je mimo pohled {1} (x {2}…{3}, y {4}…{5} mm) – rozsahy ukáže výkres stav", fmtP(viewToAgent(q)), name, fmtN(b.x0), fmtN(b.x1), fmtN(b.y0), fmtN(b.y1)));
  }
}

/** Bod cíle značky na listu: pohled (s přichycením) nebo detail; vrací pohled poznámky a bod listu (y dolů). */
function targetPoint(res: DrawingResult, o: Partial<DrawingOptions>, view: string, at: Vec2): { view: string; sheet: Vec2; what: string; name: string } {
  if (view.startsWith("detail:")) {
    const label = view.slice(7);
    const d = o.details?.find((x) => x.label === label);
    const placed = res.details?.find((x) => x.label === label);
    if (!d || !placed) throw new Error(tr("detail {0} na listu není – detaily: {1}", label, (o.details ?? []).map((x) => x.label).join(", ") || "—"));
    const q = agentToView(at);
    if (Math.hypot(q[0] - d.cx, q[1] - d.cy) > d.r * 1.05) throw new Error(tr("bod {0} leží mimo kruh detailu {1} (střed {2}, r {3})", fmtP(at), label, fmtP(viewToAgent([d.cx, d.cy])), fmtN(d.r)));
    const sheet: Vec2 = [placed.x + (q[0] - (d.cx - d.r)) * d.scale, placed.y + (q[1] - (d.cy - d.r)) * d.scale];
    return { view: "sheet", sheet, what: "", name: tr("detail {0}", label) };
  }
  const v = findView(res, o, view);
  const name = NAME(v.key, o);
  const q0 = agentToView(at);
  inView(v, q0, name);
  const s = snapView(v, q0);
  const what = s.what === "point" ? tr("bod geometrie") : s.what === "edge" ? tr("hrana") : s.what === "circle" ? tr("kružnice") : tr("volný bod");
  return { view: v.key, sheet: annToSheet(res.views, v.key, s.q), what, name };
}

/**
 * Kotevní bod kóty / popisu na listu pro značku „na <kóta>“ a směr ven (`out`, kam se značka odsadí, aby nezakryla text):
 * délková kóta = za koncem kótovací čáry, Ø / R a popis díry = za koncem police s textem, úhel = střed oblouku.
 */
export function dimAnchor(views: PlacedView[], a: DrawingAnnotation): Vec2 {
  return dimAnchorDir(views, a).p;
}
export function dimAnchorDir(views: PlacedView[], a: DrawingAnnotation): { p: Vec2; out: Vec2 } {
  const S = (q: Vec2) => annToSheet(views, a.view, q);
  const shelfEnd = (K: Vec2, right: boolean, w: number) => ({ p: [K[0] + (right ? w + 1 : -w - 1), K[1]] as Vec2, out: [right ? 1 : -1, 0] as Vec2 });
  if (a.type === "callout") {
    const T = S(a.tip);
    const K = S(a.at);
    const w = Math.max(6, ...calloutLines(a).map((l) => l.length * 3.5 * 0.6)) + 2;
    return shelfEnd(K, K[0] >= T[0], w);
  }
  if (a.type !== "dim") throw new Error(tr("značka se váže na kótu nebo popis"));
  if (isRadialDim(a)) {
    const v = views.find((x) => x.key === a.view);
    const C = S(a.c);
    const R = a.r * (v?.s ?? 1);
    const rad = (a.ang * Math.PI) / 180;
    const u: Vec2 = [Math.cos(rad), Math.sin(rad)];
    const K: Vec2 = [C[0] + u[0] * (R + a.offset), C[1] + u[1] * (R + a.offset)];
    return shelfEnd(K, u[0] >= 0, dimLabel(a, a.kind === "diameter" ? 2 * a.r : a.r).length * 2.05 + 2);
  }
  if (a.kind === "angle") {
    const g = angleGeom(S(a.a), S(a.b), S(a.a2), S(a.b2), a.ang);
    if (!g) return { p: S(a.a), out: [1, 0] };
    const t = g.t1 + g.sweep / 2;
    return { p: [g.X[0] + Math.cos(t) * a.offset, g.X[1] + Math.sin(t) * a.offset], out: [Math.cos(t), Math.sin(t)] };
  }
  const A = S(a.a);
  const B = S(a.b);
  let A2: Vec2;
  let B2: Vec2;
  if (a.kind === "horizontal") {
    A2 = [A[0], A[1] + a.offset];
    B2 = [B[0], A[1] + a.offset];
  } else if (a.kind === "vertical") {
    A2 = [A[0] + a.offset, A[1]];
    B2 = [A[0] + a.offset, B[1]];
  } else {
    const l = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
    const n: Vec2 = [-(B[1] - A[1]) / l, (B[0] - A[0]) / l];
    A2 = [A[0] + n[0] * a.offset, A[1] + n[1] * a.offset];
    B2 = [B[0] + n[0] * a.offset, B[1] + n[1] * a.offset];
  }
  // za koncem kótovací čáry (vpravo / nahoře) – text kóty je uprostřed, značka ho nezakryje
  const [P, Q] = B2[0] > A2[0] + 1e-6 || (Math.abs(B2[0] - A2[0]) <= 1e-6 && B2[1] < A2[1]) ? [A2, B2] : [B2, A2];
  const l = Math.hypot(Q[0] - P[0], Q[1] - P[1]) || 1;
  const u: Vec2 = [(Q[0] - P[0]) / l, (Q[1] - P[1]) / l];
  return { p: [Q[0] + u[0] * 2, Q[1] + u[1] * 2], out: u };
}

/** Přesahuje poznámka rámeček listu (ISO 5457: vlevo 20 mm, jinde 10 mm)? – varování pro agenta. */
export function outsideFrame(res: DrawingResult, ann: DrawingAnnotation): boolean {
  const g = annotationGeometry(res, [ann]);
  const pts = [...g.polys.flatMap((p) => p.pts), ...g.texts.flatMap((t) => { const b = textBox(t); return [[b[0], b[1]], [b[2], b[3]]] as Vec2[]; })];
  return pts.some((p) => p[0] < 20 - 0.01 || p[1] < 10 - 0.01 || p[0] > res.sheet.w - 10 + 0.01 || p[1] > res.sheet.h - 10 + 0.01);
}

/** Texty nové poznámky, které se na listu překrývají s jinými texty (obdélníky textů) – varování pro agenta. */
export function overlappingTexts(res: DrawingResult, anns: DrawingAnnotation[], ann: DrawingAnnotation): string[] {
  const own = annotationGeometry(res, [ann]).texts.map(textBox);
  const rest = [...res.texts, ...annotationGeometry(res, anns).texts];
  const hit = new Set<string>();
  for (const t of rest) {
    const b = textBox(t);
    if (own.some((o) => o[0] < b[2] - 0.2 && b[0] < o[2] - 0.2 && o[1] < b[3] - 0.2 && b[1] < o[3] - 0.2)) hit.add(t.s);
  }
  return [...hit];
}

// ---------------------------------------------------------------- značky

const MARK_NAME: Record<MarkSpec["type"], string> = { note: "poznámka", roughness: "drsnost", gdt: "geometrická tolerance", datum: "základna", text: "text" };
const nextDatum = (anns: DrawingAnnotation[]) => {
  const used = new Set(anns.flatMap((a) => (a.type === "datum" ? [a.label] : [])));
  return "ABCDEFGHJKLMNPRSTUVWXYZ".split("").find((c) => !used.has(c)) ?? "A";
};

/** obdélník značky bez odkazové čáry (rámeček, symbol, text) na listu */
function bodyBox(res: DrawingResult, a: DrawingAnnotation): [number, number, number, number] | null {
  const g = annotationGeometry(res, [{ ...a, leader: undefined } as DrawingAnnotation]);
  const pts = [...g.polys.flatMap((p) => p.pts), ...g.texts.flatMap((t) => { const b = textBox(t); return [[b[0], b[1]], [b[2], b[3]]] as Vec2[]; })];
  if (!pts.length) return null;
  return [Math.min(...pts.map((p) => p[0])) - 0.5, Math.min(...pts.map((p) => p[1])) - 0.5, Math.max(...pts.map((p) => p[0])) + 0.5, Math.max(...pts.map((p) => p[1])) + 0.5];
}
/** co už na listu zabírá místo: texty výkresu a kót, těla značek */
function obstacles(res: DrawingResult, anns: DrawingAnnotation[]): [number, number, number, number][] {
  const g = annotationGeometry(res, anns);
  const marks = anns.filter((a) => a.type === "note" || a.type === "roughness" || a.type === "gdt" || a.type === "datum" || a.type === "text").flatMap((a) => {
    const b = bodyBox(res, a);
    return b ? [b] : [];
  });
  return [...res.texts.map(textBox), ...g.texts.map(textBox), ...marks];
}

/**
 * Značka podle zadání agenta: poloha na listu podle cíle (kóta, bod pohledu s přichycením, místo na listu), posun popisku
 * `shift` [mm listu, y nahoru] a poznámka v souřadnicích pohledu (asociativní s pohledem). Vrací poznámku a popis do protokolu.
 */
export function makeMark(res: DrawingResult, o: Partial<DrawingOptions>, anns: DrawingAnnotation[], mark: MarkSpec, target: MarkTarget, shift?: Vec2): { ann: DrawingAnnotation; where: string } {
  let view = "sheet";
  let anchor: Vec2;
  let where: string;
  /** směr od kóty ven (značka na kótu se odsadí tímto směrem) */
  let out: Vec2 | null = null;
  if ("on" in target) {
    const i = resolveOne(res.views, anns, target.on, o, true);
    const a = anns[i];
    view = a.view;
    const ad = dimAnchorDir(res.views, a);
    anchor = ad.p;
    out = ad.out;
    where = tr("kóta {0} ({1}, {2})", annLabel(res.views, a), NAME(a.view, o), shortId(i));
  } else if ("view" in target) {
    const t = targetPoint(res, o, target.view, target.at);
    view = t.view;
    anchor = t.sheet;
    where = t.what ? tr("{0} {1} – {2}", t.name, fmtP(target.at), t.what) : `${t.name} ${fmtP(target.at)}`;
  } else {
    anchor = agentToSheet(res.sheet.h, target.sheet);
    where = tr("list {0}", fmtP(target.sheet));
  }
  const v = res.views.find((x) => x.key === view);
  const loc = (q: Vec2): Vec2 => (view === "sheet" || !v ? q : sheetToAnn(v, q));
  const sh = (d: Vec2): Vec2 => [anchor[0] + d[0], anchor[1] + d[1]];
  const id = uid();
  /** značka s popiskem posunutým o `d` [mm listu, y dolů] od cíle (null = přímo v cíli, bez odkazové čáry) */
  const make = (d: Vec2 | null): DrawingAnnotation => {
    switch (mark.type) {
      case "note":
        return { id, view, type: "note", at: loc(sh(d ?? [8, -8])), leader: loc(anchor), text: mark.text };
      case "roughness":
        return d ? { id, view, type: "roughness", at: loc(sh(d)), leader: loc(anchor), ra: mark.ra } : { id, view, type: "roughness", at: loc(anchor), ra: mark.ra };
      case "gdt":
        return { id, view, type: "gdt", at: loc(sh(d ?? [5, -14])), leader: loc(anchor), symbol: mark.symbol, value: mark.value, ...(mark.datum ? { datum: mark.datum } : {}) };
      case "datum":
        return { id, view, type: "datum", at: loc(sh(d ?? [0, 0])), label: mark.label ?? nextDatum(anns) };
      case "text":
        return { id, view: "sheet", type: "text", at: sh(d ?? [0, 0]), text: mark.text, size: mark.size };
    }
  };
  let ann: DrawingAnnotation;
  if (shift) ann = make([shift[0], -shift[1]]);
  else {
    // první volné místo popisku (bez překryvu s texty a jinými značkami, uvnitř listu); preferovaná strana podle kóty
    const left = !!out && out[0] < -0.5;
    const fw = mark.type === "gdt" ? 7 + Math.max(9, mark.value.length * 3.5 * 0.6 + 3) + (mark.datum ? 7 : 0) : mark.type === "note" ? Math.max(6, mark.text.length * 3.5 * 0.58 + 2) : 18;
    const R: Vec2[] = mark.type === "gdt" ? [[5, -14], [5, 6], [5, -24], [5, 16], [18, -14], [5, -34]] : mark.type === "note" ? [[8, -8], [8, 12], [8, -18], [8, 22], [20, -8], [8, -28]] : mark.type === "roughness" ? [[12, -6], [12, 10], [12, -18], [0, -18], [24, -6]] : [];
    const L: Vec2[] = R.map(([x, y]) => [-x - fw, y]);
    const cands: (Vec2 | null)[] = mark.type === "datum" || mark.type === "text" ? [null] : [...(mark.type === "roughness" && !left ? [null] : []), ...(left ? [...L, ...R] : [...R, ...L])];
    const obst = obstacles(res, anns);
    const W = res.sheet.w;
    const H = res.sheet.h;
    ann = make(cands[0]);
    for (const c of cands) {
      const a = make(c);
      const b = bodyBox(res, a);
      if (!b || b[0] < 12 || b[1] < 12 || b[2] > W - 12 || b[3] > H - 12) continue;
      if (obst.some((o) => o[0] < b[2] && b[0] < o[2] && o[1] < b[3] && b[1] < o[3])) continue;
      ann = a;
      break;
    }
  }
  return { ann, where: `${tr(MARK_NAME[mark.type])} ${annLabel(res.views, ann)} → ${where}` };
}

// ---------------------------------------------------------------- ruční kóty

/** úsečka pohledu, se kterou zadaná úsečka splývá (přímka a překryv) – pro asociativní kótu hrany / úhlu */
function lineEnt(ents: ViewEnt[], a: Vec2, b: Vec2, tol: number): [Vec2, Vec2] | null {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1e-9) return null;
  const u: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  let best: [Vec2, Vec2] | null = null;
  let bestOv = 0;
  for (const e of ents) {
    if (e.t !== "line") continue;
    const off = (p: Vec2) => Math.abs(u[0] * (p[1] - a[1]) - u[1] * (p[0] - a[0]));
    if (off(e.a) > tol || off(e.b) > tol) continue;
    const t0 = u[0] * (e.a[0] - a[0]) + u[1] * (e.a[1] - a[1]);
    const t1 = u[0] * (e.b[0] - a[0]) + u[1] * (e.b[1] - a[1]);
    const ov = Math.min(Math.max(t0, t1), L) - Math.max(Math.min(t0, t1), 0);
    if (ov > bestOv + 1e-9) {
      bestOv = ov;
      best = t0 <= t1 ? [e.a, e.b] : [e.b, e.a]; // zachovat směr zadání
    }
  }
  return bestOv > tol ? best : null;
}
const near = (p: Vec2, q: Vec2, tol: number) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol;
const KIND_NAME: Record<ManualDim["kind"], string> = { horizontal: "vodorovně", vertical: "svisle", aligned: "šikmo", diameter: "průměr", radius: "poloměr", angle: "úhel" };

/**
 * Ruční kóta (nástroj Kóta) podle bodů agenta: body se přichytí ke koncům hran / středům kružnic, dva konce jedné hrany
 * = kóta hrany (sleduje hranu), kružnice se dohledá podle středu a poloměru, úhel dvou hran. `offset` [mm listu]:
 * kladné = vně pohledu (dál od jeho středu), záporné = na druhou stranu.
 */
export function makeManualDim(res: DrawingResult, o: Partial<DrawingOptions>, dim: ManualDim, offset?: number, text?: string): { ann: DimAnn; where: string } {
  if (dim.view.startsWith("detail:")) throw new Error(tr("kóty se zadávají v pohledu, ne v detailu – použijte pohled, ze kterého je detail"));
  const v = findView(res, o, dim.view);
  const name = NAME(v.key, o);
  const ents = v.ents ?? [];
  const tol = 1.5 / v.s;
  const S = (q: Vec2) => annToSheet(res.views, v.key, q);
  const C: Vec2 = [v.px + (v.w * v.s) / 2, v.py + (v.h * v.s) / 2];
  const extra = text !== undefined ? { text } : {};
  const id = uid();
  let ann: DimAnn;
  let how = "";
  if ("c" in dim) {
    const c = agentToView(dim.c);
    inView(v, c, name);
    const tolC = Math.max(0.02, 0.5 / v.s);
    const arcs = ents.filter((e): e is Extract<ViewEnt, { t: "arc" }> => e.t === "arc" && near(e.c, c, tolC));
    const radii = [...new Set(arcs.map((e) => Math.round(e.r * 1000) / 1000))].sort((x, y) => x - y);
    let r: number | undefined;
    if (dim.r !== undefined) r = radii.find((x) => Math.abs(x - dim.r!) <= Math.max(tolC, 0.01 * dim.r!));
    else if (radii.length === 1) r = radii[0];
    if (r === undefined) {
      const all = [...new Map(ents.filter((e): e is Extract<ViewEnt, { t: "arc" }> => e.t === "arc").map((e) => [`${e.c[0].toFixed(2)},${e.c[1].toFixed(2)},${e.r.toFixed(2)}`, e])).values()].slice(0, 12);
      const list = all.map((e) => `${tr("střed")} ${fmtP(viewToAgent(e.c))} R${fmtN(e.r)}`).join(", ") || "—";
      throw new Error(radii.length > 1 && dim.r === undefined ? tr("v bodě {0} je více kružnic (R {1}) – zadejte r", fmtP(dim.c), radii.map(fmtN).join(", ")) : tr("v pohledu {0} není kružnice se středem {1}{2} – kružnice: {3}", name, fmtP(dim.c), dim.r !== undefined ? ` R${fmtN(dim.r)}` : "", list));
    }
    const exact = arcs.find((e) => Math.abs(e.r - r!) < 1e-3)!;
    ann = { id, view: v.key, type: "dim", kind: dim.kind, c: exact.c, r: exact.r, ang: -(dim.ang ?? 45), offset: offset ?? 8, ...extra };
  } else if ("l1" in dim) {
    const seg = (l: [Vec2, Vec2]): [Vec2, Vec2] => {
      const a = agentToView(l[0]);
      const b = agentToView(l[1]);
      inView(v, a, name);
      inView(v, b, name);
      return lineEnt(ents, a, b, tol) ?? [a, b];
    };
    const [a, b] = seg(dim.l1);
    const [a2, b2] = seg(dim.l2);
    const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const l2 = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]);
    if (l1 < 1e-9 || l2 < 1e-9) throw new Error(tr("kóta úhel: hrana má nulovou délku"));
    const d1: Vec2 = [(b[0] - a[0]) / l1, (b[1] - a[1]) / l1];
    const d2: Vec2 = [(b2[0] - a2[0]) / l2, (b2[1] - a2[1]) / l2];
    if (Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) < 1e-6) throw new Error(tr("kóta úhel: hrany jsou rovnoběžné – pro jejich vzdálenost použijte kótu šikmo / vodorovně / svisle"));
    const bis: Vec2 = [d1[0] + d2[0], d1[1] + d2[1]];
    const ang = Math.hypot(bis[0], bis[1]) < 1e-9 ? Math.atan2(-d1[0], d1[1]) : Math.atan2(bis[1], bis[0]);
    ann = { id, view: v.key, type: "dim", kind: "angle", a, b, a2, b2, ang: Math.round((ang * 180) / Math.PI * 100) / 100, offset: Math.max(3, Math.abs(offset ?? 12)), ...extra };
  } else {
    const q1 = agentToView(dim.p1);
    const q2 = agentToView(dim.p2);
    inView(v, q1, name);
    inView(v, q2, name);
    const s1 = snapView(v, q1, 1.5, "point");
    const s2 = snapView(v, q2, 1.5, "point");
    const a = s1.q;
    const b = s2.q;
    // dva konce jedné hrany → kóta hrany (sleduje hranu při změně modelu)
    const edge = ents.some((e) => e.t === "line" && ((near(e.a, a, 1e-6) && near(e.b, b, 1e-6)) || (near(e.a, b, 1e-6) && near(e.b, a, 1e-6))));
    const A = S(a);
    const B = S(b);
    const kind = dim.kind;
    if (kind === "horizontal" && Math.abs(B[0] - A[0]) < 1e-6) throw new Error(tr("kóta vodorovně: body mají stejné x – vodorovná vzdálenost je nulová"));
    if (kind === "vertical" && Math.abs(B[1] - A[1]) < 1e-6) throw new Error(tr("kóta svisle: body mají stejné y – svislá vzdálenost je nulová"));
    if (kind === "aligned" && near(A, B, 1e-6)) throw new Error(tr("kóta šikmo: body splývají"));
    const off = offset ?? 10;
    const flip = off < 0 ? -1 : 1;
    const d = Math.abs(off);
    let o2: number;
    if (kind === "horizontal") {
      const side = ((A[1] + B[1]) / 2 < C[1] ? -1 : 1) * flip;
      const y = side < 0 ? Math.min(A[1], B[1]) - d : Math.max(A[1], B[1]) + d;
      o2 = y - A[1];
    } else if (kind === "vertical") {
      const side = ((A[0] + B[0]) / 2 < C[0] ? -1 : 1) * flip;
      const x = side < 0 ? Math.min(A[0], B[0]) - d : Math.max(A[0], B[0]) + d;
      o2 = x - A[0];
    } else {
      const l = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const n: Vec2 = [-(B[1] - A[1]) / l, (B[0] - A[0]) / l];
      const M: Vec2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      const side = ((M[0] - C[0]) * n[0] + (M[1] - C[1]) * n[1] >= 0 ? 1 : -1) * flip;
      o2 = side * d;
    }
    ann = { id, view: v.key, type: "dim", kind, a, b, offset: Math.round(o2 * 100) / 100, ...(edge ? { edge: true } : {}), ...extra };
    how = edge ? tr("hrana") : s1.what || s2.what ? tr("přichyceno ke geometrii") : tr("volné body");
  }
  return { ann, where: `${name}, ${tr(KIND_NAME[dim.kind])}${how ? `, ${how}` : ""}` };
}

// ---------------------------------------------------------------- úpravy

/** Úprava kóty / značky (výkres upravit): odsazení, text, přípona, hodnota, základna, výška písma, posun značky (`scale` = měřítko pohledu značky). */
export function patchAnn(a: DrawingAnnotation, p: AnnPatch, scale = 1): DrawingAnnotation {
  const bad = (k: string) => new Error(tr("{0} nelze u {1} upravit – lze: {2}", k, tr(TYPE_NAME[a.type]), ALLOWED[a.type].join(", ") || "—"));
  const keys = Object.keys(p) as (keyof AnnPatch)[];
  for (const k of keys) if (!ALLOWED_KEYS[a.type].includes(k)) throw bad(KEY_NAME[k]);
  const opt = (s: string | undefined) => (s === undefined ? undefined : s.trim() ? s : undefined);
  if (p.shift && "at" in a && a.type !== "callout") {
    // posun popisku značky: mm listu (y nahoru) → souřadnice poznámky; drsnost / základna bez odkazu dostane odkaz na původní místo
    const d: Vec2 = [p.shift[0] / scale, -p.shift[1] / scale];
    const moved = { ...a, at: [a.at[0] + d[0], a.at[1] + d[1]] as Vec2 };
    a = a.type === "roughness" && !a.leader ? { ...moved, leader: a.at } as DrawingAnnotation : (moved as DrawingAnnotation);
  }
  switch (a.type) {
    case "dim": {
      let n: DimAnn = { ...a };
      if (p.offset !== undefined) n = { ...n, offset: isRadialDim(n) ? p.offset : n.kind === "angle" ? Math.max(1, Math.abs(p.offset)) : (n.offset < 0 ? -1 : 1) * p.offset } as DimAnn;
      if (p.text !== undefined) n = { ...n, text: opt(p.text) };
      if (p.suffix !== undefined) n = { ...n, suffix: opt(p.suffix) };
      return n;
    }
    case "callout":
      return { ...a, tol: opt(p.suffix) };
    case "note":
      return { ...a, text: p.text ?? a.text };
    case "text":
      return { ...a, text: p.text ?? a.text, size: p.height && p.height > 0 ? p.height : a.size };
    case "roughness":
      return { ...a, ra: p.text ?? p.value ?? a.ra };
    case "gdt":
      return { ...a, value: p.value ?? p.text ?? a.value, datum: p.datum !== undefined ? opt(p.datum.toUpperCase()) : a.datum };
    case "datum":
      return { ...a, label: (p.text ?? p.datum ?? a.label).toUpperCase() };
    case "centerline":
      return a;
  }
}
const TYPE_NAME: Record<DrawingAnnotation["type"], string> = { dim: "kóty", callout: "popisu", note: "poznámky", text: "textu", roughness: "drsnosti", gdt: "geometrické tolerance", datum: "základny", centerline: "osy" };
const KEY_NAME: Record<keyof AnnPatch, string> = { offset: "odsazení", text: "text", suffix: "přípona", value: "hodnota", datum: "základna", height: "výška", shift: "posun" };
const ALLOWED_KEYS: Record<DrawingAnnotation["type"], (keyof AnnPatch)[]> = {
  dim: ["offset", "text", "suffix"],
  callout: ["suffix"],
  note: ["text", "shift"],
  text: ["text", "height", "shift"],
  roughness: ["text", "value", "shift"],
  gdt: ["value", "text", "datum", "shift"],
  datum: ["text", "datum", "shift"],
  centerline: [],
};
const ALLOWED = Object.fromEntries(Object.entries(ALLOWED_KEYS).map(([k, v]) => [k, v.map((x) => KEY_NAME[x])])) as Record<DrawingAnnotation["type"], string[]>;

// ---------------------------------------------------------------- stav: rozsahy pohledů

/** Řádky stavu: list, pohledy s rozsahem souřadnic modelu v rovině pohledu a polohou na listu, detaily. */
export function viewRangeLines(res: DrawingResult, o: Partial<DrawingOptions>): string[] {
  const H = res.sheet.h;
  const L: string[] = [tr("Souřadnice (pro „pohled … v x y“ a kóty: mm modelu v rovině pohledu, y nahoru; list: mm od levého dolního rohu, {0} × {1}):", res.sheet.w, H)];
  for (const v of res.views) {
    const b = viewBox(v);
    const ax = v.cam ? `x = ${axisName(v.cam.x) || "?"}, y = ${axisName(up(v.cam)) || "?"}` : "";
    const sx0 = v.px;
    const sx1 = v.px + v.w * v.s;
    const sy0 = H - (v.py + v.h * v.s);
    const sy1 = H - v.py;
    L.push(tr("  {0}{1}: x {2}…{3}, y {4}…{5} mm · {6} · na listu x {7}…{8}, y {9}…{10}", NAME(v.key, o), ax ? ` (${ax})` : "", fmtN(b.x0), fmtN(b.x1), fmtN(b.y0), fmtN(b.y1), scaleLabel(v.s), fmtN(sx0), fmtN(sx1), fmtN(sy0), fmtN(sy1)));
  }
  for (const d of o.details ?? []) {
    const p = res.details?.find((x) => x.label === d.label);
    L.push(tr("  detail {0} (z pohledu {1}, střed {2}, r {3}, {4}){5}", d.label, NAME(d.view, o), fmtP(viewToAgent([d.cx, d.cy])), fmtN(d.r), scaleLabel(d.scale), p ? tr(" · na listu x {0}…{1}, y {2}…{3}", fmtN(p.x), fmtN(p.x + p.w), fmtN(H - (p.y + p.h)), fmtN(H - p.y)) : tr(" · není na listu")));
  }
  return L;
}
