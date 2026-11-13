/**
 * Textové příkazy balíku „plochy“ (7. vlna): tečny splinu, plochy třídy A (výplň, přechod, prodloužení, CV body),
 * analýza návaznosti hran a hřebeny křivosti. Čisté funkce (parsování) – provedení je v agent-surfaces-host.ts (UI).
 *
 * Spline s tečnami (v řádku skici):
 *   spline 0 0 50 20 100 0 tečna-začátek 30 tečna-konec -30 [váha-začátek 1,5] [tečna p1 90] [váha p1 2]
 *   EN: tangent-start / tangent-end / tangent pN, weight-start / weight-end / weight pN
 *   DE: tangente-anfang / tangente-ende / tangente pN, gewicht-anfang / gewicht-ende / gewicht pN
 * Úprava existující entity: `entita e3 tečna-začátek=30 tečna-p1=vyp váha-konec=2`.
 */
import { getLang, tr } from "./i18n";
import type { SurfQueryResult } from "./surf-query";
import { setTangent, tangentAt, weightAt, type SplineEnt } from "./spline-tangent";
import type { Feature } from "./types";

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const isNum = (t: string) => /^[+-]?(\d+[.,]?\d*|[.,]\d+)°?$/.test(t);
const num = (t: string) => parseFloat(t.replace(",", ".").replace("°", ""));

// ───────────── spline: tečny a váhy ─────────────

const TANGENT = new Set(["tecna", "tangent", "tangente", "tangenta"]);
const WEIGHT = new Set(["vaha", "weight", "gewicht"]);
const START = new Set(["zacatek", "zacatku", "start", "begin", "anfang", "beginn"]);
const END = new Set(["konec", "konci", "end", "ende"]);
const OFF = new Set(["vyp", "volna", "volne", "zadna", "off", "none", "free", "frei", "aus", "keine"]);

/** jedna položka zápisu tečny: index bodu („start“/„end“ = první/poslední), úhel (null = zrušit) nebo váha */
export type TangentSpec = { at: number | "start" | "end"; angle?: number | null; weight?: number };

/** „tečna-začátek“ → { kind: tangent, at: start } · „váha-p1“ → { kind: weight, at: 1 } · null = jiné slovo */
function tangentWord(raw: string): { kind: "tangent" | "weight"; at?: number | "start" | "end" } | null {
  const w = fold(raw);
  const m = /^([a-z]+)(?:[-_]([a-z]+\d*|\d+))?$/.exec(w);
  if (!m) return null;
  const kind = TANGENT.has(m[1]) ? "tangent" : WEIGHT.has(m[1]) ? "weight" : null;
  if (!kind) return null;
  const q = m[2];
  if (!q) return { kind };
  if (START.has(q)) return { kind, at: "start" };
  if (END.has(q)) return { kind, at: "end" };
  const pm = /^p?(\d+)$/.exec(q);
  if (pm) return { kind, at: Number(pm[1]) };
  return null;
}
/** „začátek“ / „konec“ / „p2“ za slovem tečna / váha */
function pointWord(raw: string | undefined): number | "start" | "end" | null {
  if (raw === undefined) return null;
  const w = fold(raw);
  if (START.has(w)) return "start";
  if (END.has(w)) return "end";
  const pm = /^p(\d+)$/.exec(w);
  return pm ? Number(pm[1]) : null;
}

/**
 * Z tokenů entity spline vybere zápisy tečen a vah; vrátí zbylé tokeny (body, „uzavřít“…) a seznam zápisů.
 * Chybný zápis hlásí srozumitelně (číslo bodu, chybějící úhel).
 */
export function splitSplineTangents(tokens: string[]): { rest: string[]; specs: TangentSpec[] } {
  const rest: string[] = [];
  const specs: TangentSpec[] = [];
  const usage = tr("tečna se píše: tečna-začátek 30 · tečna-konec -30 · tečna p1 45 · váha-začátek 1,5 · váha p1 2 (úhel ve stupních od osy X skici; „vyp“ tečnu zruší)");
  for (let i = 0; i < tokens.length; i++) {
    const tw = tangentWord(tokens[i]);
    if (!tw) {
      rest.push(tokens[i]);
      continue;
    }
    let at = tw.at;
    if (at === undefined) {
      const pw = pointWord(tokens[i + 1]);
      if (pw === null) throw new Error(usage);
      at = pw;
      i++;
    }
    const v = tokens[i + 1];
    if (v === undefined) throw new Error(usage);
    if (tw.kind === "tangent" && OFF.has(fold(v))) {
      specs.push({ at, angle: null });
      i++;
      continue;
    }
    if (!isNum(v)) throw new Error(usage);
    const x = num(v);
    if (tw.kind === "weight" && !(x > 0)) throw new Error(tr("váha tečny musí být kladná (1 = přirozená)"));
    specs.push(tw.kind === "tangent" ? { at, angle: x } : { at, weight: x });
    i++;
  }
  return { rest, specs };
}

