/**
 * Textové příkazy výkresu pro další pohledy, řezy, uložení a revize (vlna 7) – čistý parser bez jádra (Node testy):
 * - `výkres pohled pomocný <rodič> hrana x1 y1 x2 y2 [podél] [otočit] [umístit x y]` · `… plocha F7` · `… směr dx dy dz` · `výkres pohled pomocný smazat B`
 * - `výkres řez zalomený|natočený <rodič> body x1 y1 x2 y2 … [otočit] [umístit x y]` · `výkres řez smazat B`
 * - `výkres řez částečný <pohled> body x1 y1 x2 y2 x3 y3 … hloubka 12 [křivka]` · `výkres řez částečný smazat [n|vše]`
 * - `výkres přerušení <pohled> x|y od 50 do 250 [mezera 8] [vlnovka|cikcak]` · `výkres přerušení smazat [n|vše]`
 * - `výkres uložení <kóta> H7 [zobrazení odchylky|mezní|značka]` · `výkres uložení tabulka ano|ne` · `výkres uložení zobrazení …`
 *   · `výkres uložení dotaz 40 H7/g6`
 * - `výkres revize značka B na Ø40[, 25]` · `výkres revize značka smazat na Ø40` · `výkres revize B značky ano|ne` · `výkres zóny ano|ne`
 * Body jsou v mm modelu v rovině pohledu (y nahoru) jako u ostatních příkazů výkresu, umístění v mm listu od levého dolního rohu.
 * Česky, anglicky i německy. Provedení: cad/drawing-views-agent.ts.
 */
import { tr } from "./i18n";
import type { FitShow } from "./drawing-fits";
import type { RawTok, ViewRef } from "./agent-drawing";
import type { Vec2, Vec3 } from "./types";

export type ViewsCmd =
  | { op: "aux"; parent?: ViewRef; edge?: [Vec2, Vec2]; mode?: "normal" | "along"; face?: number; dir?: Vec3; flip?: boolean; place?: Vec2 }
  | { op: "aux-del"; label: string }
  | { op: "cut"; kind: "stepped" | "aligned"; parent: ViewRef; pts: Vec2[]; flip?: boolean; place?: Vec2 }
  | { op: "cut-del"; label: string }
  | { op: "bo"; view: ViewRef; pts: Vec2[]; depth: number; spline?: boolean }
  | { op: "bo-del"; which: number | "all" }
  | { op: "break"; view: ViewRef; axis: "x" | "y"; from: number; to: number; gap?: number; style?: "zigzag" | "wave" }
  | { op: "break-del"; which: number | "all" }
  /** pole tolerance ke kótě – provede se jako `výkres tolerance` s kontrolou ISO 286 */
  | { op: "fit-set"; target: string; code: string; show?: FitShow }
  | { op: "fit-show"; show: FitShow }
  | { op: "fit-table"; on: boolean }
  | { op: "fit-query"; size: number; code: string }
  | { op: "rev-mark"; rev: string; targets: string[] }
  | { op: "rev-unmark"; targets: string[] }
  | { op: "rev-marks"; rev: string; on: boolean }
  | { op: "zones"; on: boolean };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const W = (...w: string[]) => new Set(w);
const kw = (t: RawTok | undefined, set: Set<string>) => !!t && !t.q && !t.key && set.has(fold(t.s));
const isNum = (t?: RawTok) => !!t && !t.q && /^[+\-−]?(\d+([.,]\d*)?|[.,]\d+)$/.test(t.s);
const num = (s: string) => Number(s.replace("−", "-").replace(",", "."));

