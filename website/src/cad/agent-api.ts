/**
 * Automatizační rozhraní pro AI agenty – čistá část bez prohlížeče (testovatelná v Node):
 *
 *   řez X 25 [obráceně] · řez vyp                          řez modelem (jako Nástroje ▸ Řez)
 *   zobraz drátový | stínovaný | hrany | skryté | průhledný | přizpůsobit   styl 3D okna
 *   barva plochy F3 [F5 …] | <pravidlo> #hex | výchozí       barva ploch (Přímé úpravy ▸ Barva plochy)
 *   akce <id | popisek>                                       akce rozšíření bez prvku (Rozvin → DXF, Tabulka ohybů…)
 *   analýza úkosů | tloušťky | křivosti | zebra | vyp         formařské analýzy jako text (+ barevná mapa „zobrazit“)
 *   dělicí rovina [směr +Z]                                   návrh dělicí roviny
 *   vyhazovače [Ø 6] [rozteč 60] [směr +Z] [díry | sestava]   návrh vyhazovačů
 *   chlazení Ø8 hloubka 15 větve 4 přesah 10 [díl | sestava]  chladicí okruh
 *   smrštění 0,5 | ABS                                        měřítko dutiny formy
 *
 * Dále: textové výsledky analýz (úkosy, tloušťka, křivost, dělicí rovina, vyhazovače, chlazení), kontrola nastavení
 * pro `window.mncad.setSettings`, rozbor id výběru (`F3`, `comp:Čep`, `feature:Díra 1`), volby snímku a zachytávací
 * API akcí rozšíření (text okna → protokol, stažené soubory → base64). Provedení se stavem aplikace je
 * v components/cad/agent-api-host.ts.
 */
import { getLang, tr } from "./i18n";
import { MATERIALS } from "@/lib/mesh-metrics";
import { allExt } from "./ext/registry";
import { SHRINKAGE, isPlusZ, moldFrame, suggestPartingZ, type CoolingParams, type DraftResult, type EjectorSuggestion } from "./mold";
import type { SectionState } from "./section-plane";
import type { Settings } from "./settings";
import type { CadDoc, MeshData, Vec3 } from "./types";

/* ───────────────────────── příkazy ───────────────────────── */
export type DisplayStyle = "shadedEdges" | "shaded" | "wireframe" | "hiddenLine" | "xray";
export type ApiCmd =
  /** řez modelem kolmo na osu; `offset` null = střed modelu */
  | { kind: "section"; axis: "X" | "Y" | "Z"; offset: number | null; flip: boolean }
  | { kind: "sectionOff" }
  | { kind: "display"; mode: DisplayStyle }
  | { kind: "fit" }
  /** barva ploch: čísla (0…) nebo pravidlo jako u skořepiny; `color` null = výchozí barva tělesa */
  | { kind: "faceColor"; faces: number[]; rule: string[]; color: string | null }
  /** akce rozšíření (id z registru) nebo „sketch.dxf“ (export skici); prázdné id = seznam akcí */
  | { kind: "action"; id: string }
  | { kind: "analyze"; what: "draft"; dir: Vec3; min: number; show: boolean }
  | { kind: "analyze"; what: "thickness"; limit: number; show: boolean }
  | { kind: "analyze"; what: "curvature"; show: boolean }
  | { kind: "analyze"; what: "zebra" }
  | { kind: "analyze"; what: "off" }
  | { kind: "parting"; dir: Vec3 }
  | { kind: "ejectors"; d?: number; spacing?: number; dir: Vec3; mode: "list" | "holes" | "assembly" }
  | { kind: "cooling"; d?: number; depth?: number; rows?: number; overhang?: number; dir: Vec3; mode: "list" | "part" | "assembly" }
  | { kind: "shrinkage"; pct: number; label?: string };
/** operace programu textových příkazů (agent.ts) – provede ji aplikace (agent-api-host.ts) */
export type ApiOp = { k: "api"; cmd: ApiCmd; line: number };

/* ───────────────────────── pomocné ───────────────────────── */
export const foldWord = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
/** slovo bez diakritiky a bez nepísmenných znaků („Rozvin → DXF“ → „rozvindxf“) */
const key = (s: string) => foldWord(s).replace(/[^a-z0-9]/g, "");
const DIAM = /^[øØ⌀]/;
const isNum = (t: string) => /^[+-]?(\d+[.,]?\d*|[.,]\d+)(mm|%|°)?$/i.test(t.replace(DIAM, ""));
const num = (t: string) => {
  const m = /^([+-]?)(\d+[.,]?\d*|[.,]\d+)/.exec(t.replace(DIAM, ""));
  return m ? (m[1] === "-" ? -1 : 1) * parseFloat(m[2].replace(",", ".")) : NaN;
};
const set = (...w: string[]) => new Set(w.map(foldWord));
const AXES: Record<string, Vec3> = { "+x": [1, 0, 0], "-x": [-1, 0, 0], "+y": [0, 1, 0], "-y": [0, -1, 0], "+z": [0, 0, 1], "-z": [0, 0, -1], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const DIR_WORDS = set("směr", "smer", "direction", "dir", "richtung", "vyhození", "vyhozeni", "pull");
const OFF_WORDS = set("vyp", "vypnout", "vypnuto", "off", "none", "zrušit", "zrusit", "ne", "no", "aus", "ausschalten", "nein", "konec");
const SHOW_WORDS = set("zobrazit", "zobraz", "mapa", "show", "display", "map", "anzeigen", "zeigen", "karte");
/** číslo na nejvýš `d` desetinných míst bez koncových nul, desetinná čárka (anglicky tečka) */
const fmtN = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "").replace(/^-0$/, "0").replace(".", getLang() === "en" ? "." : ",") : "–");
/** číslo s pevným počtem desetinných míst (procenta) */
const fix = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d).replace(".", getLang() === "en" ? "." : ",") : "–");
const vecText = (v: Vec3) => `[${v.map((x) => fmtN(x, 2)).join("; ")}]`;
/** směr slovem (+Z, -X) nebo vektorem */
export function dirText(d: Vec3): string {
  for (const [k, v] of Object.entries(AXES)) if (k.length === 2 && v.every((c, i) => Math.abs(c - d[i]) < 1e-9)) return k.toUpperCase();
  return vecText(d);
}

/** Přečte směr na pozici `i` (slovo +Z / -X / x, nebo tři čísla); vrací směr a počet spotřebovaných slov. */
function readDir(toks: string[], i: number): { dir: Vec3; used: number } | null {
  const t = foldWord(toks[i] ?? "");
  if (AXES[t]) return { dir: AXES[t], used: 1 };
  if ([0, 1, 2].every((k) => isNum(toks[i + k] ?? ""))) {
    const v: Vec3 = [num(toks[i]), num(toks[i + 1]), num(toks[i + 2])];
    if (!(Math.hypot(...v) > 1e-12)) throw new Error(tr("směr nesmí být nulový vektor"));
    return { dir: v, used: 3 };
  }
  return null;
}

