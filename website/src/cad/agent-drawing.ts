/**
 * Textové příkazy výkresu (čistý parser – bez jádra, testovatelný v Node):
 * - `výkres [A4|A3|A2|A1|A0] [na šířku|na výšku] [měřítko 1:2|auto] [pohledy přední,horní,iso] [řez XZ [odsazení N]|ne]
 *   [skryté ano|ne] [osy ano|ne] [tabulka děr ano|ne] [promítání E|A]` – volby listu (tabulka VOLBY, další volba = řádek);
 * - `kótovat [chytře|celkově|nic] [řetězově|od základny]` – (pře)generuje Chytré kóty;
 * - `výkres tolerance <kóta> <tolerance>`, `výkres poznámka "…"`, `výkres nepředepsané ISO 2768-mK`, `výkres hrany …`,
 *   `výkres drsnost Ra 3,2`, `výkres stav [list N|vše]`;
 * - listy (`výkres list 2|"Detail"|nový|přejmenovat|smazat`), razítko (`výkres razítko číslo="…"`), revize, značky
 *   (`výkres značka drsnost Ra 1,6 na Ø40`), ruční kóty (`výkres kóta vodorovně pohled přední …`), úpravy a mazání
 *   (`výkres upravit a3 odsazení=8`, `výkres smazat a3`), detaily (`výkres detail přední v 10 5 poloměr 4`) a další modely.
 * Česky, anglicky (drawing, dimension) i německy (zeichnung, bemaßen). Provedení: cad/drawing-agent.ts (+ drawing-marks.ts).
 */
import { tr } from "./i18n";
import type { DrawingOptions, ViewKey, ViewRotation } from "./drawing";
import { parseDrawingViews, type ViewsCmd } from "./agent-drawing-views";
import type { FitShow } from "./drawing-fits";
import type { GdtSymbol, PlaneName, Vec2 } from "./types";

/** Pohled jako cíl značky / kóty: pohled modelu (front…), „section“ (řez), „iso“, „detail:A“ (detail), „model:<název>“ (další model). */
export type ViewRef = string;
/** Odkaz na list: číslo (od 1) nebo název. */
export type SheetRef = number | string;
/** formáty `výkres export …` (shodné s DrawingExportFormat v drawing-export.ts) */
export type DrawingFileFormat = "pdf" | "dxf" | "dwg" | "svg" | "csv" | "png";
/** Značka výkresu (nástroje Poznámka, Drsnost, Geom. tolerance, Základna, Text). */
export type MarkSpec =
  | { type: "note"; text: string }
  | { type: "roughness"; ra: string }
  | { type: "gdt"; symbol: GdtSymbol; value: string; datum?: string }
  | { type: "datum"; label?: string }
  | { type: "text"; text: string; size: number };
/** Kam značka ukazuje: na kótu / popis (popisek nebo id a1…), do bodu pohledu (mm modelu v rovině pohledu, y nahoru), nebo na list (mm listu od levého dolního rohu). */
export type MarkTarget = { on: string } | { view: ViewRef; at: Vec2 } | { sheet: Vec2 };
/** Ruční kóta (nástroj Kóta): body v mm modelu v rovině pohledu (y nahoru); odsazení v mm listu. */
export type ManualDim =
  | { kind: "horizontal" | "vertical" | "aligned"; view: ViewRef; p1: Vec2; p2: Vec2 }
  | { kind: "diameter" | "radius"; view: ViewRef; c: Vec2; r?: number; ang?: number }
  | { kind: "angle"; view: ViewRef; l1: [Vec2, Vec2]; l2: [Vec2, Vec2] };
/** Pole razítka. */
export type TitleField = "name" | "number" | "author" | "revision" | "date" | "material" | "tolerance" | "edges" | "note";
/** Úprava kóty / značky (výkres upravit). */
export type AnnPatch = { offset?: number; text?: string; suffix?: string; value?: string; datum?: string; height?: number; /** posun značky [mm listu, y nahoru] */ shift?: Vec2 };

export type DrawingCmd =
  /** volby listu (výkres A3 …) */
  | { k: "set"; opts: Partial<DrawingOptions>; summary: string[] }
  /** kótovat chytře / celkově / nic / základní (Auto + Ø), řetězově / od základny */
  | { k: "dim"; mode: "smart" | "overall" | "none" | "auto"; style?: "chain" | "baseline" }
  /** tolerance ke kótě podle popisku / hodnoty; `fit` = výkres uložení (pole ISO 286, kontrola), `show` = zobrazení úchylek u kóty */
  | { k: "tol"; target: string; tol: string; fit?: boolean; show?: FitShow }
  /** pomocné pohledy, řezy lomenou čarou, částečné řezy, přerušení, uložení, značky revizí, zóny (cad/agent-drawing-views.ts) */
  | { k: "views"; cmd: ViewsCmd }
  /** údaje u razítka: poznámka, nepředepsané tolerance, hrany, drsnost */
  | { k: "meta"; field: "note" | "tolerance" | "edges" | "roughness"; value: string }
  /** stav výkresu: aktivní list, zadaný list nebo všechny */
  | { k: "status"; sheet?: SheetRef | "all" }
  /** listy: přehled, přepnout (další příkazy pracují s ním), nový, přejmenovat, smazat; `then` = volby na stejném řádku */
  | { k: "sheet"; op: "list" }
  | { k: "sheet"; op: "select"; ref: SheetRef; then?: DrawingCmd }
  | { k: "sheet"; op: "new"; name?: string; then?: DrawingCmd }
  | { k: "sheet"; op: "rename"; ref?: SheetRef; name: string }
  | { k: "sheet"; op: "delete"; ref: SheetRef }
  /** výkresy dílu (více výkresů – cad/drawing-sets.ts): přehled, nový, přepnout, přejmenovat, smazat */
  | { k: "drawings"; op: "list" }
  | { k: "drawings"; op: "new"; name?: string }
  | { k: "drawings"; op: "select"; ref: SheetRef }
  | { k: "drawings"; op: "rename"; ref?: SheetRef; name: string }
  | { k: "drawings"; op: "delete"; ref: SheetRef }
  /** export do souboru: aktivní list, list N nebo všechny listy aktivního výkresu (PDF vícestránkové, jinak ZIP) */
  | { k: "export"; format: DrawingFileFormat; sheet?: SheetRef | "all"; dwgVersion?: string }
  /** razítko (prázdné = vypsat) */
  | { k: "title"; fields: Partial<Record<TitleField, string>> }
  /** tabulka revizí */
  | { k: "rev"; op: "set"; rev: string; note: string; date?: string; author?: string }
  | { k: "rev"; op: "delete"; rev: string }
  /** značka s odkazem (poznámka, drsnost, GD&T, základna, text); `shift` = posun popisku [mm listu, y nahoru] */
  | { k: "mark"; mark: MarkSpec; target: MarkTarget; shift?: Vec2 }
  /** ruční kóta; `offset` [mm listu], `text` = vlastní text místo hodnoty */
  | { k: "mdim"; dim: ManualDim; offset?: number; text?: string }
  /** úprava kóty / značky podle id (a1…) nebo popisku */
  | { k: "edit"; target: string; patch: AnnPatch }
  /** smazání kót / značek: id nebo popisky, „vlastní“ = všechny vlastní, „vše“ = všechny */
  | { k: "del"; targets: string[] | "custom" | "all" }
  /** detailní pohled: nový (střed v mm modelu v rovině pohledu, poloměr, měřítko, umístění středu na listu), úprava, smazání */
  | { k: "detail"; op: "add"; view: ViewRef; at: Vec2; r: number; scale?: number; place?: Vec2 }
  | { k: "detail"; op: "edit"; label: string; scale?: number; place?: Vec2 }
  | { k: "detail"; op: "delete"; label: string }
  /** další model na listu (komponenta sestavy / otevřená záložka) */
  | { k: "model"; op: "add"; name: string; view?: ViewKey | "iso"; scale?: number | "auto" }
  | { k: "model"; op: "delete"; name: string };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const YES = new Set(["ano", "yes", "ja", "on", "true", "zapnout", "zap"]);