/** Použije zápisy tečen na spline (kontrola čísel bodů). */
export function applySplineTangents<E extends SplineEnt>(e: E, specs: TangentSpec[]): E {
  let out: SplineEnt = e;
  const n = e.points.length;
  for (const s of specs) {
    const i = s.at === "start" ? 0 : s.at === "end" ? n - 1 : s.at;
    if (!(i >= 0 && i < n)) throw new Error(tr("spline má body p0–p{0} – tečna u p{1} není možná", n - 1, i));
    if (s.weight !== undefined) {
      const ang = tangentAt(out, i);
      if (ang === null) throw new Error(tr("váha u p{0}: nejdřív zadejte tečnu (tečna p{0} úhel)", i));
      out = setTangent(out, i, ang, s.weight);
    } else out = setTangent(out, i, s.angle ?? null, s.angle === null ? null : weightAt(out, i));
  }
  return out as E;
}

/** je klíč `entita e3 klíč=…` tečnou / váhou splinu (tečna-začátek, váha-p2…)? */
export const isSplineTangentKey = (key: string) => tangentWord(key)?.at !== undefined;

/**
 * `entita e3 tečna-začátek=30 tečna-p1=vyp váha-konec=2` – úprava tečen existující spline (agent-edit.ts).
 * Vrací null, není-li klíč tečnou / váhou; jinak upravenou entitu a popis změny.
 */
export function patchSplineTangentKey(e: SplineEnt, key: string, raw: unknown): { e: SplineEnt; change: string } | null {
  const tw = tangentWord(key);
  if (!tw || tw.at === undefined) return null;
  const n = e.points.length;
  const i = tw.at === "start" ? 0 : tw.at === "end" ? n - 1 : tw.at;
  if (!(i >= 0 && i < n)) throw new Error(tr("spline má body p0–p{0} – tečna u p{1} není možná", n - 1, i));
  const before = tangentAt(e, i);
  if (tw.kind === "tangent") {
    if (typeof raw === "string" && OFF.has(fold(raw))) return { e: setTangent(e, i, null), change: tr("tečna p{0} {1} → volná", i, before === null ? tr("volná") : `${before}°`) };
    if (raw === false) return { e: setTangent(e, i, null), change: tr("tečna p{0} {1} → volná", i, before === null ? tr("volná") : `${before}°`) };
    if (typeof raw !== "number") throw new Error(tr("„{0}“ čeká úhel ve stupních nebo „vyp“", key));
    return { e: setTangent(e, i, raw, weightAt(e, i)), change: tr("tečna p{0} {1} → {2}°", i, before === null ? tr("volná") : `${before}°`, raw) };
  }
  if (typeof raw !== "number" || !(raw > 0)) throw new Error(tr("váha tečny musí být kladná (1 = přirozená)"));
  if (before === null) throw new Error(tr("váha u p{0}: nejdřív zadejte tečnu (tečna p{0} úhel)", i));
  return { e: setTangent(e, i, before, raw), change: tr("váha tečny p{0} {1} → {2}", i, weightAt(e, i), raw) };
}

// ───────────── plochy třídy A a analýza ploch ─────────────

/** příkazy, které potřebují jádro (výsledek do protokolu, volitelně zobrazení v 3D okně) */
export type SurfCmd =
  | { kind: "continuity"; edges: number[]; show: boolean }
  | { kind: "comb"; edges: number[]; scale?: number; show: boolean }
  | { kind: "cvList"; face: number; grid: [number, number] | null };
/** výsledek řádku: prvek do historie, nebo dotaz na jádro; null = jiný příkaz */
export type SurfLine = { op: "feature"; feature: Feature } | { op: "cmd"; cmd: SurfCmd } | null;