/**
 * Obecný rozbor voleb příkazu: čísla za klíčovými slovy (`nums`), příznaky (`flags`), průměr (Ø8, Ø 8, d8, d 8),
 * směr (směr +Z / směr 0 0 1 / samotné +Z), volná čísla (`free`). Neznámé slovo = chyba s nápovědou `usage`.
 */
type Scan = { nums: Record<string, number>; flags: Set<string>; free: number[]; dir?: Vec3; diameter?: number };
function scan(toks: string[], numKeys: Record<string, string>, flagKeys: Record<string, string>, usage: string, cmd: string): Scan {
  const s: Scan = { nums: {}, flags: new Set(), free: [] };
  for (let i = 0; i < toks.length; i++) {
    const raw = toks[i];
    const f = foldWord(raw);
    if (!f) continue;
    // průměr: Ø8 / ø 8 / ⌀8 / d8 / d 8 / průměr 8
    if (DIAM.test(raw) || /^d\d/.test(f) || ["d", "prumer", "diameter", "durchmesser", "dm"].includes(f)) {
      const rest = DIAM.test(raw) ? raw.replace(DIAM, "") : /^d\d/.test(f) ? raw.slice(1) : "";
      if (rest && isNum(rest)) s.diameter = num(rest);
      else if (isNum(toks[i + 1] ?? "")) s.diameter = num(toks[++i]);
      else throw new Error(tr("{0}: za průměrem chybí číslo – {1}", cmd, usage));
      continue;
    }
    if (DIR_WORDS.has(f)) {
      const d = readDir(toks, i + 1);
      if (!d) throw new Error(tr("{0}: směr se píše +X, -X, +Y, -Y, +Z, -Z nebo třemi čísly (směr 0 0 1) – {1}", cmd, usage));
      s.dir = d.dir;
      i += d.used;
      continue;
    }
    if (AXES[f] && /^[+-]/.test(f)) {
      s.dir = AXES[f];
      continue;
    }
    if (numKeys[f]) {
      if (!isNum(toks[i + 1] ?? "")) throw new Error(tr("{0}: za „{1}“ chybí číslo – {2}", cmd, raw, usage));
      s.nums[numKeys[f]] = num(toks[++i]);
      continue;
    }
    if (flagKeys[f]) {
      s.flags.add(flagKeys[f]);
      continue;
    }
    if (isNum(raw)) {
      s.free.push(num(raw));
      continue;
    }
    throw new Error(tr("{0}: neznámé slovo „{1}“ – {2}", cmd, raw, usage));
  }
  return s;
}
const keys = (target: string, ...words: string[]) => Object.fromEntries(words.map((w) => [foldWord(w), target]));

/* ───────────────────────── slovníky příkazů ───────────────────────── */
const SECTION_HEADS = set("řez", "rez", "section", "schnitt", "průřez", "prurez");
const VIEW_HEADS = set("zobraz", "zobrazit", "pohled", "view", "ansicht", "anzeigen", "zeige", "styl", "style", "darstellung");
/** pohledy, které obsluhuje stávající příkaz „zobraz iso|přední…“ (agent.ts) */
const VIEW_NAMES = set("iso", "izo", "izometrie", "front", "predni", "zadni", "back", "top", "horni", "shora", "bottom", "spodni", "left", "levy", "zleva", "right", "pravy", "zprava", "isometrisch", "vorne", "vorder", "hinten", "oben", "unten", "links", "rechts");
const STYLE_WORDS: [Set<string>, DisplayStyle | "fit"][] = [
  [set("skryté", "skryte", "skrytých", "hidden", "hiddenline", "verdeckt", "verdeckte", "verdeckten"), "hiddenLine"],
  [set("drátový", "dratovy", "drátově", "dratove", "drát", "drat", "wireframe", "wire", "drahtmodell", "draht", "drahtgitter"), "wireframe"],
  [set("průhledný", "pruhledny", "průhledně", "pruhledne", "xray", "x-ray", "transparent", "rentgen", "röntgen", "rontgen", "durchsichtig"), "xray"],
  [set("hrany", "hranami", "edges", "shadededges", "kanten"), "shadedEdges"],
  [set("stínovaný", "stinovany", "stínovaně", "stinovane", "shaded", "shade", "schattiert", "schattierung"), "shaded"],
  [set("přizpůsobit", "prizpusobit", "přizpůsob", "prizpusob", "fit", "zoomfit", "einpassen", "anpassen"), "fit"],
];
const STYLE_FILLER = set("s", "a", "with", "and", "mit", "und", "styl", "style");
const COLOR_HEADS = set("barva", "barvu", "color", "colour", "farbe");
const FACE_WORDS = set("plocha", "plochy", "ploše", "plochu", "face", "faces", "fläche", "flächen", "flaeche", "flaechen");
const DEFAULT_COLOR = set("výchozí", "vychozi", "default", "standard", "žádná", "zadna", "none", "reset", "původní", "puvodni", "original", "zurücksetzen");
const NAMED_COLORS: Record<string, string> = Object.fromEntries(
  (
    [
      ["#e03930", "červená", "cervena", "red", "rot"],
      ["#4f81bd", "modrá", "modra", "blue", "blau"],
      ["#e0b24a", "žlutá", "zluta", "yellow", "gelb"],
      ["#2f9e44", "zelená", "zelena", "green", "grün", "gruen"],
      ["#3a3f45", "černá", "cerna", "black", "schwarz"],
      ["#ffffff", "bílá", "bila", "white", "weiß", "weiss"],
      ["#9aa3ad", "šedá", "seda", "grey", "gray", "grau"],
      ["#f08c00", "oranžová", "oranzova", "orange"],
      ["#b9c2cc", "ocel", "steel", "stahl"],
      ["#c9a46a", "mosaz", "brass", "messing"],
    ] as const
  ).flatMap(([hex, ...names]) => names.map((n) => [foldWord(n), hex] as const)),
);
const ACTION_HEADS = set("akce", "action", "aktion");
const ANALYZE_HEADS = set("analýza", "analyza", "analyzovat", "analyze", "analyse", "analysis", "analysieren");
const ANALYZE_WHAT: [Set<string>, "draft" | "thickness" | "curvature" | "zebra" | "off"][] = [
  [set("úkosů", "ukosu", "úkosy", "ukosy", "úkos", "ukos", "draft", "drafts", "formschräge", "formschraege", "formschrage", "schräge", "schrage", "entformung", "entformungsschräge"), "draft"],
  [set("tloušťky", "tloustky", "tloušťka", "tloustka", "stěn", "sten", "stěny", "steny", "thickness", "wall", "walls", "wallthickness", "wandstärke", "wandstaerke", "wandstarke", "wanddicke", "dicke", "stärke"), "thickness"],
  [set("křivosti", "krivosti", "křivost", "krivost", "curvature", "krümmung", "kruemmung", "krummung"), "curvature"],
  [set("zebra", "zebry", "zebrapruhy", "stripes", "streifen"), "zebra"],
];
const PARTING_A = set("dělicí", "delici", "dělící", "delici", "parting", "trenn");
const PARTING_B = set("rovina", "rovinu", "roviny", "plane", "line", "ebene");
const PARTING_ONE = set("trennebene", "teilungsebene", "partingplane", "delicirovina");
const EJECTOR_HEADS = set("vyhazovače", "vyhazovace", "vyhazovač", "vyhazovac", "ejectors", "ejector", "ejectorpins", "auswerfer", "auswerferstifte");
const COOLING_HEADS = set("chlazení", "chlazeni", "chladicí", "chladici", "cooling", "kühlung", "kuehlung", "kuhlung", "kühlkanäle");
const SHRINK_HEADS = set("smrštění", "smrsteni", "smrštit", "smrstit", "shrinkage", "shrink", "schwindung", "schwund", "schrumpfung");