const VIEW_W = W("pohled", "view", "ansicht");
const AUX_W = W("pomocny", "pomocna", "auxiliary", "aux", "hilfsansicht", "hilfs", "hilfsansichten", "naklopeny", "sikmy");
const SECTION_W = W("rez", "section", "schnitt");
const STEP_W = W("zalomeny", "lomeny", "stupnovity", "stepped", "offset", "step", "abgesetzt", "abgesetzter", "versetzt", "versetzter");
const ALIGN_W = W("natoceny", "otoceny", "aligned", "revolved", "rotated", "gedreht", "gedrehter", "ausgerichtet", "ausgerichteter");
const PARTIAL_W = W("castecny", "vylomeny", "partial", "broken-out", "brokenout", "teilschnitt", "ausbruch", "teil");
const BREAK_W = W("preruseni", "break", "breaks", "unterbrechung", "bruch", "zkraceni", "verkurzung");
const FIT_W = W("ulozeni", "fit", "fits", "passung", "passungen", "licovani");
const REV_W = W("revize", "revision", "revisions", "anderung", "aenderung", "revisionen");
const MARK_W = W("znacka", "mark", "marker", "zeichen", "dreieck", "trojuhelnik");
const MARKS_W = W("znacky", "marks", "markers", "trojuhelniky", "dreiecke");
const ZONES_W = W("zony", "zones", "zonen", "zone", "sit", "grid");
const DEL_W = W("smazat", "odstranit", "delete", "remove", "loschen", "loeschen", "entfernen");
const ALL_W = W("vse", "vsechny", "all", "alle");
const EDGE_W = W("hrana", "edge", "kante");
const FACE_W = W("plocha", "face", "flache", "flaeche");
const DIR_W = W("smer", "direction", "dir", "richtung");
const ALONG_W = W("podel", "along", "entlang");
const NORMAL_W = W("kolmo", "normal", "senkrecht");
const FLIP_W = W("otocit", "obratit", "flip", "reverse", "umkehren", "gegenuber", "opacne");
const PLACE_W = W("umistit", "umisteni", "place", "platzieren", "position");
const POINTS_W = W("body", "points", "punkte", "bod", "point");
const DEPTH_W = W("hloubka", "depth", "tiefe");
const SPLINE_W = W("krivka", "spline", "hladka", "kurve", "smooth", "volne", "freihand");
const GAP_W = W("mezera", "gap", "lucke", "luecke", "abstand");
const FROM_W = W("od", "from", "von");
const TO_W = W("do", "to", "bis");
const WAVE_W = W("vlnovka", "wave", "wavy", "welle", "wellenlinie");
const ZIG_W = W("cikcak", "zigzag", "zickzack");
const SHOW_W = W("zobrazeni", "zobrazit", "show", "display", "anzeige", "anzeigen");
const TABLE_W = W("tabulka", "table", "tabelle");
const QUERY_W = W("dotaz", "query", "info", "abfrage", "zjistit");
const ON_W = W("na", "on", "an", "auf");
const YES = W("ano", "yes", "ja", "on", "true", "zapnout", "zap");
const NO = W("ne", "no", "nein", "off", "false", "vypnout", "vyp");
const SHOW_V: Record<string, FitShow> = {
  odchylky: "dev", uchylky: "dev", deviations: "dev", dev: "dev", abmasse: "dev", abmass: "dev",
  mezni: "limits", limits: "limits", limit: "limits", grenzmasse: "limits", grenzmass: "limits", rozmery: "limits",
  znacka: "code", code: "code", kod: "code", symbol: "code", kurzzeichen: "code", jen: "code",
};
const VIEW_WORDS: Record<string, string> = {
  predni: "front", front: "front", vorne: "front", vorderansicht: "front", hlavni: "front",
  zadni: "back", back: "back", hinten: "back", rueckansicht: "back", ruckansicht: "back",
  horni: "top", top: "top", shora: "top", oben: "top", draufsicht: "top",
  spodni: "bottom", bottom: "bottom", zdola: "bottom", unten: "bottom", untersicht: "bottom",
  levy: "left", left: "left", zleva: "left", links: "left",
  pravy: "right", right: "right", zprava: "right", rechts: "right",
};