const W = (...ws: string[]) => new Set(ws.map(fold));
const ANALYZE = W("analýza", "analyza", "analyzovat", "analyze", "analyse", "analysis", "analysieren");
const CONTINUITY = W("návaznosti", "navaznosti", "návaznost", "navaznost", "spojitosti", "spojitost", "continuity", "stetigkeit", "übergänge", "uebergaenge", "ubergange");
const COMB = W("hřebenu", "hrebenu", "hřeben", "hreben", "hřebeny", "hrebeny", "hřebenů", "comb", "combs", "kamm", "kämme", "kaemme", "krümmungskamm", "kruemmungskamm");
const FILL = W("výplň", "vyplň", "vypln", "vyplnit", "fill", "füllen", "fuellen", "füllfläche", "fuellflaeche", "fullflache");
const BLEND = W("přechod", "prechod", "přechodová", "prechodova", "blend", "übergang", "uebergang", "ubergang", "übergangsfläche");
const EXTEND = W("prodloužit", "prodlouzit", "extend", "verlängern", "verlaengern", "verlangern");
const EXTEND1 = W("prodloužit-plochu", "prodlouzit-plochu", "extend-surface", "fläche-verlängern", "flaeche-verlaengern", "flächeverlängern");
const SURFACE = W("plochu", "plochy", "plocha", "surface", "fläche", "flaeche", "flache");
const FACE = W("plocha", "plochu", "face", "fläche", "flaeche", "flache");
const CV = W("cv", "cvs", "řídicí-body", "ridici-body", "control-points", "kontrollpunkte");
const SHOW = W("zobrazit", "zobraz", "ukázat", "ukazat", "show", "anzeigen", "zeigen");
const SEW = W("sešít", "sesit", "sew", "nähen", "naehen", "vernähen");
const FLIP = W("obrátit", "obratit", "obráceně", "obracene", "flip", "reverse", "umkehren", "umgekehrt");
const TENSION = W("napětí", "napeti", "tension", "spannung");
const SCALE = W("měřítko", "meritko", "scale", "maßstab", "massstab");
const LENGTH = W("délka", "delka", "length", "länge", "laenge");
const GRID = W("síť", "sit", "grid", "netz");
const ROW = W("řada", "rada", "row", "reihe");
const MOVE = W("posun", "posunout", "move", "verschieben", "verschiebung");

const edgeTok = (t: string) => {
  const m = /^e(\d+)$/i.exec(t);
  return m && Number(m[1]) >= 1 ? Number(m[1]) - 1 : null;
};
const contTok = (t: string): 0 | 1 | 2 | null => (/^g[012]$/i.test(t) ? (Number(t[1]) as 0 | 1 | 2) : null);
const uid6 = () => Math.random().toString(36).slice(2, 9);
const extFeature = (ext: string, name: string, data: Record<string, unknown>): Feature => ({ id: uid6(), name, type: "ext", ext, data }) as unknown as Feature;

export const SURF_USAGE = {
  continuity: () => tr("analýza návaznosti [E3 E5 …] [zobrazit] – bez hran všechny hrany modelu"),
  comb: () => tr("analýza hřebenu [E3 …] [měřítko 50] [zobrazit]"),
  fill: () => tr("výplň E3 E4 E5 [G0|G1|G2] [sešít]"),
  blend: () => tr("přechod E3 E7 [G1|G2] [G1|G2] [napětí 1 [1,5]] [obrátit] [sešít]"),
  extend: () => tr("prodloužit plochu E5 [E6 …] 10 [G1|G2]"),
  cv: () => tr("plocha F3 cv · plocha F3 cv [síť 4 4] 2 3 posun 0 0 1,5 · plocha F3 cv řada u 2 posun 0 0 1"),
};

/** čísla za klíčovým slovem (nejvýš `max`) */
function numsAfter(tk: string[], i: number, max: number): number[] {
  const out: number[] = [];
  for (let k = i + 1; k < tk.length && out.length < max && isNum(tk[k]); k++) out.push(num(tk[k]));
  return out;
}