const usage = {
  section: () => tr("řez X|Y|Z [poloha] [obráceně] · řez vyp"),
  display: () => tr("zobraz iso|přední|zadní|horní|spodní|levý|pravý · zobraz stínovaný|hrany|drátový|skryté|průhledný · zobraz přizpůsobit"),
  color: () => tr("barva plochy F3 [F5 …] | <pravidlo: horní, +X, válcové…> #rrggbb | červená | výchozí"),
  analyze: () => tr("analýza úkosů [směr +Z|vx vy vz] [min 1] [zobrazit] · analýza tloušťky [limit 2] [zobrazit] · analýza křivosti [zobrazit] · analýza zebra · analýza vyp"),
  parting: () => tr("dělicí rovina [směr +Z]"),
  ejectors: () => tr("vyhazovače [Ø 6] [rozteč 60] [směr +Z] [díry|sestava]"),
  cooling: () => tr("chlazení [Ø8] [hloubka 15] [větve 4] [přesah 10] [směr +Z] [díl|sestava]"),
  shrink: () => tr("smrštění 0,5 (%) · smrštění ABS|PP|PA6…"),
};

/** akce rozšíření (tlačítka bez prvku v historii) + export skici do DXF */
export type ApiAction = { id: string; label: string };
const ACTION_ALIASES: Record<string, string> = {
  rozvindxf: "sheet.dxf", dxfrozvin: "sheet.dxf", rozvin: "sheet.dxf", unfolddxf: "sheet.dxf", flatdxf: "sheet.dxf", flatpatterndxf: "sheet.dxf", abwicklungdxf: "sheet.dxf", abwicklung: "sheet.dxf",
  rozvinsvg: "sheet.svg", svgrozvin: "sheet.svg", unfoldsvg: "sheet.svg", flatsvg: "sheet.svg", flatpatternsvg: "sheet.svg", abwicklungsvg: "sheet.svg",
  tabulkaohybu: "sheet.table", ohyby: "sheet.table", bendtable: "sheet.table", bends: "sheet.table", biegetabelle: "sheet.table", biegungen: "sheet.table",
  kusovnikrezu: "weld.cutList", rezy: "weld.cutList", cutlist: "weld.cutList", zuschnittliste: "weld.cutList", schnittliste: "weld.cutList", sageliste: "weld.cutList",
  tabulkasvaru: "weld.weldTable", svary: "weld.weldTable", weldtable: "weld.weldTable", welds: "weld.weldTable", schweissnahttabelle: "weld.weldTable", nahttabelle: "weld.weldTable", schweissnahte: "weld.weldTable",
  tloustkasten: "adv.wallThickness", tloustka: "adv.wallThickness", wallthickness: "adv.wallThickness", thickness: "adv.wallThickness", wandstarke: "adv.wallThickness", wanddicke: "adv.wallThickness",
  skicadxf: "sketch.dxf", exportskicidxf: "sketch.dxf", exportsketchtodxf: "sketch.dxf", skizzealsdxfexportieren: "sketch.dxf", schweisstabelle: "weld.weldTable", exportskici: "sketch.dxf", dxfskici: "sketch.dxf", sketchdxf: "sketch.dxf", exportsketch: "sketch.dxf", exportsketchdxf: "sketch.dxf", skizzedxf: "sketch.dxf", skizzeexportieren: "sketch.dxf", skizzenexport: "sketch.dxf",
};
/** Všechny akce, které jde spustit příkazem `akce` / `window.mncad.action()`. */
export function apiActions(): ApiAction[] {
  return [...allExt().filter((d) => d.action).map((d) => ({ id: d.ext, label: d.label })), { id: "sketch.dxf", label: tr("Export skici DXF") }];
}
/** Najde akci podle id, popisku nebo zkratky (rozvin dxf, tabulka ohybů, kusovník řezů, tloušťka stěn, skica dxf). */
export function resolveAction(query: string): ApiAction {
  const q = key(query);
  const list = apiActions();
  const hit = list.find((a) => key(a.id) === q || key(a.label) === q) ?? list.find((a) => a.id === ACTION_ALIASES[q]);
  if (hit) return hit;
  const ext = allExt().find((d) => key(d.ext) === q || key(d.label) === q);
  if (ext && !ext.action) throw new Error(tr("„{0}“ není akce, ale prvek – přidejte ho příkazem: prvek {1} klíč=hodnota …", ext.label, ext.ext));
  throw new Error(tr("neznámá akce „{0}“ – akce: {1}", query, list.map((a) => `${a.id} (${a.label})`).join(", ")));
}

/**
 * Rozbor řádku textového příkazu (všechna slova včetně prvního). Vrací null, když řádek není příkazem tohoto modulu
 * (pak ho zpracuje agent.ts); chybný zápis známého příkazu vyhodí chybu se zápisem.
 */
