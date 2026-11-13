/**
 * Textové příkazy výkresu (čistý parser – bez jádra, testovatelný v Node):
 * - `výkres [A4|A3|A2|A1|A0] [na šířku|na výšku] [měřítko 1:2|auto] [pohledy přední,horní,iso] [řez XZ [odsazení N]|ne]
 *   [skryté ano|ne] [osy ano|ne] [tabulka děr ano|ne] [promítání E|A]` – volby listu (tabulka VOLBY, další volba = řádek);
 * - `kótovat [chytře|celkově|nic] [řetězově|od základny]` – (pře)generuje Chytré kóty;
 * - `výkres tolerance <kóta> <tolerance>`, `výkres poznámka "…"`, `výkres nepředepsané ISO 2768-mK`, `výkres hrany …`,
 *   `výkres drsnost Ra 3,2`, `výkres stav`.
 * Česky, anglicky (drawing, dimension) i německy (zeichnung, bemaßen). Provedení: cad/drawing-agent.ts.
 */
import { tr } from "./i18n";
import type { DrawingOptions, ViewKey } from "./drawing";
import type { PlaneName } from "./types";

export type DrawingCmd =
  /** volby listu (výkres A3 …) */
  | { k: "set"; opts: Partial<DrawingOptions>; summary: string[] }
  /** kótovat chytře / celkově / nic, řetězově / od základny */
  | { k: "dim"; mode: "smart" | "overall" | "none"; style?: "chain" | "baseline" }
  /** tolerance ke kótě podle popisku / hodnoty */
  | { k: "tol"; target: string; tol: string }
  /** údaje u razítka: poznámka, nepředepsané tolerance, hrany, drsnost */
  | { k: "meta"; field: "note" | "tolerance" | "edges" | "roughness"; value: string }
  | { k: "status" };

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
      if (["odsazeni", "offset", "versatz", "posun"].includes(fold(t[i + 2] ?? ""))) {
        offset = parseFloat((t[i + 3] ?? "").replace(",", "."));
        if (!Number.isFinite(offset)) throw new Error(tr("řez: odsazení musí být číslo"));
        n = 4;
      }
      o.section = { plane, offset };
      sum.push(tr("řez {0} odsazení {1}", plane, String(offset).replace(".", ",")));
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

/** Příkaz „výkres …“ (tokeny za slovem výkres) → povel; prázdné = jen otevřít výkres (null). */
export function parseDrawing(tokens: string[]): DrawingCmd | null {
  if (!tokens.length) return null;
  const sub = SUB[fold(tokens[0])];
  const rest = tokens.slice(1).join(" ").trim();
  if (sub === "status") return { k: "status" };
  if (sub === "tol") {
    if (tokens.length < 3) throw new Error(tr("výkres tolerance <kóta> <tolerance> – např. výkres tolerance Ø40 h6 · výkres tolerance 25 ±0,1 · výkres tolerance M8 6H"));
    return { k: "tol", target: tokens[1], tol: tokens.slice(2).join(" ") };
  }
  if (sub === "note" || sub === "tolerance" || sub === "edges" || sub === "roughness") {
    if (!rest && sub !== "note") throw new Error(tr("výkres {0} potřebuje text, např. {1}", tokens[0], sub === "tolerance" ? "ISO 2768-mK" : sub === "edges" ? "ISO 13715 -0,3" : "Ra 3,2"));
    return { k: "meta", field: sub, value: rest };
  }
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
    if (!row) throw new Error(tr("neznámá volba výkresu „{0}“ – volby: A4…A0, na šířku / na výšku, {1}; podpříkazy: tolerance, poznámka, nepředepsané, hrany, drsnost, stav", tokens[i], VOLBY.map((r) => r.help()).join(", ")));
    i += row.read(tokens, i, o, sum);
  }
  return { k: "set", opts: o, summary: sum };
}

/** Příkaz „kótovat …“ → povel (výchozí chytře, řetězově). */
export function parseDimension(tokens: string[]): DrawingCmd {
  let mode: "smart" | "overall" | "none" = "smart";
  let style: "chain" | "baseline" | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const w = fold(tokens[i]);
    if (["chytre", "smart", "intelligent", "auto", "automaticky"].includes(w)) mode = "smart";
    else if (["celkove", "overall", "gesamt", "gesamtmasse", "aussenmasse"].includes(w)) mode = "overall";
    else if (NO.has(w) || w === "nic") mode = "none";
    else if (["retezove", "chain", "kette", "kettenmass", "ketten"].includes(w)) style = "chain";
    else if (["baseline", "basis", "bezug", "bezugsmass", "zakladny", "zakladna"].includes(w)) style = "baseline";
    else if (w === "od" && ["zakladny", "zakladna"].includes(fold(tokens[i + 1] ?? ""))) {
      style = "baseline";
      i++;
    } else throw new Error(tr("kótovat [chytře|celkově|nic] [řetězově|od základny] – neznámé slovo „{0}“", tokens[i]));
  }
  return { k: "dim", mode, ...(style ? { style } : {}) };
}