/** `analýza návaznosti …`, `výplň …`, `přechod …`, `prodloužit plochu …`, `plocha F3 cv …` (CS / EN / DE) */
export function parseSurfaceLine(tokens: string[]): SurfLine {
  if (!tokens.length) return null;
  const head = fold(tokens[0]);
  const f1 = fold(tokens[1] ?? "");
  // ── analýzy ──
  if (ANALYZE.has(head) && (CONTINUITY.has(f1) || COMB.has(f1))) {
    const rest = tokens.slice(2);
    const edges: number[] = [];
    let show = false;
    let scale: number | undefined;
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i];
      const e = edgeTok(t);
      if (e !== null) edges.push(e);
      else if (SHOW.has(fold(t))) show = true;
      else if (SCALE.has(fold(t)) && COMB.has(f1)) {
        const v = numsAfter(rest, i, 1)[0];
        if (!(v > 0)) throw new Error(tr("měřítko hřebenu musí být kladné: {0}", SURF_USAGE.comb()));
        scale = v;
        i++;
      } else throw new Error(tr("„{0}“ – {1}", t, CONTINUITY.has(f1) ? SURF_USAGE.continuity() : SURF_USAGE.comb()));
    }
    return { op: "cmd", cmd: CONTINUITY.has(f1) ? { kind: "continuity", edges, show } : { kind: "comb", edges, show, ...(scale ? { scale } : {}) } };
  }
  // ── výplň ──
  if (FILL.has(head)) {
    const edges: number[] = [];
    let cont: 0 | 1 | 2 = 1;
    let sew = false;
    for (const t of tokens.slice(1)) {
      const e = edgeTok(t);
      const c = contTok(t);
      if (e !== null) edges.push(e);
      else if (c !== null) cont = c;
      else if (SEW.has(fold(t))) sew = true;
      else throw new Error(tr("„{0}“ – {1}", t, SURF_USAGE.fill()));
    }
    if (!edges.length) throw new Error(tr("výplň potřebuje hrany otvoru: {0}", SURF_USAGE.fill()));
    return { op: "feature", feature: extFeature("surf.fill", tr("Výplň N-stran (G0/G1/G2)"), { edges, continuity: `G${cont}`, sew }) };
  }
  // ── přechod ──
  if (BLEND.has(head)) {
    const edges: number[] = [];
    const conts: (1 | 2)[] = [];
    const tension: number[] = [];
    let flip = false;
    let sew = false;
    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];
      const e = edgeTok(t);
      const c = contTok(t);
      if (e !== null) edges.push(e);
      else if (c !== null) {
        if (c === 0) throw new Error(tr("přechod je G1 nebo G2 (G0 = jen dotyk – použijte výplň nebo šablonování)"));
        conts.push(c);
      } else if (TENSION.has(fold(t))) {
        const v = numsAfter(tokens, i, 2);
        if (!v.length || v.some((x) => !(x > 0))) throw new Error(tr("napětí přechodu musí být kladné: {0}", SURF_USAGE.blend()));
        tension.push(...v);
        i += v.length;
      } else if (FLIP.has(fold(t))) flip = true;
      else if (SEW.has(fold(t))) sew = true;
      else throw new Error(tr("„{0}“ – {1}", t, SURF_USAGE.blend()));
    }
    if (edges.length !== 2) throw new Error(tr("přechod potřebuje právě dvě hrany: {0}", SURF_USAGE.blend()));
    const cA = conts[0] ?? 2;
    const cB = conts[1] ?? cA;
    return { op: "feature", feature: extFeature("surf.blend", tr("Přechodová plocha (G1/G2)"), { edges, contA: `G${cA}`, contB: `G${cB}`, tensionA: tension[0] ?? 1, tensionB: tension[1] ?? tension[0] ?? 1, flip, sew }) };
  }
  // ── prodloužení plochy ──
  if (EXTEND1.has(head) || (EXTEND.has(head) && (SURFACE.has(f1) || !f1 || edgeTok(tokens[1]) !== null))) {
    const rest = tokens.slice(EXTEND1.has(head) || !SURFACE.has(f1) ? 1 : 2);
    const edges: number[] = [];
    let len = NaN;
    let cont: 1 | 2 = 2;
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i];
      const e = edgeTok(t);
      const c = contTok(t);
      if (e !== null) edges.push(e);
      else if (c !== null) {
        if (c === 0) throw new Error(tr("prodloužení je G1 (tečně) nebo G2 (křivostně)"));
        cont = c;
      } else if (LENGTH.has(fold(t))) {
        len = numsAfter(rest, i, 1)[0];
        i++;
      } else if (isNum(t)) len = num(t);
      else throw new Error(tr("„{0}“ – {1}", t, SURF_USAGE.extend()));
    }
    if (!edges.length || !(len > 0)) throw new Error(tr("prodloužení potřebuje hrany a kladnou délku: {0}", SURF_USAGE.extend()));
    return { op: "feature", feature: extFeature("surf.extendEdge", tr("Prodloužit přes hranu (G1/G2)"), { edges, length: len, continuity: `G${cont}` }) };
  }
  // ── řídicí body plochy ──
  if (FACE.has(head) && tokens.some((t) => CV.has(fold(t)))) {
    const fm = /^f(\d+)$/i.exec(tokens[1] ?? "");
    if (!fm || Number(fm[1]) < 1) throw new Error(tr("řídicí body: zadejte plochu číslem F…: {0}", SURF_USAGE.cv()));
    const face = Number(fm[1]) - 1;
    if (!CV.has(fold(tokens[2] ?? ""))) throw new Error(tr("řídicí body: {0}", SURF_USAGE.cv()));
    const rest = tokens.slice(3);
    let grid: [number, number] | null = null;
    const moves: { i: number; j: number; d: [number, number, number] }[] = [];
    const rows: { dir: "u" | "v"; index: number; d: [number, number, number] }[] = [];
    let pend: { kind: "pt"; i: number; j: number } | { kind: "row"; dir: "u" | "v"; index: number } | null = null;
    const int = (v: number) => Number.isInteger(v) && v >= 1;
    for (let k = 0; k < rest.length; k++) {
      const t = rest[k];
      const ft = fold(t);
      if (CV.has(ft)) continue; // další „cv“ ve stejném řádku
      if (GRID.has(ft)) {
        const v = numsAfter(rest, k, 2);
        if (v.length !== 2 || !v.every((x) => Number.isInteger(x) && x >= 2 && x <= 40)) throw new Error(tr("síť CV = dva počty 2 až 40: síť 4 4"));
        grid = [v[0], v[1]];
        k += 2;
      } else if (ROW.has(ft)) {
        const dir = fold(rest[k + 1] ?? "");
        const idx = num(rest[k + 2] ?? "");
        if ((dir !== "u" && dir !== "v") || !int(idx)) throw new Error(tr("řada CV: řada u 2 | řada v 3 (čísla řad od 1)"));
        pend = { kind: "row", dir, index: idx };
        k += 2;
      } else if (MOVE.has(ft)) {
        const v = numsAfter(rest, k, 3);
        if (v.length !== 3) throw new Error(tr("posun potřebuje vektor třemi čísly: posun 0 0 1,5"));
        if (!pend) throw new Error(tr("posun čeho? Zadejte bod (2 3) nebo řadu (řada u 2) před slovem posun: {0}", SURF_USAGE.cv()));
        const d: [number, number, number] = [v[0], v[1], v[2]];
        if (pend.kind === "pt") moves.push({ i: pend.i, j: pend.j, d });
        else rows.push({ dir: pend.dir, index: pend.index, d });
        pend = null;
        k += 3;
      } else if (isNum(t) && isNum(rest[k + 1] ?? "")) {
        const i = num(t);
        const j = num(rest[k + 1]);
        if (!int(i) || !int(j)) throw new Error(tr("řídicí bod se zadává dvěma celými čísly od 1 (u v): 2 3"));
        pend = { kind: "pt", i, j };
        k += 1;
      } else throw new Error(tr("„{0}“ – {1}", t, SURF_USAGE.cv()));
    }
    if (pend) throw new Error(tr("chybí posun: {0}", SURF_USAGE.cv()));
    if (!moves.length && !rows.length) return { op: "cmd", cmd: { kind: "cvList", face, grid } };
    return { op: "feature", feature: extFeature("surf.cv", tr("Řídicí body plochy (CV)") + ` F${face + 1}`, { faces: [face], gridU: grid?.[0] ?? 0, gridV: grid?.[1] ?? 0, moves, rows }) };
  }
  // samotné slovo „plocha“ = nápověda k řídicím bodům; „analýza“ jiného druhu → jiné příkazy (null)
  if (FACE.has(head) && tokens.length === 1) throw new Error(tr("plocha: {0}", SURF_USAGE.cv()));
  return null;
}