export function parseApiCommand(tokens: string[]): ApiCmd | null {
  const head = foldWord(tokens[0] ?? "");
  const rest = tokens.slice(1);
  const f1 = foldWord(rest[0] ?? "");
  if (!head) return null;

  // ── řez ──
  if (SECTION_HEADS.has(head)) {
    if (OFF_WORDS.has(f1)) {
      if (rest.length > 1) throw new Error(tr("řez vyp nemá další volby – {0}", usage.section()));
      return { kind: "sectionOff" };
    }
    let axis: "X" | "Y" | "Z" | null = null;
    let offset: number | null = null;
    let flip = false;
    for (let i = 0; i < rest.length; i++) {
      const w = foldWord(rest[i]);
      if (["osa", "axis", "achse"].includes(w)) continue;
      if (/^[xyz]$/.test(w)) axis = w.toUpperCase() as "X" | "Y" | "Z";
      else if (/^(xy|yx)$/.test(w)) axis = "Z";
      else if (/^(xz|zx)$/.test(w)) axis = "Y";
      else if (/^(yz|zy)$/.test(w)) axis = "X";
      else if (["obracene", "otocit", "otocene", "opacne", "flip", "flipped", "reverse", "reversed", "umkehren", "umgekehrt", "gegenseite"].includes(w)) flip = true;
      else if (isNum(rest[i])) {
        if (offset !== null) throw new Error(tr("řez má jednu polohu – {0}", usage.section()));
        offset = num(rest[i]);
      } else if (["v", "at", "bei", "poloha", "position", "offset", "versatz", "odsazeni", "na"].includes(w)) continue;
      else throw new Error(tr("řez: neznámé slovo „{0}“ – {1}", rest[i], usage.section()));
    }
    if (!axis && offset !== null) throw new Error(tr("řez potřebuje osu, na kterou je rovina kolmá: {0}", usage.section()));
    return { kind: "section", axis: axis ?? "Z", offset, flip };
  }

  // ── styl zobrazení (zobraz drátový…); pohledy iso / přední… zůstávají stávajícímu příkazu ──
  if (VIEW_HEADS.has(head)) {
    if (!rest.length || VIEW_NAMES.has(f1)) return null;
    const words = rest.map(foldWord).filter((w) => !STYLE_FILLER.has(w));
    let mode: DisplayStyle | "fit" | null = null;
    for (const [ws, m] of STYLE_WORDS) if (words.some((w) => ws.has(w))) {
      mode = m;
      break;
    }
    if (!mode) throw new Error(tr("zobraz: neznámý pohled ani styl „{0}“ – {1}", rest.join(" "), usage.display()));
    const known = new Set(STYLE_WORDS.flatMap(([ws]) => [...ws]));
    const extra = words.find((w) => !known.has(w));
    if (extra) throw new Error(tr("zobraz: neznámé slovo „{0}“ – {1}", extra, usage.display()));
    return mode === "fit" ? { kind: "fit" } : { kind: "display", mode };
  }

  // ── barva plochy ──
  if (COLOR_HEADS.has(head) && FACE_WORDS.has(f1)) {
    const faces: number[] = [];
    const rule: string[] = [];
    let color: string | null | undefined;
    for (const raw of rest.slice(1).flatMap((t) => t.split(",")).filter(Boolean)) {
      const w = foldWord(raw);
      const m = /^f?(\d+)$/i.exec(raw);
      if (m) {
        const n = Number(m[1]);
        if (n < 1) throw new Error(tr("čísla ploch začínají F1 – „{0}“", raw));
        faces.push(n - 1);
      } else if (/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw) && (raw.startsWith("#") || /\d/.test(raw))) {
        const h = raw.replace("#", "").toLowerCase();
        color = "#" + (h.length === 3 ? h.split("").map((c) => c + c).join("") : h);
      } else if (DEFAULT_COLOR.has(w)) color = null;
      else if (NAMED_COLORS[w]) color = NAMED_COLORS[w];
      else rule.push(w);
    }
    if (color === undefined) throw new Error(tr("barva plochy potřebuje barvu (#rrggbb, název nebo „výchozí“): {0}", usage.color()));
    if (!faces.length && !rule.length) throw new Error(tr("barva plochy potřebuje čísla ploch nebo pravidlo: {0}", usage.color()));
    if (faces.length && rule.length) throw new Error(tr("barva plochy: buď čísla ploch, nebo pravidlo – „{0}“", rule.join(" ")));
    return { kind: "faceColor", faces: [...new Set(faces)], rule, color };
  }

  // ── akce rozšíření ──
  if (ACTION_HEADS.has(head)) {
    const q = rest.join(" ").trim();
    return { kind: "action", id: q ? resolveAction(q).id : "" };
  }

  // ── analýzy ──
  if (ANALYZE_HEADS.has(head)) {
    if (OFF_WORDS.has(f1)) return { kind: "analyze", what: "off" };
    const what = ANALYZE_WHAT.find(([ws]) => ws.has(f1))?.[1];
    if (!what) throw new Error(tr("analýza: neznámý druh „{0}“ – {1}", rest[0] ?? "", usage.analyze()));
    let i = 1;
    while (i < rest.length && ANALYZE_WHAT.some(([ws, w]) => w === what && ws.has(foldWord(rest[i])))) i++; // „tloušťky stěn“
    const s = scan(rest.slice(i), { ...keys("min", "min", "minimum", "minimální", "minimalni", "mindest"), ...keys("limit", "limit", "mez", "grenze", "grenzwert") }, keys("show", ...SHOW_WORDS), usage.analyze(), tr("analýza"));
    const show = s.flags.has("show");
    if (what === "draft") {
      if (s.free.length) throw new Error(tr("analýza úkosů: číslo „{0}“ bez významu – minimální úkos se píše „min 1“", fmtN(s.free[0])));
      const min = s.nums.min ?? 1;
      if (!(min >= 0 && min < 45)) throw new Error(tr("analýza úkosů: minimální úkos musí být 0 až 45°"));
      return { kind: "analyze", what, dir: s.dir ?? [0, 0, 1], min, show };
    }
    if (what === "thickness") {
      const limit = s.nums.limit ?? s.free[0] ?? 1;
      if (!(limit > 0)) throw new Error(tr("analýza tloušťky: limit musí být kladný (mm)"));
      return { kind: "analyze", what, limit, show };
    }
    if (s.free.length || s.dir) throw new Error(tr("analýza {0} nemá další volby – {1}", rest[0], usage.analyze()));
    return what === "curvature" ? { kind: "analyze", what, show } : what === "zebra" ? { kind: "analyze", what: "zebra" } : { kind: "analyze", what: "off" };
  }

  // ── dělicí rovina ──
  if ((PARTING_A.has(head) && (PARTING_B.has(f1) || !f1 || DIR_WORDS.has(f1) || !!AXES[f1])) || PARTING_ONE.has(head)) {
    const s = scan(rest.slice(PARTING_B.has(f1) ? 1 : 0), {}, {}, usage.parting(), tr("dělicí rovina"));
    if (s.free.length) throw new Error(tr("dělicí rovina: číslo bez významu – {0}", usage.parting()));
    return { kind: "parting", dir: s.dir ?? [0, 0, 1] };
  }

  // ── vyhazovače ──
  if (EJECTOR_HEADS.has(head)) {
    const s = scan(
      rest,
      keys("spacing", "rozteč", "roztec", "rozestup", "spacing", "pitch", "teilung", "abstand"),
      { ...keys("holes", "díry", "diry", "díra", "dira", "otvory", "holes", "hole", "bohrungen", "bohrung"), ...keys("assembly", "sestava", "sestavu", "sestavy", "assembly", "baugruppe") },
      usage.ejectors(),
      tr("vyhazovače"),
    );
    if (s.free.length) throw new Error(tr("vyhazovače: číslo „{0}“ bez významu – {1}", fmtN(s.free[0]), usage.ejectors()));
    if (s.flags.has("holes") && s.flags.has("assembly")) throw new Error(tr("vyhazovače: buď díry, nebo sestava"));
    if (s.diameter !== undefined && !(s.diameter > 0)) throw new Error(tr("vyhazovače: průměr musí být kladný"));
    if (s.nums.spacing !== undefined && !(s.nums.spacing > 0)) throw new Error(tr("vyhazovače: rozteč musí být kladná"));
    return { kind: "ejectors", ...(s.diameter !== undefined ? { d: s.diameter } : {}), ...(s.nums.spacing !== undefined ? { spacing: s.nums.spacing } : {}), dir: s.dir ?? [0, 0, 1], mode: s.flags.has("holes") ? "holes" : s.flags.has("assembly") ? "assembly" : "list" };
  }

  // ── chlazení ──
  if (COOLING_HEADS.has(head)) {
    const s = scan(
      rest,
      {
        ...keys("depth", "hloubka", "hloubku", "depth", "tiefe"),
        ...keys("rows", "větve", "vetve", "větví", "vetvi", "řady", "rady", "kanály", "kanaly", "rows", "branches", "channels", "reihen", "zweige", "kanäle", "kanale"),
        ...keys("overhang", "přesah", "presah", "overhang", "überstand", "ueberstand", "uberstand"),
      },
      { ...keys("part", "díl", "dil", "dílu", "dilu", "deska", "part", "teil", "bauteil", "platte"), ...keys("assembly", "sestava", "sestavu", "assembly", "baugruppe") },
      usage.cooling(),
      tr("chlazení"),
    );
    if (s.free.length) throw new Error(tr("chlazení: číslo „{0}“ bez významu – {1}", fmtN(s.free[0]), usage.cooling()));
    if (s.flags.has("part") && s.flags.has("assembly")) throw new Error(tr("chlazení: buď díl, nebo sestava"));
    if (s.diameter !== undefined && !(s.diameter > 0)) throw new Error(tr("chlazení: průměr musí být kladný"));
    if (s.nums.depth !== undefined && !(s.nums.depth > 0)) throw new Error(tr("chlazení: hloubka musí být kladná"));
    if (s.nums.overhang !== undefined && !(s.nums.overhang >= 0)) throw new Error(tr("chlazení: přesah nesmí být záporný"));
    if (s.nums.rows !== undefined && !(Number.isInteger(s.nums.rows) && s.nums.rows >= 1 && s.nums.rows <= 50)) throw new Error(tr("chlazení: počet větví musí být celé číslo 1 až 50"));
    return {
      kind: "cooling",
      ...(s.diameter !== undefined ? { d: s.diameter } : {}),
      ...(s.nums.depth !== undefined ? { depth: s.nums.depth } : {}),
      ...(s.nums.rows !== undefined ? { rows: s.nums.rows } : {}),
      ...(s.nums.overhang !== undefined ? { overhang: s.nums.overhang } : {}),
      dir: s.dir ?? [0, 0, 1],
      mode: s.flags.has("part") ? "part" : s.flags.has("assembly") ? "assembly" : "list",
    };
  }

  // ── smrštění ──
  if (SHRINK_HEADS.has(head)) {
    const q = rest.join(" ").trim();
    if (rest.length === 1 && isNum(rest[0])) {
      const pct = num(rest[0]);
      if (!(pct > -10 && pct < 10 && pct !== 0)) throw new Error(tr("smrštění se zadává v procentech (typicky 0,3 až 2,5): {0}", usage.shrink()));
      return { kind: "shrinkage", pct };
    }
    const m = SHRINKAGE.find((x) => key(x.id) === key(q) || key(x.label) === key(q) || key(x.label.split(" ")[0]) === key(q));
    if (!m) throw new Error(tr("smrštění: zadejte procenta nebo materiál ({0}) – {1}", SHRINKAGE.map((x) => x.id.toUpperCase()).join(", "), usage.shrink()));
    return { kind: "shrinkage", pct: m.pct, label: m.label };
  }
  return null;
}