const NO = new Set(["ne", "no", "nein", "off", "false", "vypnout", "vyp", "zadny", "zadne", "none", "keine", "kein", "aus"]);

const VIEW_WORDS: Record<string, ViewKey | "iso"> = {
  predni: "front", front: "front", vorne: "front", vorderansicht: "front", hlavni: "front",
  zadni: "back", back: "back", hinten: "back", rueckansicht: "back", ruckansicht: "back",
  horni: "top", top: "top", shora: "top", oben: "top", draufsicht: "top",
  spodni: "bottom", bottom: "bottom", zdola: "bottom", unten: "bottom", untersicht: "bottom",
  levy: "left", left: "left", zleva: "left", links: "left",
  pravy: "right", right: "right", zprava: "right", rechts: "right",
  iso: "iso", izometrie: "iso", isometrie: "iso", isometric: "iso", isometrisch: "iso", izo: "iso",
};
export const VIEW_CS: Record<ViewKey | "iso", string> = { front: "přední", back: "zadní", top: "horní", bottom: "spodní", left: "levý", right: "pravý", iso: "izometrie" };

/** Řádek tabulky voleb: slova (cs/en/de, bez diakritiky), nápověda a čtení hodnoty (vrátí počet spotřebovaných tokenů). */
type OptRow = { words: string[]; help: () => string; read: (t: string[], i: number, o: Partial<DrawingOptions>, sum: string[]) => number };

const bool = (w: string | undefined, what: string): boolean => {
  const f = fold(w ?? "");
  if (YES.has(f)) return true;
  if (NO.has(f)) return false;
  throw new Error(tr("{0}: čekám ano / ne", what));
};
const HALF = ["polovicni", "polovina", "half", "halb", "halbschnitt"];
const FULL = ["cely", "full", "voll", "vollschnitt"];
const ORIENT = ["na", "sirku", "sirka", "landscape", "quer", "querformat", "vysku", "vyska", "portrait", "hoch", "hochformat"];
/** slovo, kterým začíná další volba (konec výčtu pohledů) */
const isOptWord = (w: string) => VOLBY.some((r) => r.words.includes(fold(w))) || ORIENT.includes(fold(w)) || /^a[0-4]$/i.test(w);

/** Volby příkazu „výkres“ – nová volba (např. natočení pohledu, poloviční řez) = nový řádek. */
export const VOLBY: OptRow[] = [
  {
    words: ["format", "list", "sheet", "blatt"],
    help: () => tr("formát A4|A3|A2|A1|A0|auto"),
    read: (t, i, o, sum) => {
      const v = (t[i + 1] ?? "").toUpperCase();
      if (v !== "AUTO" && !/^A[0-4]$/.test(v)) throw new Error(tr("formát listu: A4, A3, A2, A1, A0 nebo auto"));
      o.sheet = v === "AUTO" ? "auto" : (v as DrawingOptions["sheet"]);
      sum.push(o.sheet === "auto" ? tr("formát automaticky") : o.sheet);
      return 2;
    },
  },
  {
    words: ["meritko", "scale", "massstab"],
    help: () => tr("měřítko 1:2|2:1|1:1|auto"),
    read: (t, i, o, sum) => {
      const v = fold(t[i + 1] ?? "");
      if (v === "auto") o.scale = "auto";
      else {
        const m = /^(\d+(?:[.,]\d+)?)(?::(\d+(?:[.,]\d+)?))?$/.exec(v);
        const a = m ? parseFloat(m[1].replace(",", ".")) : NaN;
        const b = m?.[2] ? parseFloat(m[2].replace(",", ".")) : 1;
        if (!(a > 0 && b > 0)) throw new Error(tr("měřítko: 1:2, 2:1, 1:1 nebo auto"));
        o.scale = a / b;
      }
      sum.push(tr("měřítko {0}", t[i + 1]));
      return 2;
    },
  },
  {
    words: ["pohledy", "views", "ansichten", "pohled", "view"],
    help: () => tr("pohledy přední,horní,levý,pravý,zadní,spodní,iso"),
    read: (t, i, o, sum) => {
      const list: string[] = [];
      let j = i + 1;
      while (j < t.length && !isOptWord(t[j])) list.push(...t[j++].split(/[,;]/).filter(Boolean));
      const views = { front: false, top: false, left: false, right: false, back: false, bottom: false, iso: false };
      for (const w of list) {
        const k = VIEW_WORDS[fold(w)];
        if (!k) throw new Error(tr("neznámý pohled „{0}“ – přední, horní, levý, pravý, zadní, spodní, iso", w));
        views[k] = true;
      }
      if (!list.length) throw new Error(tr("pohledy: vyjmenujte je čárkou, např. pohledy přední,horní,iso"));
      o.views = views;
      sum.push(tr("pohledy {0}", list.join(", ")));
      return j - i;
    },
  },
  {
    words: ["rez", "section", "schnitt"],
    help: () => tr("řez XZ|YZ|XY [odsazení N] | řez ne"),
    read: (t, i, o, sum) => {
      const v = fold(t[i + 1] ?? "");
      if (NO.has(v)) {
        o.section = null;
        sum.push(tr("bez řezu"));
        return 2;
      }
      const plane = v.toUpperCase() as PlaneName;
      if (!["XZ", "YZ", "XY"].includes(plane)) throw new Error(tr("řez: rovina XZ, YZ nebo XY (řez XZ odsazení 0), nebo „řez ne“"));
      let n = 2;
      let offset = 0;
      let kind: "full" | "half" | undefined;
      for (;;) {
        const w = fold(t[i + n] ?? "");
        if (["odsazeni", "offset", "versatz", "posun"].includes(w)) {
          offset = parseFloat((t[i + n + 1] ?? "").replace(",", "."));
          if (!Number.isFinite(offset)) throw new Error(tr("řez: odsazení musí být číslo"));
          n += 2;
        } else if (HALF.includes(w) || FULL.includes(w)) {
          kind = HALF.includes(w) ? "half" : "full";
          n++;
        } else break;
      }
      o.section = { plane, offset, ...(kind ? { kind } : {}) };
      sum.push(tr("řez {0} odsazení {1}", plane, String(offset).replace(".", ",")) + (kind === "half" ? tr(" (poloviční)") : kind === "full" ? tr(" (celý)") : ""));
      return n;
    },
  },
  {
    words: ["skryte", "hidden", "verdeckt", "verdeckte"],
    help: () => tr("skryté ano|ne"),
    read: (t, i, o, sum) => {
      o.hidden = bool(t[i + 1], tr("skryté hrany"));
      sum.push(o.hidden ? tr("skryté hrany") : tr("bez skrytých hran"));
      return 2;
    },
  },
  {
    words: ["osy", "axes", "centerlines", "achsen", "mittellinien"],
    help: () => tr("osy ano|ne"),
    read: (t, i, o, sum) => {
      o.centerLines = bool(t[i + 1], tr("osy"));
      sum.push(o.centerLines ? tr("osy") : tr("bez os"));
      return 2;
    },
  },
  {
    words: ["tabulka", "holetable", "bohrungstabelle"],
    help: () => tr("tabulka děr ano|ne"),
    read: (t, i, o, sum) => {
      const two = ["der", "holes"].includes(fold(t[i + 1] ?? ""));
      o.holeTable = bool(t[i + (two ? 2 : 1)], tr("tabulka děr"));
      sum.push(o.holeTable ? tr("tabulka děr") : tr("bez tabulky děr"));
      return two ? 3 : 2;
    },
  },
  {
    words: ["otoceni", "rotation", "drehung", "natoceni", "rotate"],
    help: () => tr("otočení 0|90|180|270"),
    read: (t, i, o, sum) => {
      const v = Number((t[i + 1] ?? "").replace(/°$/, ""));
      if (![0, 90, 180, 270].includes(v)) throw new Error(tr("otočení hlavního pohledu: 0, 90, 180 nebo 270 (°)"));
      o.rotation = v as ViewRotation;
      sum.push(tr("otočení {0}°", v));
      return 2;
    },
  },
  {
    words: ["kusovnik", "bom", "stuckliste", "partslist"],
    help: () => tr("kusovník ano|ne"),
    read: (t, i, o, sum) => {
      o.bomTable = bool(t[i + 1], tr("kusovník"));
      sum.push(o.bomTable ? tr("kusovník nad razítkem") : tr("bez kusovníku"));
      return 2;
    },
  },
  {
    words: ["balonky", "balloons", "positionsnummern", "pozice", "positionen"],
    help: () => tr("balónky ano|ne"),
    read: (t, i, o, sum) => {
      o.balloons = bool(t[i + 1], tr("balónky"));
      sum.push(o.balloons ? tr("pozice komponent (balónky)") : tr("bez balónků"));
      return 2;
    },
  },
  {
    words: ["promitani", "projection", "projektion"],
    help: () => tr("promítání E|A"),
    read: (t, i, o, sum) => {
      const v = (t[i + 1] ?? "").toUpperCase();
      if (v !== "E" && v !== "A") throw new Error(tr("promítání: E (evropské) nebo A (americké)"));
      o.projection = v;
      sum.push(tr("promítání ISO {0}", v));
      return 2;
    },
  },
];