// ───────────── výsledky jako text (protokol agenta) ─────────────

const fx = (v: number, d = 3) => {
  const s = (Math.round(v * 10 ** d) / 10 ** d).toFixed(d).replace(/\.?0+$/, "");
  return getLang() === "en" ? s : s.replace(".", ",");
};
const CLS_TEXT = (c: SurfQueryResultCont["items"][number]["cls"]) => (c === "gap" ? tr("mezera") : c === "free" ? tr("volná hrana") : c);
type SurfQueryResultCont = Extract<SurfQueryResult, { kind: "continuity" }>;

/** Protokol analýzy návaznosti: řádek na hranu + souhrn tříd. */
export function continuityLines(res: SurfQueryResultCont, shown: boolean): string[] {
  const items = res.items;
  const real = items.filter((c) => c.cls !== "free");
  const count = (k: string) => items.filter((c) => c.cls === k).length;
  const head = tr("✓ návaznost {0} hran: G2 {1} · G1 {2} · G0 {3} · mezera {4} · volné {5}", items.length, count("G2"), count("G1"), count("G0"), count("gap"), count("free"));
  const lines = [head + (shown ? " " + tr("(hrany obarveny v 3D okně: zelená G2, žlutá G1, oranžová G0, červená mezera, fialová volná)") : "")];
  // u velkého modelu jen hrany s problémem (a prvních 40)
  const list = items.length > 40 ? real.filter((c) => c.cls !== "G2").slice(0, 40) : items;
  for (const c of list) {
    if (c.cls === "free") {
      lines.push(tr("  E{0} (F{1}): volná hrana – bez sousední plochy", c.edge + 1, (c.faces[0] ?? -1) + 1));
      continue;
    }
    lines.push(tr("  E{0} (F{1}|F{2}{3}): {4} · mezera {5} mm · úhel {6}° · Δk {7} 1/mm (k {8} / {9})", c.edge + 1, c.faces[0] + 1, c.faces[1] + 1, c.shared ? "" : tr(", nesešité"), CLS_TEXT(c.cls), fx(c.g0, 4), fx(c.g1, 3), fx(c.g2, 5), fx(c.kA, 5), fx(c.kB, 5)));
  }
  if (items.length > list.length) lines.push(tr("  … a dalších {0} hran (vypsány jen hrany s horší než G2 návazností)", items.length - list.length));
  return lines;
}