/* ───────────────────────── výsledky jako text ───────────────────────── */
const pct = (part: number, total: number) => fix(total > 0 ? (100 * part) / total : 0, 1);

/** Výsledek analýzy úkosů jako jeden řádek: podíly tříd a závěr (podkos = nelze vyhodit bez posuvných čelistí). */
export function draftReport(res: Pick<DraftResult, "areas" | "undercutRatio">, pull: Vec3, minDeg: number): string {
  const [ok, small, zero, under] = res.areas;
  const total = ok + small + zero + under;
  const parts = tr("Dostatečný {0} % · Malý {1} % · Svislá stěna {2} % · Podkos {3} %", pct(ok, total), pct(small, total), pct(zero, total), pct(under, total));
  const verdict = under > 0 && res.undercutRatio > 1e-6 ? tr("nelze vyhodit bez posuvných čelistí") : small + zero > 0 ? tr("bez podkosů – svislé stěny a malé úkosy doplňte úkosem (prvek úkos)") : tr("bez podkosů, úkosy dostatečné");
  return tr("Úkosy (směr vyhození {0}, min. {1}°): {2} – {3}", dirText(pull), fmtN(minDeg, 2), parts, verdict);
}

/** Výsledek analýzy tloušťky stěn: nejtenčí stěna a místo, průměr, podíl vzorků pod limitem. */
export function thicknessReport(w: { min: number; avg: number; below: number; at?: Vec3 | null }, limit: number): string {
  if (!(w.avg > 0)) return tr("Tloušťku stěn se nepodařilo změřit (otevřená síť nebo plochy bez tělesa).");
  return tr("Tloušťka stěn: nejtenčí {0} mm{1} · průměr {2} mm · pod limitem {3} mm: {4} % vzorků", fmtN(w.min, 2), w.at ? tr(" u {0}", vecText(w.at)) : "", fmtN(w.avg, 2), fmtN(limit, 2), fix(w.below * 100, 1));
}