const SUB: Record<string, DrawingCmd["k"] | "note" | "tolerance" | "edges" | "roughness"> = {
  tolerance: "tol", tol: "tol", toleranz: "tol", licovani: "tol",
  poznamka: "note", note: "note", notiz: "note", hinweis: "note",
  nepredepsane: "tolerance", general: "tolerance", allgemein: "tolerance", allgemeintoleranz: "tolerance", allgemeintoleranzen: "tolerance",
  hrany: "edges", edges: "edges", kanten: "edges", werkstuckkanten: "edges",
  drsnost: "roughness", roughness: "roughness", rauheit: "roughness", rauigkeit: "roughness", oberflache: "roughness",
  stav: "status", status: "status", zustand: "status", info: "status", report: "status", bericht: "status",
};

/**
 * Příkaz „výkres …“ (tokeny za slovem výkres) → povel; prázdné = jen otevřít výkres (null).
 * `raw` = text řádku za slovem výkres (zachová uvozovky a zápis klíč="hodnota s mezerami"); bez něj se složí z tokenů.
 */
export function parseDrawing(tokens: string[], raw?: string): DrawingCmd | null {
  if (!tokens.length) return null;
  const rt = rawTokens(raw ?? tokens.map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(" "));
  const vw = parseDrawingViews(rt);
  if (vw) return vw.op === "fit-set" ? { k: "tol", target: vw.target, tol: vw.code, fit: true, ...(vw.show ? { show: vw.show } : {}) } : { k: "views", cmd: vw };
  const more = parseDrawingMore(rt);
  if (more) return more;
  const sub = SUB[fold(tokens[0])];
  const rest = tokens.slice(1).join(" ").trim();
  if (sub === "status") return parseStatus(rt.slice(1));
  if (sub === "tol") {
    if (tokens.length < 3) throw new Error(tr("výkres tolerance <kóta> <tolerance> – např. výkres tolerance Ø40 h6 · výkres tolerance 25 ±0,1 · výkres tolerance M8 6H"));
    return { k: "tol", target: tokens[1], tol: tokens.slice(2).join(" ") };
  }
  if (sub === "note" || sub === "tolerance" || sub === "edges" || sub === "roughness") {
    if (!rest && sub !== "note") throw new Error(tr("výkres {0} potřebuje text, např. {1}", tokens[0], sub === "tolerance" ? "ISO 2768-mK" : sub === "edges" ? "ISO 13715 -0,3" : "Ra 3,2"));
    return { k: "meta", field: sub, value: rest };
  }
  return parseSet(tokens);
}

/** Volby listu (A3, na šířku, měřítko …) → povel „set“. */
function parseSet(tokens: string[]): DrawingCmd {
  const o: Partial<DrawingOptions> = {};
  const sum: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    const w = fold(tokens[i]);
    if (/^a[0-4]$/.test(w) || w === "auto") {
      o.sheet = w === "auto" ? "auto" : (w.toUpperCase() as DrawingOptions["sheet"]);
      sum.push(o.sheet === "auto" ? tr("formát automaticky") : o.sheet);
      i++;
      continue;
    }
    // orientace: „na šířku“ / „na výšku“ (i jedním slovem), landscape / portrait, quer / hoch
    const ori = (x: string) => (["sirku", "sirka", "landscape", "quer", "querformat"].includes(x) ? "landscape" : ["vysku", "vyska", "portrait", "hoch", "hochformat"].includes(x) ? "portrait" : null);
    const o1 = w === "na" ? ori(fold(tokens[i + 1] ?? "")) : ori(w);
    if (o1) {
      o.orientation = o1;
      sum.push(o1 === "landscape" ? tr("na šířku") : tr("na výšku"));
      i += w === "na" ? 2 : 1;
      continue;
    }
    const row = VOLBY.find((r) => r.words.includes(w));
    if (!row) throw new Error(tr("neznámá volba výkresu „{0}“ – volby: A4…A0, na šířku / na výšku, {1}; podpříkazy: tolerance, poznámka, nepředepsané, hrany, drsnost, list, razítko, revize, značka, kóta, upravit, smazat, detail, model, stav", tokens[i], VOLBY.map((r) => r.help()).join(", ")));
    i += row.read(tokens, i, o, sum);
  }
  return { k: "set", opts: o, summary: sum };
}