/** Protokol hřebenů křivosti: křivost min / max a nejmenší poloměr na hraně. */
export function combLines(res: Extract<SurfQueryResult, { kind: "comb" }>, shown: boolean): string[] {
  if (!res.combs.length) return [tr("✓ hřebeny křivosti: žádná zakřivená hrana")];
  const out = [tr("✓ hřebeny křivosti {0} hran{1}", res.combs.length, shown ? " " + tr("(zobrazeny v 3D okně)") : "")];
  for (const c of res.combs.slice(0, 60)) out.push(tr("  E{0}: křivost {1} až {2} 1/mm{3}", c.edge + 1, fx(c.kMin, 5), fx(c.kMax, 5), c.kMax > 1e-9 ? tr(" (nejmenší poloměr {0} mm)", fx(1 / c.kMax, 2)) : tr(" (přímá)")));
  return out;
}

/** Protokol řídicích bodů plochy: rozměr sítě, stupně a souřadnice CV [u v]. */
export function cvLines(res: Extract<SurfQueryResult, { kind: "cv" }>): string[] {
  const i = res.info;
  const out = [tr("✓ F{0}: B-spline {1} × {2} řídicích bodů (stupeň {3} × {4}){5}{6}", res.face + 1, i.nu, i.nv, i.udeg, i.vdeg, i.exact ? "" : tr(" – plocha není B-spline, síť je proložení (přibližně)"), i.uPeriodic || i.vPeriodic ? tr(" – periodická") : "")];
  const total = i.nu * i.nv;
  let n = 0;
  for (let u = 0; u < i.nu && n < 200; u++) {
    const row = i.poles[u].map((p, v) => `[${u + 1} ${v + 1}] (${fx(p[0], 3)}; ${fx(p[1], 3)}; ${fx(p[2], 3)})`);
    n += row.length;
    out.push("  " + row.join("  "));
  }
  if (total > 200) out.push(tr("  … vypsáno prvních 200 z {0} bodů", total));
  out.push(tr("  posun: plocha F{0} cv u v posun dx dy dz · řada: plocha F{0} cv řada u|v k posun dx dy dz", res.face + 1));
  return out;
}