/** Výsledek analýzy křivosti: rozsah 1/mm a nejmenší poloměr zakřivení. */
export function curvatureReport(c: { min: number; max: number; range: number }): string {
  const k = Math.max(Math.abs(c.min), Math.abs(c.max));
  return tr("Křivost: min {0} · max {1} 1/mm{2}", fmtN(c.min, 4), fmtN(c.max, 4), k > 1e-9 ? tr(" (nejmenší poloměr ≈ {0} mm)", fmtN(1 / k, 2)) : tr(" (jen rovinné plochy)"));
}

/** Síť převedená do rámu formy (u, v, w = směr vyhození) – odhad dělicí roviny počítá v ose w. */
export function meshInFrame(mesh: MeshData, dir: Vec3): MeshData {
  if (isPlusZ(dir)) return mesh;
  const f = moldFrame(dir);
  const v = mesh.vertices;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i += 3) {
    const p: Vec3 = [v[i], v[i + 1], v[i + 2]];
    out[i] = p[0] * f.u[0] + p[1] * f.u[1] + p[2] * f.u[2];
    out[i + 1] = p[0] * f.v[0] + p[1] * f.v[1] + p[2] * f.v[2];
    out[i + 2] = p[0] * f.w[0] + p[1] * f.w[1] + p[2] * f.w[2];
  }
  return { ...mesh, vertices: out };
}

/** Návrh dělicí roviny ve směru vyhození: poloha (mm podél směru), obvod průřezu a řez, který ji ukáže. */
export function partingPlane(mesh: MeshData, dir: Vec3): { offset: number; perimeter: number; section: SectionState } {
  const p = suggestPartingZ(meshInFrame(mesh, dir));
  const w = isPlusZ(dir) ? ([0, 0, 1] as Vec3) : moldFrame(dir).w;
  const axis = ([0, 1, 2] as const).find((i) => Math.abs(Math.abs(w[i]) - 1) < 1e-9);
  const section: SectionState =
    axis !== undefined ? { axis: (["X", "Y", "Z"] as const)[axis], offset: Math.round(p.z * Math.sign(w[axis]) * 1e4) / 1e4, flip: false } : { axis: "Z", offset: Math.round(p.z * 1e4) / 1e4, flip: false, normal: w, origin: [0, 0, 0] };
  return { offset: p.z, perimeter: p.perimeter, section };
}
export function partingReport(r: { offset: number; perimeter: number }, dir: Vec3): string {
  if (!(r.perimeter > 0)) return tr("Dělicí rovinu se nepodařilo navrhnout (těleso nemá ve směru {0} žádnou výšku).", dirText(dir));
  return isPlusZ(dir)
    ? tr("Dělicí rovina: Z = {0} mm (největší obvod průřezu {1} mm) – řez zobrazen", fmtN(r.offset, 2), fmtN(r.perimeter, 1))
    : tr("Dělicí rovina kolmo na {0}: {1} mm podél směru (největší obvod průřezu {2} mm) – řez zobrazen", dirText(dir), fmtN(r.offset, 2), fmtN(r.perimeter, 1));
}

/** Seznam navržených vyhazovačů jako text. */
export function ejectorsReport(list: EjectorSuggestion[], dir: Vec3): string {
  if (!list.length) return tr("Vyhazovače: žádný návrh (těleso je příliš malé).");
  const pos = list.map((e) => (e.p ? vecText(e.p) : `[${fmtN(e.x, 2)}; ${fmtN(e.y, 2)}]`)).join(" ");
  return tr("Vyhazovače: {0}× Ø{1} ve směru {2} – polohy {3}: {4}", list.length, fmtN(list[0].d, 2), dirText(dir), list[0].p ? tr("(bod na čele dílu x; y; z)") : tr("(X; Y v půdorysu)"), pos);
}

/** Chladicí okruh jako text (počet kanálů, průměr, hloubka, délka). */
export function coolingReport(p: CoolingParams, doc: CadDoc): string {
  const ch = doc.features.filter((f) => f.type === "cylinder");
  const len = ch.reduce((s, f) => s + (f.type === "cylinder" ? f.height : 0), 0);
  return tr("Chladicí okruh: {0} větví Ø{1} mm, hloubka osy {2} mm pod dutinou, přesah {3} mm, směr {4} – {5} vrtů, celková délka {6} mm", p.rows, fmtN(p.diameter, 2), fmtN(p.depth, 2), fmtN(p.overhang, 2), dirText(p.dir ?? [0, 0, 1]), ch.length, fmtN(len, 1));
}

/** Text řezu do protokolu. */
export function sectionReport(s: SectionState | null, bbox?: [Vec3, Vec3] | null): string {
  if (!s) return tr("✓ řez vypnut");
  const ai = s.axis === "X" ? 0 : s.axis === "Y" ? 1 : 2;
  const range = bbox && !s.normal ? tr(" (model {0} {1}…{2} mm)", s.axis, fmtN(bbox[0][ai], 2), fmtN(bbox[1][ai], 2)) : "";
  return s.normal ? tr("✓ řez obecnou rovinou s normálou {0} v {1} mm{2}", vecText(s.normal), fmtN(s.offset, 2), s.flip ? tr(", obráceně") : "") : tr("✓ řez kolmo na {0} v {1} mm{2}{3}", s.axis, fmtN(s.offset, 2), s.flip ? tr(", obráceně") : "", range);
}

/* ───────────────────────── nastavení (window.mncad.setSettings) ───────────────────────── */
export const AGENT_SETTINGS_KEYS = ["askWhereToSave", "meshQuality", "units", "decimals", "angleDecimals", "defaultMaterial", "author", "sheet", "projection", "tolerance", "confirmDelete", "autoExtrude", "autoConstraints", "snapGrid", "gridStep", "display", "ortho", "showGrid", "bg"] as const;
export type AgentSettingsKey = (typeof AGENT_SETTINGS_KEYS)[number];
export type AgentSettingsPatch = Partial<Pick<Settings, AgentSettingsKey>>;
const ENUM_SETTINGS: Partial<Record<AgentSettingsKey, readonly (string | number)[]>> = {
  meshQuality: ["draft", "normal", "fine"],
  units: ["mm", "inch"],
  decimals: [1, 2, 3, 4],
  angleDecimals: [0, 1, 2],
  sheet: ["auto", "A4", "A3", "A2", "A1", "A0"],
  projection: ["E", "A"],
  display: ["shadedEdges", "shaded", "wireframe", "hiddenLine", "xray"],
  bg: ["blue", "light", "dark", "white"],
};
const BOOL_SETTINGS = new Set<AgentSettingsKey>(["askWhereToSave", "confirmDelete", "autoExtrude", "autoConstraints", "snapGrid", "ortho", "showGrid"]);
const TEXT_SETTINGS = new Set<AgentSettingsKey>(["author", "tolerance"]);