/** Příkaz „kótovat …“ → povel (výchozí chytře, řetězově). */
export function parseDimension(tokens: string[]): DrawingCmd {
  let mode: "smart" | "overall" | "none" | "auto" = "smart";
  let style: "chain" | "baseline" | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const w = fold(tokens[i]);
    if (["chytre", "smart", "intelligent", "auto", "automaticky"].includes(w)) mode = "smart";
    else if (["zakladni", "basic", "einfach", "jednoduse", "jednoduche"].includes(w)) mode = "auto";
    else if (["celkove", "overall", "gesamt", "gesamtmasse", "aussenmasse"].includes(w)) mode = "overall";
    else if (NO.has(w) || w === "nic") mode = "none";
    else if (["retezove", "chain", "kette", "kettenmass", "ketten"].includes(w)) style = "chain";
    else if (["baseline", "basis", "bezug", "bezugsmass", "zakladny", "zakladna"].includes(w)) style = "baseline";
    else if (w === "od" && ["zakladny", "zakladna"].includes(fold(tokens[i + 1] ?? ""))) {
      style = "baseline";
      i++;
    } else throw new Error(tr("kótovat [chytře|celkově|základní|nic] [řetězově|od základny] – neznámé slovo „{0}“", tokens[i]));
  }
  return { k: "dim", mode, ...(style ? { style } : {}) };
}

// ---------------------------------------------------------------- listy, razítko, revize, značky, kóty, detaily, modely