/** pohled (rodič / pohled částečného řezu): přední…, „řez“ (A–A), „pohled B“ / „B“ (pomocný), „řez B“ */
function viewTok(rt: RawTok[], i: number, what: string): [ViewRef, number] {
  const t = rt[i];
  if (!t) throw new Error(tr("{0}: chybí pohled – přední, horní, levý, pravý, zadní, spodní nebo řez", what));
  let j = i;
  if (kw(t, VIEW_W)) j++;
  const u = rt[j];
  if (!u) throw new Error(tr("{0}: chybí pohled – přední, horní, levý, pravý, zadní, spodní nebo řez", what));
  const f = fold(u.s);
  if (!u.q && VIEW_WORDS[f]) return [VIEW_WORDS[f], j - i + 1];
  if (!u.q && SECTION_W.has(f)) {
    const l = rt[j + 1]?.s ?? "";
    // písmeno řezu (ne osa x / y ani „v“ / „u“ před souřadnicemi)
    const m = /^([a-z])(?:[-–]?([a-z]))?$/i.exec(l);
    if (m && /^[b-tw-wz]$/i.test(m[1]) && !/^[xyuv]$/i.test(l)) return [`cut:${m[1].toUpperCase()}`, j - i + 2];
    if (m && m[1].toUpperCase() === "A") return ["section", j - i + 2];
    return ["section", j - i + 1];
  }
  if (!u.q && AUX_W.has(f) && /^[a-z]$/i.test(rt[j + 1]?.s ?? "")) return [`aux:${rt[j + 1].s.toUpperCase()}`, j - i + 2];
  if (!u.q && /^[a-z]$/i.test(u.s) && j > i) return [`aux:${u.s.toUpperCase()}`, j - i + 1];
  throw new Error(tr("{0}: neznámý pohled „{1}“ – přední, horní, levý, pravý, zadní, spodní, řez, pohled B", what, u.s));
}