/**
 * Ověří a použije změnu nastavení od agenta. Povolené jsou jen klíče, které mění chování a výstup (ne zkratky, jazyk
 * ani úložiště); neznámý klíč nebo neplatná hodnota = chyba s výčtem možností.
 */
export function applySettingsPatch(cur: Settings, patch: unknown): Settings {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error(tr("setSettings potřebuje objekt, např. {0}", '{ askWhereToSave: false }'));
  const next = { ...cur } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!(AGENT_SETTINGS_KEYS as readonly string[]).includes(k)) throw new Error(tr("Nastavení „{0}“ nelze měnit přes API – povolené klíče: {1}", k, AGENT_SETTINGS_KEYS.join(", ")));
    const kk = k as AgentSettingsKey;
    const opts = ENUM_SETTINGS[kk];
    if (opts) {
      if (!opts.includes(v as string | number)) throw new Error(tr("Nastavení „{0}“ má hodnoty {1} – zadáno {2}", k, opts.map((x) => JSON.stringify(x)).join(" | "), JSON.stringify(v)));
    } else if (BOOL_SETTINGS.has(kk)) {
      if (typeof v !== "boolean") throw new Error(tr("Nastavení „{0}“ je true / false – zadáno {1}", k, JSON.stringify(v)));
    } else if (TEXT_SETTINGS.has(kk)) {
      if (typeof v !== "string") throw new Error(tr("Nastavení „{0}“ je text – zadáno {1}", k, JSON.stringify(v)));
    } else if (kk === "gridStep") {
      if (typeof v !== "number" || !(v >= 0) || v > 1000) throw new Error(tr("Nastavení „gridStep“ je krok mřížky skici v mm (0 = automaticky) – zadáno {0}", JSON.stringify(v)));
    } else if (kk === "defaultMaterial") {
      if (!MATERIALS.some((m) => m.id === v)) throw new Error(tr("Nastavení „defaultMaterial“ má hodnoty {0} – zadáno {1}", MATERIALS.map((m) => m.id).join(" | "), JSON.stringify(v)));
    }
    next[k] = v;
  }
  return next as Settings;
}

/* ───────────────────────── výběr (window.mncad.select) ───────────────────────── */
export type SelectionId =
  | { kind: "face" | "edge" | "vertex"; index: number; comp?: string }
  | { kind: "body"; comp?: string }
  | { kind: "component"; name: string }
  | { kind: "feature"; name: string };
/** Rozbor id výběru: „F3“, „E2“, „V5“ (čísla jako popisky / měřit), „těleso“, „comp:Čep“, „feature:Díra 1“, v sestavě „Čep:F3“. */
export function parseSelectionId(id: string): SelectionId {
  const t = String(id ?? "").trim();
  const pre = /^(comp|component|komponenta|komponente|feature|prvek|element):(.+)$/i.exec(t);
  if (pre) {
    const name = pre[2].trim();
    return /^(feature|prvek|element)$/i.test(pre[1]) ? { kind: "feature", name } : { kind: "component", name };
  }
  const c = t.lastIndexOf(":");
  const comp = c > 0 ? t.slice(0, c).trim() : undefined;
  const e = (c > 0 ? t.slice(c + 1) : t).trim();
  const m = /^([fev])(\d+)$/i.exec(e);
  if (m) {
    const n = Number(m[2]);
    if (n < 1) throw new Error(tr("čísla ploch, hran a vrcholů začínají 1 (F1, E1, V1) – „{0}“", t));
    const L = m[1].toUpperCase();
    return { kind: L === "F" ? "face" : L === "E" ? "edge" : "vertex", index: n - 1, ...(comp ? { comp } : {}) };
  }
  if (["teleso", "body", "korper", "koerper", "solid"].includes(foldWord(e))) return { kind: "body", ...(comp ? { comp } : {}) };
  throw new Error(tr("neznámé id výběru „{0}“ – F3, E2, V5, těleso, comp:Název, feature:Název, v sestavě Komponenta:F3", t));
}

/* ───────────────────────── snímek (window.mncad.screenshot) ───────────────────────── */
export type ScreenshotView = "iso" | "front" | "top" | "right" | "back" | "bottom" | "left" | "current";
export type ScreenshotOptions = {
  view?: ScreenshotView;
  display?: DisplayStyle;
  width?: number;
  height?: number;
  fit?: boolean;
  hints?: boolean;
  section?: { axis: "X" | "Y" | "Z"; offset: number; flip?: boolean } | null;
  background?: "white" | "current";
  explode?: number;
  target?: "auto" | "3d" | "sketch";
};
export type Screenshot = { mime: "image/png"; width: number; height: number; base64: string };
const VIEWS_OK: ScreenshotView[] = ["iso", "front", "top", "right", "back", "bottom", "left", "current"];
const DISPLAYS: DisplayStyle[] = ["shadedEdges", "shaded", "wireframe", "hiddenLine", "xray"];
/** Ověří volby snímku (chyba česky s možnostmi); rozměry 16…4096 px. */
export function checkScreenshotOptions(o: unknown): ScreenshotOptions {
  if (o == null) return {};
  if (typeof o !== "object" || Array.isArray(o)) throw new Error(tr("screenshot potřebuje objekt voleb, např. {0}", '{ view: "iso", width: 800 }'));
  const x = o as ScreenshotOptions & Record<string, unknown>;
  const allowed = ["view", "display", "width", "height", "fit", "hints", "section", "background", "explode", "target"];
  for (const k of Object.keys(x)) if (!allowed.includes(k)) throw new Error(tr("screenshot: neznámá volba „{0}“ – volby: {1}", k, allowed.join(", ")));
  if (x.view !== undefined && !VIEWS_OK.includes(x.view)) throw new Error(tr("screenshot: view je {0}", VIEWS_OK.join(" | ")));
  if (x.display !== undefined && !DISPLAYS.includes(x.display)) throw new Error(tr("screenshot: display je {0}", DISPLAYS.join(" | ")));
  for (const k of ["width", "height"] as const) if (x[k] !== undefined && !(typeof x[k] === "number" && x[k]! >= 16 && x[k]! <= 4096)) throw new Error(tr("screenshot: {0} musí být 16 až 4096 px", k));
  if (x.background !== undefined && x.background !== "white" && x.background !== "current") throw new Error(tr("screenshot: background je white | current"));
  if (x.target !== undefined && !["auto", "3d", "sketch"].includes(x.target)) throw new Error(tr("screenshot: target je auto | 3d | sketch"));
  if (x.explode !== undefined && !(typeof x.explode === "number" && x.explode >= 0 && x.explode <= 3)) throw new Error(tr("screenshot: explode je 0 až 3 (rozložení sestavy)"));
  if (x.section) {
    const s = x.section;
    if (!["X", "Y", "Z"].includes(s.axis) || typeof s.offset !== "number" || !Number.isFinite(s.offset)) throw new Error(tr("screenshot: section je {0}", '{ axis: "X" | "Y" | "Z", offset: číslo (mm), flip?: true }'));
  }
  return x;
}
/** Rozměr výsledného snímku: zadaná šířka / výška, chybějící dopočítaná z poměru stran zdroje. */
export function shotSize(srcW: number, srcH: number, o: Pick<ScreenshotOptions, "width" | "height">): { width: number; height: number } {
  const r = srcW > 0 && srcH > 0 ? srcW / srcH : 4 / 3;
  if (o.width && o.height) return { width: Math.round(o.width), height: Math.round(o.height) };
  if (o.width) return { width: Math.round(o.width), height: Math.max(16, Math.round(o.width / r)) };
  if (o.height) return { width: Math.max(16, Math.round(o.height * r)), height: Math.round(o.height) };
  return { width: Math.round(srcW) || 800, height: Math.round(srcH) || 600 };
}