/** Token řádku: text, zda byl v uvozovkách, a klíč u zápisu klíč=hodnota. */
export type RawTok = { s: string; q: boolean; key?: string };
const RAW_RE = /([^\s="„“']+)=(?:"([^"]*)"|„([^“]*)“|'([^']*)'|(\S*))|"([^"]*)"|„([^“]*)“|'([^']*)'|(\S+)/g;
/** Rozdělí text na tokeny se zachováním uvozovek a zápisu klíč="hodnota s mezerami". */
export function rawTokens(line: string): RawTok[] {
  const out: RawTok[] = [];
  for (const m of line.matchAll(RAW_RE)) {
    if (m[1] !== undefined) {
      const quoted = m[2] ?? m[3] ?? m[4];
      out.push({ key: m[1], s: quoted ?? m[5] ?? "", q: quoted !== undefined });
    } else {
      const quoted = m[6] ?? m[7] ?? m[8];
      out.push({ s: quoted ?? m[9], q: quoted !== undefined });
    }
  }
  return out;
}

const W = (...w: string[]) => new Set(w);
const SHEET_W = W("list", "sheet", "blatt");
const SHEETS_W = W("listy", "sheets", "blatter", "blaetter");
const NEW_W = W("novy", "nova", "nove", "new", "neu", "neues", "pridat", "add");
const RENAME_W = W("prejmenovat", "rename", "umbenennen", "nazev");
const DEL_W = W("smazat", "odstranit", "delete", "remove", "loschen", "loeschen", "entfernen");
const ALL_W = W("vse", "vsechny", "all", "alle");
const DRAWINGS_W = W("vykresy", "drawings", "zeichnungen");
const NEW_DRAWING_W = W("novy", "new", "neu", "neue");
const EXPORT_W = W("export", "exportovat", "exportieren");
const FORMAT_W = W("pdf", "dxf", "dwg", "svg", "csv", "png");
const CUSTOM_W = W("vlastni", "custom", "eigene", "benutzer");
const ON_W = W("na", "on", "an", "auf");
const VIEW_W = W("pohled", "view", "ansicht");
const AT_W = W("v", "at", "bei", "u", "in");
const SHIFT_W = W("posun", "shift", "move", "versatz", "verschiebung", "verschieben");
const HEIGHT_W = W("vyska", "height", "hohe", "hoehe", "size", "velikost");
const OFFSET_W = W("odsazeni", "offset", "versatz", "abstand");
const TEXT_W = W("text");
const CENTER_W = W("stred", "center", "centre", "mitte", "mittelpunkt");
const RADIUS_W = W("r", "polomer", "radius");
const ANGLE_W = W("uhel", "angle", "winkel", "smer");
const SCALE_W = W("meritko", "scale", "massstab");
const PLACE_W = W("umistit", "umisteni", "place", "platzieren", "position");
const SECTION_W = W("rez", "section", "schnitt", "rez-a-a");
const DETAIL_W = W("detail", "einzelheit");
const FILLER_W = W("od", "do", "z", "from", "to", "von", "bis", "a", "and", "und", "body", "points", "punkte");

const MARK_W: Record<string, MarkSpec["type"]> = {
  poznamka: "note", note: "note", hinweis: "note", notiz: "note", odkaz: "note",
  drsnost: "roughness", roughness: "roughness", rauheit: "roughness", rauigkeit: "roughness", oberflache: "roughness",
  tolerance: "gdt", gdt: "gdt", form: "gdt", lage: "gdt", toleranz: "gdt", formtoleranz: "gdt", geometricka: "gdt",
  zakladna: "datum", datum: "datum", bezug: "datum",
  text: "text",
};
/** Charakteristiky geometrické tolerance ISO 1101 (cs, en, de). */
export const GDT_WORDS: Record<string, GdtSymbol> = {
  primost: "straight", straightness: "straight", geradheit: "straight",
  rovinnost: "flat", flatness: "flat", ebenheit: "flat",
  kruhovitost: "circ", circularity: "circ", roundness: "circ", rundheit: "circ",
  valcovitost: "cyl", cylindricity: "cyl", zylindrizitat: "cyl", zylinderform: "cyl",
  profil: "prof", profile: "prof", tvar: "prof",
  rovnobeznost: "par", parallelism: "par", parallelitat: "par",
  kolmost: "perp", perpendicularity: "perp", rechtwinkligkeit: "perp",
  sklon: "angle", angularity: "angle", neigung: "angle",
  poloha: "pos", position: "pos",
  souosost: "conc", soustrednost: "conc", concentricity: "conc", coaxiality: "conc", koaxialitat: "conc", konzentrizitat: "conc",
  soumernost: "sym", symmetry: "sym", symmetrie: "sym",
  hazeni: "runout", runout: "runout", lauf: "runout", rundlauf: "runout",
};
const DIM_W: Record<string, ManualDim["kind"]> = {
  vodorovne: "horizontal", vodorovna: "horizontal", horizontal: "horizontal", waagerecht: "horizontal", waagrecht: "horizontal",
  svisle: "vertical", svisla: "vertical", vertical: "vertical", senkrecht: "vertical", vertikal: "vertical", lotrecht: "vertical", // DE protokol píše „vertikal“
  sikmo: "aligned", sikma: "aligned", aligned: "aligned", schrag: "aligned", parallel: "aligned",
  prumer: "diameter", diameter: "diameter", durchmesser: "diameter",
  polomer: "radius", radius: "radius",
  uhel: "angle", angle: "angle", winkel: "angle",
};
const TITLE_W: Record<string, TitleField> = {
  nazev: "name", name: "name", benennung: "name", titel: "name", bezeichnung: "name",
  cislo: "number", number: "number", nummer: "number", zeichnungsnummer: "number", no: "number",
  kreslil: "author", author: "author", autor: "author", ersteller: "author", gezeichnet: "author", drawn: "author",
  revize: "revision", revision: "revision", index: "revision", rev: "revision",
  datum: "date", date: "date",
  material: "material", werkstoff: "material",
  nepredepsane: "tolerance", tolerance: "tolerance", general: "tolerance", allgemeintoleranz: "tolerance", toleranz: "tolerance",
  hrany: "edges", edges: "edges", kanten: "edges",
  poznamka: "note", note: "note", hinweis: "note", notiz: "note",
};
const PATCH_W: Record<string, keyof AnnPatch> = {
  odsazeni: "offset", offset: "offset", versatz: "offset", abstand: "offset",
  text: "text",
  pripona: "suffix", suffix: "suffix", zusatz: "suffix",
  hodnota: "value", value: "value", wert: "value",
  zakladna: "datum", datum: "datum", bezug: "datum",
  vyska: "height", height: "height", hohe: "height", hoehe: "height",
  posun: "shift", shift: "shift", move: "shift", verschiebung: "shift", verschieben: "shift",
};
const SUBS_MORE: Record<string, "sheet" | "sheets" | "title" | "rev" | "mark" | "mdim" | "edit" | "del" | "detail" | "model"> = {
  ...Object.fromEntries([...SHEET_W].map((w) => [w, "sheet" as const])),
  ...Object.fromEntries([...SHEETS_W].map((w) => [w, "sheets" as const])),
  razitko: "title", titleblock: "title", title: "title", schriftfeld: "title",
  revize: "rev", revision: "rev", revisions: "rev", anderung: "rev", aenderung: "rev", anderungen: "rev", revisionen: "rev",
  znacka: "mark", znacky: "mark", mark: "mark", symbol: "mark", zeichen: "mark",
  kota: "mdim", dim: "mdim", mass: "mdim", bemassung: "mdim",
  upravit: "edit", edit: "edit", bearbeiten: "edit", andern: "edit", aendern: "edit",
  smazat: "del", odstranit: "del", delete: "del", remove: "del", loschen: "del", loeschen: "del", entfernen: "del",
  detail: "detail", einzelheit: "detail",
  model: "model", modell: "model",
};

const isFormat = (t?: RawTok) => !!t && !t.q && /^(a[0-4]|auto)$/i.test(t.s);
const isNumTok = (t?: RawTok) => !!t && !t.q && /^[+\-−]?(\d+([.,]\d*)?|[.,]\d+)$/.test(t.s);
const toNum = (s: string) => Number(s.replace("−", "-").replace(",", "."));
const isKw = (t: RawTok | undefined, set: Set<string>) => !!t && !t.q && !t.key && set.has(fold(t.s));
/** dvě čísla za indexem i (souřadnice); chybí-li, chyba s nápovědou */
function two(rt: RawTok[], i: number, what: string): Vec2 {
  if (!isNumTok(rt[i]) || !isNumTok(rt[i + 1])) throw new Error(tr("{0}: čekám dvě čísla (x y), např. {0} 10 5", what));
  return [toNum(rt[i].s), toNum(rt[i + 1].s)];
}
/** měřítko 2:1, 1:2, 2, auto */
export function parseScale(v: string): number | "auto" {
  const f = fold(v);
  if (f === "auto") return "auto";
  const m = /^(\d+(?:[.,]\d+)?)(?::(\d+(?:[.,]\d+)?))?$/.exec(f);
  const a = m ? parseFloat(m[1].replace(",", ".")) : NaN;
  const b = m?.[2] ? parseFloat(m[2].replace(",", ".")) : 1;
  if (!(a > 0 && b > 0)) throw new Error(tr("měřítko: 1:2, 2:1, 1:1 nebo auto"));
  return a / b;
}
/** odkaz na list: číslo (od 1) nebo název */
const sheetRef = (t: RawTok): SheetRef => (!t.q && /^\d+$/.test(t.s) ? Number(t.s) : t.s);

/** Nové podpříkazy výkresu (listy, razítko, revize, značky, kóty, úpravy, detaily, modely) – null = jiný podpříkaz. */
function parseDrawingMore(rt: RawTok[]): DrawingCmd | null {
  const head = rt[0];
  if (!head || head.q || head.key) return null;
  const sub = SUBS_MORE[fold(head.s)];
  const rest = rt.slice(1);
  // více výkresů dílu a export (w13): výkres nový ["název"] · výkres výkresy … · výkres export pdf [vše|list N]
  if (isKw(head, NEW_DRAWING_W)) return { k: "drawings", op: "new", ...(rest[0] ? { name: rest.map((t) => t.s).join(" ") } : {}) };
  if (isKw(head, DRAWINGS_W)) return parseDrawings(rest);
  if (isKw(head, EXPORT_W)) return parseExport(rest);
  switch (sub) {
    case "sheets":
      return { k: "sheet", op: "list" };
    case "sheet":
      if (isFormat(rest[0])) return null; // „výkres list A3“ = formát listu
      return parseSheet(rest);
    case "title":
      return parseTitle(rest);
    case "rev":
      return parseRev(rest);
    case "mark":
      return parseMark(rest);
    case "mdim":
      return parseManualDim(rest);
    case "edit":
      return parseEdit(rest);
    case "del":
      return parseDel(rest);
    case "detail":
      return parseDetail(rest);
    case "model":
      return parseModel(rest);
    default:
      return null;
  }
}

/** volby listu na konci řádku listu (`výkres list 2 A3 měřítko 1:2`) */
const thenSet = (rt: RawTok[]): DrawingCmd | undefined => (rt.length ? parseSet(rt.map((t) => (t.key ? `${t.key}=${t.s}` : t.s))) : undefined);

function parseSheet(rt: RawTok[]): DrawingCmd {
  const usage = tr("výkres list <číslo|\"název\"> · výkres list nový [\"název\"] · výkres list přejmenovat [<číslo>] \"název\" · výkres list smazat <číslo|\"název\">");
  if (!rt.length) return { k: "sheet", op: "list" };
  const t0 = rt[0];
  if (isKw(t0, NEW_W)) {
    const n = rt[1];
    // název: v uvozovkách, nebo slovo, které nezačíná volbu listu
    const named = !!n && (n.q || (!isFormat(n) && !isOptWord(n.s) && !n.key));
    const then = thenSet(rt.slice(named ? 2 : 1));
    return { k: "sheet", op: "new", ...(named ? { name: n.s } : {}), ...(then ? { then } : {}) };
  }
  if (isKw(t0, RENAME_W)) {
    const args = rt.slice(1);
    if (!args.length) throw new Error(usage);
    if (args.length === 1) return { k: "sheet", op: "rename", name: args[0].s };
    return { k: "sheet", op: "rename", ref: sheetRef(args[0]), name: args.slice(1).map((t) => t.s).join(" ") };
  }
  if (isKw(t0, DEL_W)) {
    if (!rt[1]) throw new Error(usage);
    return { k: "sheet", op: "delete", ref: sheetRef(rt[1]) };
  }
  if (t0.key) throw new Error(usage);
  const then = thenSet(rt.slice(1));
  return { k: "sheet", op: "select", ref: sheetRef(t0), ...(then ? { then } : {}) };
}

function parseDrawings(rt: RawTok[]): DrawingCmd {
  const usage = tr("výkres výkresy · výkres nový [\"název\"] · výkres výkresy <číslo|\"název\"> · výkres výkresy přejmenovat [<číslo>] \"název\" · výkres výkresy smazat <číslo|\"název\">");
  if (!rt.length) return { k: "drawings", op: "list" };
  const t0 = rt[0];
  if (isKw(t0, NEW_W)) return { k: "drawings", op: "new", ...(rt[1] ? { name: rt.slice(1).map((t) => t.s).join(" ") } : {}) };
  if (isKw(t0, RENAME_W)) {
    const args = rt.slice(1);
    if (!args.length) throw new Error(usage);
    if (args.length === 1) return { k: "drawings", op: "rename", name: args[0].s };
    return { k: "drawings", op: "rename", ref: sheetRef(args[0]), name: args.slice(1).map((t) => t.s).join(" ") };
  }
  if (isKw(t0, DEL_W)) {
    if (!rt[1]) throw new Error(usage);
    return { k: "drawings", op: "delete", ref: sheetRef(rt[1]) };
  }
  if (t0.key || rt.length > 1) throw new Error(usage);
  return { k: "drawings", op: "select", ref: sheetRef(t0) };
}

/** `výkres export pdf|dxf|dwg|svg|csv|png [vše|list <číslo|"název">|<číslo>] [R2018]` */
function parseExport(rt: RawTok[]): DrawingCmd {
  const usage = tr("výkres export pdf|dxf|dwg|svg|csv|png [vše|list <číslo|\"název\">] [verze DWG R2000…R2018]");
  const f = rt[0];
  if (!f || !isKw(f, FORMAT_W)) throw new Error(usage);
  const cmd: Extract<DrawingCmd, { k: "export" }> = { k: "export", format: fold(f.s) as DrawingFileFormat };
  for (let i = 1; i < rt.length; i++) {
    const t = rt[i];
    if (isKw(t, ALL_W)) cmd.sheet = "all";
    else if (isKw(t, SHEET_W) && rt[i + 1]) cmd.sheet = isKw(rt[i + 1], ALL_W) ? "all" : sheetRef(rt[++i]);
    else if (!t.q && /^r20\d\d$/i.test(t.s)) cmd.dwgVersion = t.s.toUpperCase();
    else if (!t.q && /^\d+$/.test(t.s)) cmd.sheet = Number(t.s);
    else throw new Error(usage + tr(" – neznámé „{0}“", t.s));
  }
  return cmd;
}

/** `výkres stav [list N|vše]` */
function parseStatus(rt: RawTok[]): DrawingCmd {
  if (!rt.length) return { k: "status" };
  if (isKw(rt[0], ALL_W)) return { k: "status", sheet: "all" };
  const t = isKw(rt[0], SHEET_W) ? rt[1] : rt[0];
  if (!t) throw new Error(tr("výkres stav [list <číslo|\"název\">|vše]"));
  if (isKw(t, ALL_W)) return { k: "status", sheet: "all" };
  return { k: "status", sheet: sheetRef(t) };
}

function parseTitle(rt: RawTok[]): DrawingCmd {
  const fields: Partial<Record<TitleField, string>> = {};
  for (const t of rt) {
    const f = t.key ? TITLE_W[fold(t.key)] : undefined;
    if (!f) throw new Error(tr("výkres razítko název=\"…\" číslo=\"…\" kreslil=\"…\" revize=\"…\" datum=\"…\" materiál=\"…\" [nepředepsané=\"…\" hrany=\"…\" poznámka=\"…\"] – neznámé „{0}“", t.key ? `${t.key}=` : t.s));
    fields[f] = t.s;
  }
  return { k: "title", fields };
}

function parseRev(rt: RawTok[]): DrawingCmd {
  const usage = tr("výkres revize <znak> \"popis změny\" [datum 13.11.2026] [kreslil \"…\"] · výkres revize smazat <znak>");
  if (!rt.length) throw new Error(usage);
  if (isKw(rt[0], DEL_W)) {
    if (!rt[1]) throw new Error(usage);
    return { k: "rev", op: "delete", rev: rt[1].s.toUpperCase() };
  }
  const rev = rt[0].s;
  if (!rev || rt[0].key || !/^[\p{L}\d]{1,4}$/u.test(rev)) throw new Error(usage);
  let date: string | undefined;
  let author: string | undefined;
  const note: string[] = [];
  for (let i = 1; i < rt.length; i++) {
    const t = rt[i];
    const k = fold(t.key ?? (t.q ? "" : t.s));
    const isDate = k === "datum" || k === "date";
    const isAuthor = TITLE_W[k] === "author";
    if (t.key && (isDate || isAuthor)) {
      if (isDate) date = t.s;
      else author = t.s;
    } else if (!t.key && (isDate || isAuthor) && rt[i + 1]) {
      if (isDate) date = rt[++i].s;
      else author = rt[++i].s;
    } else note.push(t.s);
  }
  return { k: "rev", op: "set", rev: rev.toUpperCase(), note: note.join(" "), ...(date ? { date } : {}), ...(author ? { author } : {}) };
}

/** odkaz na pohled za slovem „pohled“: přední…, iso, řez, detail A, "název modelu"; vrátí pohled a počet tokenů */
function viewRef(rt: RawTok[], i: number): [ViewRef, number] {
  const t = rt[i];
  if (!t) throw new Error(tr("chybí pohled – přední, horní, levý, pravý, zadní, spodní, iso, řez, detail A nebo \"název modelu\""));
  const f = fold(t.s);
  if (!t.q && VIEW_WORDS[f]) return [VIEW_WORDS[f], 1];
  // řez lomenou čarou „řez B“ / „řez B-B“ (A–A = řez rovinou), pomocný pohled „B“ / „pomocný B“
  const cutL = isKw(rt[i + 1], AT_W) ? null : /^([b-z])(?:[-–]?\1)?$/i.exec(rt[i + 1]?.s ?? "");
  if (!t.q && SECTION_W.has(f) && cutL) return [`cut:${cutL[1].toUpperCase()}`, 2];
  if (!t.q && ["pomocny", "aux", "auxiliary", "hilfsansicht"].includes(f) && /^[a-z]$/i.test(rt[i + 1]?.s ?? "")) return [`aux:${rt[i + 1].s.toUpperCase()}`, 2];
  if (!t.q && /^[b-z]$/i.test(t.s)) return [`aux:${t.s.toUpperCase()}`, 1];
  if (!t.q && SECTION_W.has(f)) return ["section", /^a-?a$/i.test(rt[i + 1]?.s ?? "") ? 2 : 1];
  if (!t.q && DETAIL_W.has(f)) {
    const l = rt[i + 1];
    if (!l || !/^[a-z]$/i.test(l.s)) throw new Error(tr("detail: zadejte písmeno detailu, např. pohled detail A v 2 3"));
    return [`detail:${l.s.toUpperCase()}`, 2];
  }
  return [`model:${t.s}`, 1];
}

function parseMark(rt0: RawTok[]): DrawingCmd {
  const usage = tr("výkres značka poznámka \"text\" | drsnost Ra 1,6 | tolerance kolmost 0,02 A | základna A | text \"…\" v x y [výška 5] – cíl: na <kóta> | pohled <přední…> v x y; [posun dx dy]");
  const t0 = rt0[0];
  const type = t0 && !t0.q ? MARK_W[fold(t0.s)] : undefined;
  if (!type) throw new Error(usage);
  let rt = rt0.slice(1);
  // posun popisku a výška textu (kdekoli za obsahem)
  let shift: Vec2 | undefined;
  let size: number | undefined;
  for (let i = rt.length - 1; i >= 0; i--) {
    if (isKw(rt[i], SHIFT_W) && isNumTok(rt[i + 1]) && isNumTok(rt[i + 2])) {
      shift = two(rt, i + 1, tr("posun"));
      rt = [...rt.slice(0, i), ...rt.slice(i + 3)];
    } else if (type === "text" && isKw(rt[i], HEIGHT_W) && isNumTok(rt[i + 1])) {
      size = toNum(rt[i + 1].s);
      rt = [...rt.slice(0, i), ...rt.slice(i + 2)];
    }
  }
  // cíl: poslední „na …“ / „pohled …“ (text: i „v x y“ = mm listu)
  let ti = -1;
  for (let i = rt.length - 1; i >= 0; i--) {
    if (isKw(rt[i], ON_W) || isKw(rt[i], VIEW_W) || (type === "text" && isKw(rt[i], AT_W) && isNumTok(rt[i + 1]))) {
      ti = i;
      if (!isKw(rt[i], AT_W) || type === "text") break;
    }
  }
  if (ti < 0) throw new Error(tr("značka: chybí cíl – na <kóta> (např. na Ø40, na a3) nebo pohled přední v x y{0}", type === "text" ? tr(" (text: v x y v mm listu)") : ""));
  const content = rt.slice(0, ti);
  const tt = rt.slice(ti);
  let target: MarkTarget;
  if (isKw(tt[0], ON_W)) {
    const label = tt.slice(1).map((t) => t.s).join(" ").trim();
    if (!label) throw new Error(tr("značka: za „na“ zadejte kótu – popisek (Ø40, 25, M8) nebo id (a3) z výkres stav"));
    target = { on: label };
  } else if (isKw(tt[0], VIEW_W)) {
    const [view, n] = viewRef(tt, 1);
    const j = 1 + n;
    if (!isKw(tt[j], AT_W)) throw new Error(tr("značka: za pohledem zadejte bod – pohled přední v x y (mm modelu v rovině pohledu)"));
    target = { view, at: two(tt, j + 1, tr("bod")) };
    if (tt.length > j + 3) throw new Error(tr("značka: nečekané „{0}“ za bodem", tt[j + 3].s));
  } else {
    target = { sheet: two(tt, 1, tr("bod")) };
    if (tt.length > 3) throw new Error(tr("značka: nečekané „{0}“ za bodem", tt[3].s));
  }
  const words = content.map((t) => t.s);
  let mark: MarkSpec;
  switch (type) {
    case "note":
      if (!words.join("").trim()) throw new Error(tr("poznámka potřebuje text: výkres značka poznámka \"Kalit 58 HRC\" na Ø40"));
      mark = { type, text: words.join(" ") };
      break;
    case "roughness": {
      let ra = words.join(" ").trim();
      if (!ra) throw new Error(tr("drsnost: zadejte hodnotu, např. výkres značka drsnost Ra 1,6 na Ø40"));
      if (/^\d/.test(ra)) ra = `Ra ${ra}`;
      mark = { type, ra };
      break;
    }
    case "gdt": {
      const sym = GDT_WORDS[fold(words[0] ?? "")];
      if (!sym) throw new Error(tr("geometrická tolerance: charakteristika {0} – neznámé „{1}“", Object.keys(GDT_WORDS).filter((_, i) => i % 3 === 0).join(", "), words[0] ?? ""));
      const value = words[1];
      if (!value || !/^[Ø⌀]?[\d.,]+/.test(value)) throw new Error(tr("geometrická tolerance: za charakteristikou zadejte hodnotu, např. tolerance kolmost 0,02 A na Ø40"));
      const datum = words.slice(2).join("").toUpperCase();
      if (datum && !/^[A-Z](?:[-|–]?[A-Z])*$/.test(datum)) throw new Error(tr("geometrická tolerance: základna je písmeno (A, B, A-B) – „{0}“", words.slice(2).join(" ")));
      mark = { type, symbol: sym, value: value.replace(/^⌀/, "Ø"), ...(datum ? { datum } : {}) };
      break;
    }
    case "datum": {
      const l = words.join("").toUpperCase();
      if (l && !/^[A-Z]{1,2}$/.test(l)) throw new Error(tr("základna: písmeno A, B, C… – „{0}“", words.join(" ")));
      mark = { type, ...(l ? { label: l } : {}) };
      break;
    }
    case "text":
      if (!words.join("").trim()) throw new Error(tr("text: výkres značka text \"Kalit 58 HRC\" v 20 30 [výška 5] (mm listu od levého dolního rohu)"));
      if (!("sheet" in target)) throw new Error(tr("text se umisťuje na list: výkres značka text \"…\" v x y (mm listu od levého dolního rohu)"));
      mark = { type, text: words.join(" "), size: size && size > 0 ? size : 3.5 };
      break;
  }
  return { k: "mark", mark, target, ...(shift ? { shift } : {}) };
}

function parseManualDim(rt: RawTok[]): DrawingCmd {
  const usage = tr("výkres kóta vodorovně|svisle|šikmo pohled <p> x1 y1 x2 y2 · kóta průměr|poloměr pohled <p> střed x y [r R] [úhel 45] · kóta úhel pohled <p> x1 y1 x2 y2 x3 y3 x4 y4 – [odsazení 10] [text \"…\"]");
  const kind = rt[0] && !rt[0].q ? DIM_W[fold(rt[0].s)] : undefined;
  if (!kind) throw new Error(usage);
  let i = 1;
  if (isKw(rt[i], VIEW_W)) i++;
  if (!rt[i]) throw new Error(usage);
  const [view, n] = viewRef(rt, i);
  i += n;
  let offset: number | undefined;
  let text: string | undefined;
  let c: Vec2 | undefined;
  let r: number | undefined;
  let ang: number | undefined;
  const nums: number[] = [];
  for (; i < rt.length; i++) {
    const t = rt[i];
    const kv = t.key ? fold(t.key) : null;
    if (kv && OFFSET_W.has(kv)) offset = toNum(t.s);
    else if (kv && TEXT_W.has(kv)) text = t.s;
    else if (isKw(t, OFFSET_W) && isNumTok(rt[i + 1])) offset = toNum(rt[++i].s);
    else if (isKw(t, TEXT_W) && rt[i + 1]) text = rt[++i].s;
    else if (isKw(t, CENTER_W)) {
      c = two(rt, i + 1, tr("střed"));
      i += 2;
    } else if (isKw(t, RADIUS_W) && isNumTok(rt[i + 1])) r = toNum(rt[++i].s);
    else if (isKw(t, ANGLE_W) && isNumTok(rt[i + 1])) ang = toNum(rt[++i].s);
    else if (isNumTok(t)) nums.push(toNum(t.s));
    else if (isKw(t, AT_W) || isKw(t, FILLER_W)) continue;
    else throw new Error(tr("kóta: nečekané „{0}“ – {1}", t.key ? `${t.key}=${t.s}` : t.s, usage));
  }
  if (offset !== undefined && !Number.isFinite(offset)) throw new Error(tr("kóta: odsazení musí být číslo"));
  let dim: ManualDim;
  if (kind === "diameter" || kind === "radius") {
    if (!c && nums.length >= 2) c = [nums[0], nums[1]];
    if (!c) throw new Error(tr("kóta {0}: zadejte střed kružnice – střed x y (mm modelu v rovině pohledu)", kind === "diameter" ? tr("průměr") : tr("poloměr")));
    if (r === undefined && nums.length === 3) r = nums[2];
    dim = { kind, view, c, ...(r !== undefined ? { r } : {}), ...(ang !== undefined ? { ang } : {}) };
  } else if (kind === "angle") {
    if (nums.length !== 8) throw new Error(tr("kóta úhel: zadejte dvě hrany osmi čísly – x1 y1 x2 y2 x3 y3 x4 y4 (mm modelu v rovině pohledu)"));
    dim = { kind, view, l1: [[nums[0], nums[1]], [nums[2], nums[3]]], l2: [[nums[4], nums[5]], [nums[6], nums[7]]] };
  } else {
    if (nums.length !== 4) throw new Error(tr("kóta: zadejte dva body čtyřmi čísly – x1 y1 x2 y2 (mm modelu v rovině pohledu)"));
    dim = { kind, view, p1: [nums[0], nums[1]], p2: [nums[2], nums[3]] };
  }
  return { k: "mdim", dim, ...(offset !== undefined ? { offset } : {}), ...(text !== undefined ? { text } : {}) };
}

function parseEdit(rt: RawTok[]): DrawingCmd {
  const usage = tr("výkres upravit <id|popisek> odsazení=8 text=\"…\" přípona=\"…\" [hodnota=… základna=… výška=… posun=\"dx dy\"]");
  const target = rt.filter((t) => !t.key).map((t) => t.s).join(" ").trim();
  const patch: AnnPatch = {};
  for (const t of rt.filter((x) => x.key)) {
    const k = PATCH_W[fold(t.key!)];
    if (!k) throw new Error(tr("výkres upravit: neznámé „{0}=“ – {1}", t.key, usage));
    if (k === "offset" || k === "height") {
      const n = toNum(t.s);
      if (!Number.isFinite(n)) throw new Error(tr("výkres upravit: {0} musí být číslo", t.key));
      patch[k] = n;
    } else if (k === "shift") {
      const v = t.s.trim().split(/[\s;]+/).map(toNum);
      if (v.length !== 2 || !v.every(Number.isFinite)) throw new Error(tr("výkres upravit: posun=\"dx dy\" (mm listu, y nahoru), např. posun=\"5 -3\""));
      patch.shift = [v[0], v[1]];
    } else patch[k] = t.s;
  }
  if (!target || !Object.keys(patch).length) throw new Error(usage);
  return { k: "edit", target, patch };
}

function parseDel(rt: RawTok[]): DrawingCmd {
  if (!rt.length) throw new Error(tr("výkres smazat <id|popisek> [další id…] · výkres smazat vlastní · výkres smazat vše"));
  if (rt.length === 1 && isKw(rt[0], ALL_W)) return { k: "del", targets: "all" };
  if (rt.length === 1 && isKw(rt[0], CUSTOM_W)) return { k: "del", targets: "custom" };
  const ids = rt.every((t) => !t.q && /^a\d+$/i.test(t.s));
  return { k: "del", targets: ids ? rt.map((t) => t.s.toLowerCase()) : [rt.map((t) => t.s).join(" ")] };
}

function parseDetail(rt: RawTok[]): DrawingCmd {
  const usage = tr("výkres detail <pohled> v x y poloměr r [měřítko 2:1] [umístit x y] · výkres detail <písmeno> měřítko 4:1 | umístit x y · výkres detail smazat <písmeno>");
  if (!rt.length) throw new Error(usage);
  if (isKw(rt[0], DEL_W)) {
    if (!rt[1] || !/^[a-z]$/i.test(rt[1].s)) throw new Error(usage);
    return { k: "detail", op: "delete", label: rt[1].s.toUpperCase() };
  }
  let scale: number | undefined;
  let place: Vec2 | undefined;
  let at: Vec2 | undefined;
  let r: number | undefined;
  const opts = (from: number) => {
    for (let i = from; i < rt.length; i++) {
      const t = rt[i];
      if (isKw(t, SCALE_W) && rt[i + 1]) {
        const s = parseScale(rt[++i].s);
        if (s === "auto") throw new Error(tr("detail: měřítko je číslo, např. 2:1"));
        scale = s;
      } else if (isKw(t, PLACE_W)) {
        place = two(rt, i + 1, tr("umístit"));
        i += 2;
      } else if (isKw(t, AT_W)) {
        at = two(rt, i + 1, tr("střed detailu"));
        i += 2;
      } else if (isKw(t, RADIUS_W) && isNumTok(rt[i + 1])) r = toNum(rt[++i].s);
      else throw new Error(tr("detail: nečekané „{0}“ – {1}", t.s, usage));
    }
  };
  // úprava existujícího detailu: „detail A měřítko 4:1“ (písmeno, které není pohled)
  if (/^[a-z]$/i.test(rt[0].s) && !rt[0].q && !VIEW_WORDS[fold(rt[0].s)]) {
    opts(1);
    if (scale === undefined && !place) throw new Error(usage);
    return { k: "detail", op: "edit", label: rt[0].s.toUpperCase(), ...(scale !== undefined ? { scale } : {}), ...(place ? { place } : {}) };
  }
  const [view, n] = viewRef(rt, 0);
  opts(n);
  if (!at) throw new Error(tr("detail: zadejte střed – v x y (mm modelu v rovině pohledu)"));
  if (!(r !== undefined && r > 0)) throw new Error(tr("detail: zadejte poloměr kruhu detailu – poloměr r (mm modelu)"));
  return { k: "detail", op: "add", view, at, r, ...(scale !== undefined ? { scale } : {}), ...(place ? { place } : {}) };
}

function parseModel(rt: RawTok[]): DrawingCmd {
  const usage = tr("výkres model \"<komponenta|záložka>\" [pohled horní] [měřítko 1:2|auto] · výkres model smazat \"<název>\"");
  if (!rt.length) throw new Error(usage);
  if (isKw(rt[0], DEL_W)) {
    const name = rt.slice(1).map((t) => t.s).join(" ").trim();
    if (!name) throw new Error(usage);
    return { k: "model", op: "delete", name };
  }
  const name: string[] = [];
  let view: ViewKey | "iso" | undefined;
  let scale: number | "auto" | undefined;
  for (let i = 0; i < rt.length; i++) {
    const t = rt[i];
    if (isKw(t, VIEW_W) && rt[i + 1]) {
      const v = VIEW_WORDS[fold(rt[++i].s)];
      if (!v) throw new Error(tr("neznámý pohled „{0}“ – přední, horní, levý, pravý, zadní, spodní, iso", rt[i].s));
      view = v;
    } else if (isKw(t, SCALE_W) && rt[i + 1]) scale = parseScale(rt[++i].s);
    else name.push(t.s);
  }
  if (!name.join("").trim()) throw new Error(usage);
  return { k: "model", op: "add", name: name.join(" ").trim(), ...(view ? { view } : {}), ...(scale !== undefined ? { scale } : {}) };
}