/** čísla od indexu (dokud jsou čísla) */
function nums(rt: RawTok[], i: number): number[] {
  const out: number[] = [];
  while (isNum(rt[i])) out.push(num(rt[i++].s));
  return out;
}
const pairs = (n: number[]): Vec2[] => {
  const out: Vec2[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
  return out;
};
const letter = (t: RawTok | undefined, usage: string) => {
  if (!t || !/^[a-z]$/i.test(t.s)) throw new Error(usage);
  return t.s.toUpperCase();
};
const which = (t: RawTok | undefined): number | "all" => (!t || kw(t, ALL_W) ? "all" : isNum(t) && Number.isInteger(num(t.s)) && num(t.s) > 0 ? num(t.s) : (() => { throw new Error(tr("smazat: číslo (od 1) nebo vše")); })());

/**
 * Příkaz výkresu z tokenů za slovem „výkres“ (zachované uvozovky a klíč=hodnota) → povel; null = jiný podpříkaz výkresu.
 */
export function parseDrawingViews(rt: RawTok[]): ViewsCmd | null {
  const h = rt[0];
  if (!h || h.q || h.key) return null;
  const f = fold(h.s);
  // výkres pohled pomocný … (výkres pohledy přední,horní = volba pohledů – zůstává)
  if (VIEW_W.has(f) && kw(rt[1], AUX_W)) return parseAux(rt.slice(2));
  if (AUX_W.has(f)) return parseAux(rt.slice(1));
  if (SECTION_W.has(f)) {
    if (kw(rt[1], STEP_W)) return parseCut("stepped", rt.slice(2));
    if (kw(rt[1], ALIGN_W)) return parseCut("aligned", rt.slice(2));
    if (kw(rt[1], PARTIAL_W)) return parseBrokenOut(rt.slice(2));
    if (kw(rt[1], DEL_W)) return { op: "cut-del", label: letter(rt[2], tr("výkres řez smazat <písmeno> – řez lomenou čarou (B, C…); řez A–A vypne: výkres řez ne")) };
    return null;
  }
  if (PARTIAL_W.has(f)) return parseBrokenOut(rt.slice(1));
  if (BREAK_W.has(f)) return parseBreak(rt.slice(1));
  if (FIT_W.has(f)) return parseFit(rt.slice(1));
  if (REV_W.has(f)) {
    if (kw(rt[1], MARK_W)) return parseRevMark(rt.slice(2));
    if (rt[1] && kw(rt[2], MARKS_W)) {
      const v = fold(rt[3]?.s ?? "");
      if (!YES.has(v) && !NO.has(v)) throw new Error(tr("výkres revize <písmeno> značky ano|ne"));
      return { op: "rev-marks", rev: letter(rt[1], tr("výkres revize <písmeno> značky ano|ne")), on: YES.has(v) };
    }
    return null;
  }
  if (ZONES_W.has(f)) {
    const v = fold(rt[1]?.s ?? "ano");
    if (!YES.has(v) && !NO.has(v)) throw new Error(tr("výkres zóny ano|ne"));
    return { op: "zones", on: YES.has(v) };
  }
  return null;
}

function parseAux(rt: RawTok[]): ViewsCmd {
  const usage = tr("výkres pohled pomocný <rodič> hrana x1 y1 x2 y2 [podél] [otočit] [umístit x y] · výkres pohled pomocný [<rodič>] plocha F7 · výkres pohled pomocný [<rodič>] směr dx dy dz · výkres pohled pomocný smazat B");
  if (!rt.length) throw new Error(usage);
  if (kw(rt[0], DEL_W)) return { op: "aux-del", label: letter(rt[1], usage) };
  const cmd: Extract<ViewsCmd, { op: "aux" }> = { op: "aux" };
  for (let i = 0; i < rt.length; ) {
    const t = rt[i];
    if (kw(t, EDGE_W)) {
      const n = nums(rt, i + 1);
      if (n.length < 4) throw new Error(tr("pomocný pohled: hrana = dva body x1 y1 x2 y2 (mm modelu v rovině rodičovského pohledu)"));
      cmd.edge = [[n[0], n[1]], [n[2], n[3]]];
      i += 5;
    } else if (kw(t, FACE_W) || (!t.q && /^F\d+$/i.test(t.s))) {
      const s = kw(t, FACE_W) ? rt[i + 1]?.s ?? "" : t.s;
      const m = /^F?(\d+)$/i.exec(s);
      if (!m || Number(m[1]) < 1) throw new Error(tr("pomocný pohled: plocha jako F7 (číslo plochy z příkazu měřit / výběru)"));
      cmd.face = Number(m[1]);
      i += kw(t, FACE_W) ? 2 : 1;
    } else if (kw(t, DIR_W)) {
      const n = nums(rt, i + 1);
      if (n.length < 3 || Math.hypot(n[0], n[1], n[2]) < 1e-9) throw new Error(tr("pomocný pohled: směr = tři čísla dx dy dz (k pozorovateli, souřadnice modelu)"));
      cmd.dir = [n[0], n[1], n[2]];
      i += 4;
    } else if (kw(t, ALONG_W)) {
      cmd.mode = "along";
      i++;
    } else if (kw(t, NORMAL_W)) {
      cmd.mode = "normal";
      i++;
    } else if (kw(t, FLIP_W)) {
      cmd.flip = true;
      i++;
    } else if (kw(t, PLACE_W)) {
      const n = nums(rt, i + 1);
      if (n.length < 2) throw new Error(tr("umístit x y (mm listu od levého dolního rohu)"));
      cmd.place = [n[0], n[1]];
      i += 3;
    } else if (!cmd.parent) {
      const [v, k] = viewTok(rt, i, tr("pomocný pohled"));
      cmd.parent = v;
      i += k;
    } else throw new Error(tr("pomocný pohled: nečekané „{0}“ – {1}", t.s, usage));
  }
  if (!cmd.edge && cmd.face == null && !cmd.dir) throw new Error(tr("pomocný pohled: zadejte hranu, plochu nebo směr – {0}", usage));
  if (cmd.edge && !cmd.parent) throw new Error(tr("pomocný pohled: u hrany zadejte rodičovský pohled (přední, horní…)"));
  return cmd;
}

function parseCut(kind: "stepped" | "aligned", rt: RawTok[]): ViewsCmd {
  const usage = kind === "stepped" ? tr("výkres řez zalomený <rodič> body x1 y1 x2 y2 x3 y3 … [otočit] [umístit x y]") : tr("výkres řez natočený <rodič> body x1 y1 xv yv x2 y2 (konec hlavního ramena, vrchol, konec natočeného ramena) [otočit] [umístit x y]");
  if (!rt.length) throw new Error(usage);
  const [parent, k] = viewTok(rt, 0, tr("řez"));
  let pts: Vec2[] = [];
  let flip = false;
  let place: Vec2 | undefined;
  for (let i = k; i < rt.length; ) {
    const t = rt[i];
    if (kw(t, POINTS_W) || isNum(t)) {
      const n = nums(rt, kw(t, POINTS_W) ? i + 1 : i);
      if (n.length % 2) throw new Error(tr("řez: body jsou dvojice čísel x y"));
      pts = pairs(n);
      i += (kw(t, POINTS_W) ? 1 : 0) + n.length;
    } else if (kw(t, FLIP_W)) {
      flip = true;
      i++;
    } else if (kw(t, PLACE_W)) {
      const n = nums(rt, i + 1);
      if (n.length < 2) throw new Error(tr("umístit x y (mm listu od levého dolního rohu)"));
      place = [n[0], n[1]];
      i += 3;
    } else throw new Error(tr("řez: nečekané „{0}“ – {1}", t.s, usage));
  }
  if (kind === "aligned" ? pts.length !== 3 : pts.length < 2) throw new Error(usage);
  return { op: "cut", kind, parent, pts, ...(flip ? { flip } : {}), ...(place ? { place } : {}) };
}

function parseBrokenOut(rt: RawTok[]): ViewsCmd {
  const usage = tr("výkres řez částečný <pohled> body x1 y1 x2 y2 x3 y3 … hloubka 12 [křivka] · výkres řez částečný smazat [číslo|vše]");
  if (!rt.length) throw new Error(usage);
  if (kw(rt[0], DEL_W)) return { op: "bo-del", which: which(rt[1]) };
  const [view, k] = viewTok(rt, 0, tr("částečný řez"));
  let pts: Vec2[] = [];
  let depth: number | undefined;
  let spline = false;
  for (let i = k; i < rt.length; ) {
    const t = rt[i];
    if (kw(t, POINTS_W) || isNum(t)) {
      const n = nums(rt, kw(t, POINTS_W) ? i + 1 : i);
      if (n.length % 2) throw new Error(tr("částečný řez: body jsou dvojice čísel x y"));
      pts = pairs(n);
      i += (kw(t, POINTS_W) ? 1 : 0) + n.length;
    } else if (kw(t, DEPTH_W) && isNum(rt[i + 1])) {
      depth = num(rt[i + 1].s);
      i += 2;
    } else if (kw(t, SPLINE_W)) {
      spline = true;
      i++;
    } else throw new Error(tr("částečný řez: nečekané „{0}“ – {1}", t.s, usage));
  }
  if (pts.length < 3) throw new Error(tr("částečný řez: oblast potřebuje alespoň 3 body – {0}", usage));
  if (!(depth !== undefined && depth > 0)) throw new Error(tr("částečný řez: zadejte hloubku od přední strany – hloubka 12 (mm)"));
  return { op: "bo", view, pts, depth, ...(spline ? { spline } : {}) };
}

function parseBreak(rt: RawTok[]): ViewsCmd {
  const usage = tr("výkres přerušení <pohled> x|y od 50 do 250 [mezera 8] [vlnovka|cikcak] · výkres přerušení smazat [číslo|vše]");
  if (!rt.length) throw new Error(usage);
  if (kw(rt[0], DEL_W)) return { op: "break-del", which: which(rt[1]) };
  const [view, k] = viewTok(rt, 0, tr("přerušení"));
  let axis: "x" | "y" | undefined;
  const vals: number[] = [];
  let gap: number | undefined;
  let style: "zigzag" | "wave" | undefined;
  for (let i = k; i < rt.length; i++) {
    const t = rt[i];
    const f = fold(t.s);
    if (!t.q && (f === "x" || f === "y") && !axis) axis = f;
    else if (kw(t, GAP_W) && isNum(rt[i + 1])) gap = num(rt[++i].s);
    else if (kw(t, WAVE_W)) style = "wave";
    else if (kw(t, ZIG_W)) style = "zigzag";
    else if (kw(t, FROM_W) || kw(t, TO_W)) continue;
    else if (isNum(t)) vals.push(num(t.s));
    else throw new Error(tr("přerušení: nečekané „{0}“ – {1}", t.s, usage));
  }
  if (!axis) throw new Error(tr("přerušení: osa pohledu x (vodorovně) nebo y (svisle) – {0}", usage));
  if (vals.length !== 2 || Math.abs(vals[1] - vals[0]) < 1e-6) throw new Error(tr("přerušení: zadejte odkud a kam – od 50 do 250 (mm modelu podél osy pohledu)"));
  if (gap !== undefined && !(gap > 0)) throw new Error(tr("přerušení: mezera musí být kladná (mm listu)"));
  return { op: "break", view, axis, from: Math.min(vals[0], vals[1]), to: Math.max(vals[0], vals[1]), ...(gap !== undefined ? { gap } : {}), ...(style ? { style } : {}) };
}

/** `výkres uložení …` */
function parseFit(rt: RawTok[]): ViewsCmd {
  const usage = tr("výkres uložení <kóta> H7 [zobrazení odchylky|mezní|značka] · výkres uložení tabulka ano|ne · výkres uložení zobrazení odchylky|mezní|značka · výkres uložení dotaz 40 H7/g6");
  if (!rt.length) throw new Error(usage);
  if (kw(rt[0], TABLE_W)) {
    const v = fold(rt[1]?.s ?? "ano");
    if (!YES.has(v) && !NO.has(v)) throw new Error(usage);
    return { op: "fit-table", on: YES.has(v) };
  }
  const showAt = rt.findIndex((t) => kw(t, SHOW_W));
  let show: FitShow | undefined;
  if (showAt >= 0) {
    show = SHOW_V[fold(rt[showAt + 1]?.s ?? "")];
    if (!show) throw new Error(tr("zobrazení uložení: odchylky, mezní (rozměry) nebo značka"));
    if (showAt === 0) return { op: "fit-show", show };
    rt = [...rt.slice(0, showAt), ...rt.slice(showAt + 2)];
  }
  if (kw(rt[0], QUERY_W)) {
    const t = rt.slice(1).map((x) => x.s);
    const size = num((t[0] ?? "").replace(/^[Ø⌀]/, ""));
    const code = t.slice(1).join("");
    if (!(size > 0) || !code) throw new Error(tr("výkres uložení dotaz <rozměr> <pole> – např. dotaz 40 H7/g6"));
    return { op: "fit-query", size, code };
  }
  if (rt.length < 2) throw new Error(usage);
  const code = rt[rt.length - 1].s;
  const target = rt.slice(0, -1).map((x) => x.s).join(" ");
  return { op: "fit-set", target, code, ...(show ? { show } : {}) };
}

function parseRevMark(rt: RawTok[]): ViewsCmd {
  const usage = tr("výkres revize značka <písmeno> na <kóta>[, <kóta>…] · výkres revize značka smazat na <kóta>");
  const del = kw(rt[0], DEL_W);
  const on = rt.findIndex((t) => kw(t, ON_W));
  if (on < 0) throw new Error(usage);
  const targets = rt
    .slice(on + 1)
    .map((t) => t.s)
    .join(" ")
    .split(/\s*[,;]\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!targets.length) throw new Error(usage);
  if (del) return { op: "rev-unmark", targets };
  const rev = rt[0]?.s ?? "";
  if (!/^[\p{L}\d]{1,4}$/u.test(rev) || on !== 1) throw new Error(usage);
  return { op: "rev-mark", rev: rev.toUpperCase(), targets };
}