/* ───────────────────────── zachytávací API akcí rozšíření ───────────────────────── */
export type CapturedFile = { name: string; mime: string; bytes: number; base64: string };
/** výstupy akce rozšíření (stejná pole jako v ExtActionApi, components/cad/ext/registry.tsx) */
export type CaptureHooks = { flash: (m: string) => void; notice: (title: string, body: string) => void; download: (name: string, data: BlobPart, type: string) => void };
export type ActionCapture<B> = {
  api: B & CaptureHooks;
  /** počká na převod stažených souborů a vrátí protokol a soubory */
  done: () => Promise<{ log: string; files: CapturedFile[] }>;
};
export function bytesToBase64(u8: Uint8Array): string {
  let b = "";
  for (let i = 0; i < u8.length; i += 0x8000) b += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(b);
}
/**
 * API akce rozšíření, které nic nezobrazuje ani nestahuje: text okna (notice) a hlášky (flash) jdou do protokolu,
 * stažené soubory se zachytí jako base64 (pro agenta, který soubor potřebuje bez dialogu).
 */
export function captureActionApi<B extends object>(base: B): ActionCapture<B> {
  const lines: string[] = [];
  const pending: Promise<CapturedFile>[] = [];
  return {
    api: {
      ...base,
      flash: (m) => void lines.push(m),
      notice: (title, body) => void lines.push(`${title}\n${body}`),
      download: (name, data, type) =>
        void pending.push(
          (async () => {
            const blob = data instanceof Blob ? data : new Blob([data], { type });
            const u8 = new Uint8Array(await blob.arrayBuffer());
            return { name, mime: type, bytes: u8.length, base64: bytesToBase64(u8) };
          })(),
        ),
    },
    done: async () => ({ log: lines.join("\n"), files: await Promise.all(pending) }),
  };
}
/** Řádek protokolu o zachyceném souboru. */
export const fileLine = (f: CapturedFile) => tr("soubor {0} ({1} B, {2}) – data vrací window.mncad.action()", f.name, f.bytes, f.mime);

/* ───────────────────────── typy rozšíření window.mncad ───────────────────────── */
export type ImportFileInput = { name: string; base64: string } | { name: string; text: string } | File;
export type CompareApiOptions = {
  tolerance?: number;
  align?: "none" | "center" | "auto";
  rotate?: [number, number, number];
  offset?: [number, number, number];
  booleans?: "auto" | "always" | "never";
  map?: boolean;
  show?: boolean;
};
export type CompareApiResult = {
  ok: boolean;
  text: string;
  csv: string;
  regions: { n: number; side: "extra" | "missing"; volume: number; center: [number, number, number]; hint: string }[];
};
export type ShareApiOptions = { days?: number | null; password?: string; from?: string; view?: "model" | "drawing"; mode?: "link" | "store" | "self" };
/** výsledek share(): self = krátký odkaz z úložiště na webu (/cad/share/), store = Supabase, link = celý dokument v odkazu (`note` = proč) */
export type ShareApiResult = { url: string; mode: "link" | "store" | "self"; bytes: number; exp: number | null; message: string; chars: number; note?: string };
export type SelectionEntry = { id: string; kind: "face" | "edge" | "vertex" | "body" | "component" | "feature"; index?: number; compId?: string; title?: string };
/** Metody `window.mncad` z tohoto modulu (provedení: components/cad/agent-api-host.ts). */
export type MncadApiExt = {
  /**
   * otevře / importuje soubor stejnou cestou jako Otevřít a přetažení (STEP, IGES, BREP, STL, OBJ, 3MF, glTF/GLB, PLY, OFF,
   * DXF, .mncad); `as`: auto = jako Otevřít, tab = samostatný dokument v záložce (nikdy do sestavy ani do dílu), component = do otevřené sestavy, sketch = DXF do skici.
   * Slib se splní po dokončení importu a stavby – vrátí protokol + stav dokumentu; chyba = výjimka s důvodem.
   */
  importFile: (file: ImportFileInput, opts?: { as?: "auto" | "tab" | "component" | "sketch" }) => Promise<string>;
  /** snímek 3D okna (při otevřené skice skicáře) jako PNG; dočasný pohled / styl / řez se po snímku vrátí */
  screenshot: (opts?: ScreenshotOptions) => Promise<Screenshot>;
  /** porovnání s referenčním modelem (STEP / BREP / IGES / STL…) – text, CSV a seznam rozdílových oblastí */
  compare: (ref: { name: string; base64: string }, opts?: CompareApiOptions) => Promise<CompareApiResult>;
  /** sdílený odkaz (jako tlačítko Sdílet odkazem) */
  share: (opts?: ShareApiOptions) => Promise<ShareApiResult>;
  /** platné nastavení */
  settings: () => Settings;
  /** změna nastavení, které mění chování a výstup (neznámý klíč = chyba); vrátí nové nastavení */
  setSettings: (patch: AgentSettingsPatch) => Settings;
  /** aktuální výběr (id jako popisky: F3, E2, V5; comp:…; feature:…); index = pořadí od 0 jako u hints() */
  selection: () => SelectionEntry[];
  /** vybere entity podle id (stejně jako klik, bez trefování a bez ohledu na filtr); vrátí počet vybraných */
  select: (ids: string[], opts?: { additive?: boolean }) => number;
  /** zruší výběr (Esc) */
  clearSelection: () => void;
  /** spustí akci rozšíření (Rozvin → DXF, Tabulka ohybů, Kusovník řezů, Tloušťka stěn, export skici DXF…) a vrátí text a soubory */
  action: (id: string) => Promise<{ log: string; files: CapturedFile[] }>;
};
