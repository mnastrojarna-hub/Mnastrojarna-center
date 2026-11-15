/**
 * Textové příkazy předlohy (CS / EN / DE):
 *   předloha "soubor.dwg" [data:…;base64,… | base64]   reference "file.dwg"          vorlage "datei.dwg"
 *   předloha stav                                       reference status              vorlage status
 *   předloha výtah [kóty|díry|kusovník|razítko|poznámky|značky|pohledy|listy|rozpory] [list N] [pohled N.M] [vše]
 *                                                       reference extract [dims|holes|bom|title|notes|symbols|views|sheets|contradictions] [sheet N] [view N.M] [all]
 *                                                       vorlage auszug [maße|bohrungen|stückliste|schriftfeld|notizen|symbole|ansichten|blätter|widersprüche] [blatt N] [ansicht N.M] [alle]
 *   předloha otevřít / odebrat                          reference open / remove       vorlage öffnen / entfernen
 *   porovnat předloha pohled přední [N.M] [list N] [tolerance 0,06] [měřítko 1:2] [se skrytými | bez skrytých] [otočení 90] [zrcadlit] [posun dx dy]
 *                                                       compare reference view front …   vergleichen vorlage ansicht vorne …
 *                                                       (i „porovnat s předlohou“, „compare with reference“, „top view“)
 *   předloha kontrola kót [pohled přední] [N.M] [list N] [tolerance 0,06] [měřítko 1:2]   (i kontrola kót, kontrola kót předlohy)
 *                                                       reference check dimensions …   vorlage maße prüfen …   Maßprüfung
 */
import { tr } from "../i18n";
import type { Align } from "./compare";

export type RefExtractWhat = "all" | "dims" | "holes" | "bom" | "title" | "notes" | "symbols" | "views" | "sheets" | "contradictions" | "balloons";
export type ModelViewKey = "front" | "top" | "left" | "right" | "back" | "bottom";
export type RefCmd =
  | { kind: "load"; name: string; data?: string }
  | { kind: "status" }
  | { kind: "extract"; what: RefExtractWhat; sheet?: number; view?: string; all?: boolean }
  | { kind: "open" }
  | { kind: "remove" }
  | { kind: "compare"; view: ModelViewKey; refView?: string; sheet?: number; tol?: number; hidden?: boolean; align?: Partial<Align>; scale?: number }
  | { kind: "checkDims"; view?: ModelViewKey; refView?: string; sheet?: number; tol?: number; scale?: number };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const W = (...w: string[]) => new Set(w.map(fold));
const REF = W("předloha", "predloha", "předlohu", "předlohou", "předlohy", "předloze", "reference", "referenz", "vorlage", "vorlagen");
/** výplňová slova před předlohou: porovnat s předlohou, compare with reference, vergleichen mit vorlage */
const WITH = W("s", "se", "with", "to", "against", "mit", "gegen", "zur", "zu", "der", "the");
const COMPARE = W("porovnat", "porovnej", "porovnání", "compare", "comparison", "vergleichen", "vergleiche", "vergleich");
const CHECK = W("kontrola", "kontrolu", "zkontrolovat", "zkontroluj", "check", "prüfen", "prufen", "pruefen", "prüfung", "pruefung", "prüfe");
const DIMS = W("kót", "kot", "kóty", "koty", "dims", "dimensions", "dimension", "maße", "masse", "maß", "mass", "bemaßung", "bemassung");
/** jednoslovné názvy kontroly kót (DE pás karet výkresu „Maßprüfung“, EN „dimension check“ píše se i dohromady) */
const CHECK1 = W("maßprüfung", "massprüfung", "masspruefung", "dimcheck", "kontrolakót");
const SCALE = W("měřítko", "meritko", "scale", "maßstab", "massstab");
const HIDDEN = W("se-skrytými", "se-skrytymi", "skryté", "skryte", "hidden", "with-hidden", "mit-verdeckten", "verdeckte");
const STATUS = W("stav", "status", "zustand");
const EXTRACT = W("výtah", "vytah", "extract", "auszug", "extrakt");
const OPEN = W("otevřít", "otevrit", "open", "öffnen", "offnen", "oeffnen", "zobrazit", "show", "anzeigen");
const REMOVE = W("odebrat", "odstranit", "smazat", "remove", "delete", "entfernen", "löschen", "loschen");
const VIEW = W("pohled", "view", "ansicht");
const SHEET = W("list", "sheet", "blatt");
const TOL = W("tolerance", "tol", "toleranz");
const NOHIDDEN = W("bez-skrytych", "bez-skrytých", "nohidden", "no-hidden", "ohne-verdeckte");
const MIRROR = W("zrcadlit", "zrcadlově", "mirror", "spiegeln");
const ROT = W("otočení", "otoceni", "rotation", "rotate", "drehung");
const OFFSET = W("posun", "offset", "versatz");
const ALL = W("vše", "vse", "all", "alle");
const WHAT: [RefExtractWhat, Set<string>][] = [
  ["dims", W("kóty", "koty", "kót", "dims", "dimensions", "maße", "masse")],
  ["holes", W("díry", "diry", "holes", "bohrungen", "löcher")],
  ["bom", W("kusovník", "kusovnik", "bom", "stückliste", "stuckliste", "partlist")],
  ["title", W("razítko", "razitko", "razítka", "title", "titleblock", "schriftfeld")],
  ["notes", W("poznámky", "poznamky", "notes", "notizen", "hinweise")],
  ["symbols", W("značky", "znacky", "symbols", "symbole", "drsnost", "roughness")],
  ["views", W("pohledy", "views", "ansichten")],
  ["sheets", W("listy", "sheets", "blätter", "blatter")],
  ["contradictions", W("rozpory", "contradictions", "widersprüche", "widerspruche")],
  ["balloons", W("pozice", "balónky", "balonky", "balloons", "positionen")],
];
const VIEWS: Record<string, ModelViewKey> = {
  predni: "front", front: "front", vorne: "front", vorderansicht: "front",
  horni: "top", top: "top", oben: "top", draufsicht: "top",
  levy: "left", left: "left", links: "left",
  pravy: "right", right: "right", rechts: "right",
  zadni: "back", back: "back", hinten: "back",
  spodni: "bottom", dolni: "bottom", bottom: "bottom", unten: "bottom",
};

const VIEW_NAMES = (): Record<ModelViewKey, string> => ({ front: tr("přední"), top: tr("horní"), left: tr("levý"), right: tr("pravý"), back: tr("zadní"), bottom: tr("spodní") });
/** název pohledu modelu v jazyce rozhraní */
export const viewName = (v: ModelViewKey | string) => VIEW_NAMES()[v as ModelViewKey] ?? v;

/** slova řádku; text v uvozovkách je jedno slovo */
function words(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|„([^“”"]*)[“”"]|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
const num = (s: string | undefined) => {
  const v = parseFloat(String(s ?? "").replace(",", "."));
  return Number.isFinite(v) ? v : undefined;
};
const isRefViewId = (s: string) => /^\d+\.\d+$/.test(s);

/** příznaky vlastní předlohy na řádku (předloha / kontrola / kót / porovnat) – zbytek jsou volby */
const isWord = (set: Set<string>) => (x: string | undefined) => set.has(fold(x ?? ""));

/**
 * Řádek patří předloze, ne kontrole / porovnání modelu (agent-check.ts): `kontrola kót …`, `porovnat [s] předlohou …`
 * (EN `check dimensions`, `compare with reference`, DE `Maße prüfen`, `vergleichen mit Vorlage`).
 */
export function isReferenceLine(line: string): boolean {
  const w = words(line.trim());
  if (w.length < 2) return CHECK1.has(fold(w[0] ?? ""));
  const h = fold(w[0]);
  if (CHECK1.has(h) || (CHECK.has(h) && isWord(DIMS)(w[1])) || (DIMS.has(h) && isWord(CHECK)(w[1]))) return true;
  if (!COMPARE.has(h)) return false;
  let i = 1;
  while (i < w.length && WITH.has(fold(w[i])) && !isWord(REF)(w[i])) i++;
  return isWord(REF)(w[i]);
}

/** řádek příkazu předlohy → příkaz (null = jiný příkaz) */
export function parseReferenceLine(line: string): RefCmd | null {
  const w = words(line.trim());
  if (!w.length) return null;
  const h = fold(w[0]);
  const isRef = isWord(REF);
  const isCheck = isWord(CHECK);
  const isDims = isWord(DIMS);
  // kontrola kót / check dimensions / maße prüfen / Maßprüfung – i „kontrola kót předlohy“, „dimension check“
  if (CHECK1.has(h)) return parseCheck(w.slice(1));
  if ((isCheck(w[0]) && isDims(w[1])) || (isDims(w[0]) && isCheck(w[1]))) return parseCheck(w.slice(2));
  // porovnat předloha / porovnat s předlohou / compare reference / compare with reference / vergleichen mit vorlage
  if (COMPARE.has(h)) {
    let i = 1;
    while (i < w.length && WITH.has(fold(w[i])) && !isRef(w[i])) i++;
    if (isRef(w[i])) return parseCompare(w.slice(i + 1));
    if (w.length === 1) throw new Error(tr("porovnání s předlohou: porovnat předloha pohled přední [N.M] [tolerance 0,06]"));
    return null;
  }
  // samotné slovo (seznam příkazů v nápovědě) – nápověda místo „neznámý příkaz“
  if (w.length === 1 && CHECK.has(h)) throw new Error(tr("kontrola kót předlohy proti modelu: předloha kontrola kót [pohled přední] [N.M]"));
  if (!isRef(w[0])) return null;
  const sub = fold(w[1] ?? "");
  if (!w[1]) return { kind: "status" };
  // předloha kontrola kót / reference check dimensions / vorlage maße prüfen / reference dimension check
  if (CHECK1.has(sub)) return parseCheck(w.slice(2));
  if ((isCheck(w[1]) && isDims(w[2])) || (isDims(w[1]) && isCheck(w[2]))) return parseCheck(w.slice(3));
  if (COMPARE.has(sub)) return parseCompare(w.slice(2));
  if (STATUS.has(sub)) return { kind: "status" };
  if (OPEN.has(sub)) return { kind: "open" };
  if (REMOVE.has(sub)) return { kind: "remove" };
  if (EXTRACT.has(sub)) {
    const c: Extract<RefCmd, { kind: "extract" }> = { kind: "extract", what: "all" };
    for (let i = 2; i < w.length; i++) {
      const x = fold(w[i]);
      const what = WHAT.find(([, s]) => s.has(x));
      if (what) c.what = what[0];
      else if (SHEET.has(x)) c.sheet = num(w[++i]);
      else if (VIEW.has(x)) c.view = w[++i];
      else if (isRefViewId(w[i])) c.view = w[i];
      else if (ALL.has(x)) c.all = true;
      else throw new Error(tr("předloha výtah: neznámá volba „{0}“ – kóty, díry, kusovník, razítko, poznámky, značky, pohledy, listy, rozpory, pozice, list N, pohled N.M, vše", w[i]));
    }
    return c;
  }
  if (VIEW.has(sub)) throw new Error(tr("porovnání s předlohou: porovnat předloha pohled přední [N.M] [tolerance 0,06]"));
  // předloha "soubor.dwg" [data] – název i bez přípony (připojené soubory se hledají i podle názvu bez přípony)
  const name = w[1];
  const rest = w.slice(2);
  // „předloha "x.dxf" stav“ = připojit (výpis stavu je součástí připojení)
  if (rest.length && STATUS.has(fold(rest[rest.length - 1]))) rest.pop();
  if (rest.length > 1) throw new Error(tr("předloha: neznámá volba „{0}“", rest[1]));
  const data = rest[0];
  if (data !== undefined && !/^data:/i.test(data) && !/^[A-Za-z0-9+/_-]{16,}={0,2}$/.test(data)) throw new Error(tr("předloha „{0}“: neznámá volba „{1}“ – za názvem souboru smí být jen data souboru (data URL nebo base64); další příkazy: předloha stav | výtah | kontrola kót | otevřít | odebrat", name, data));
  return { kind: "load", name, ...(data ? { data } : {}) };
}

function parseCompare(w: string[]): RefCmd {
  const c: Extract<RefCmd, { kind: "compare" }> = { kind: "compare", view: "front" };
  let view: ModelViewKey | null = null;
  for (let i = 0; i < w.length; i++) {
    const x = fold(w[i]);
    if (VIEW.has(x)) {
      const v = VIEWS[fold(w[i + 1] ?? "")];
      // „top view“: název pohledu před slovem pohled
      if (!v && view) continue;
      if (!v) throw new Error(tr("porovnat předloha: pohled přední, horní, levý, pravý, zadní nebo spodní (ne „{0}“)", w[i + 1] ?? ""));
      view = v;
      i++;
    } else if (VIEWS[x]) view = VIEWS[x];
    else if (SCALE.has(x)) c.scale = parseScaleArg(w[++i]);
    else if (HIDDEN.has(x) || ((x === "se" || x === "s" || x === "with" || x === "mit") && /^(skryt|hidden|verdeckt)/.test(fold(w[i + 1] ?? "")))) {
      c.hidden = true;
      if (!HIDDEN.has(x)) i++;
    }
    else if (isRefViewId(w[i])) c.refView = w[i];
    else if (SHEET.has(x)) c.sheet = num(w[++i]);
    else if (TOL.has(x)) {
      const t = num(w[++i]);
      if (!t || t <= 0) throw new Error(tr("tolerance: kladné číslo v mm (např. 0,06)"));
      c.tol = t;
    } else if (NOHIDDEN.has(x) || (x === "bez" && /^skryt/.test(fold(w[i + 1] ?? "")))) {
      c.hidden = false;
      if (x === "bez") i++;
    } else if (MIRROR.has(x)) c.align = { ...c.align, mirror: true };
    else if (ROT.has(x)) {
      const r = num(w[++i]);
      if (r === undefined || ((r % 90) + 90) % 90 !== 0) throw new Error(tr("otočení: násobek 90°"));
      c.align = { ...c.align, rot: ((r % 360) + 360) % 360 };
    } else if (OFFSET.has(x)) {
      const dx = num(w[++i]);
      const dy = num(w[++i]);
      if (dx === undefined || dy === undefined) throw new Error(tr("posun: dvě čísla dx dy (mm)"));
      c.align = { ...c.align, dx, dy };
    } else throw new Error(tr("porovnat předloha: neznámá volba „{0}“", w[i]));
  }
  if (!view) throw new Error(tr("porovnat předloha: chybí pohled modelu – porovnat předloha pohled přední [N.M] [tolerance 0,06]"));
  c.view = view;
  return c;
}

/** měřítko z příkazu: 1:2 / 2:1 / 0,5 → jednotky geometrie na 1 mm skutečné velikosti (1:2 → 0,5) */
function parseScaleArg(a: string | undefined): number {
  const m = /^(\d+(?:[.,]\d+)?)\s*:\s*(\d+(?:[.,]\d+)?)$/.exec(a ?? "");
  const v = m ? num(m[1])! / num(m[2])! : num(a);
  if (!v || !(v > 0) || !Number.isFinite(v)) throw new Error(tr("měřítko: 1:2, 2:1 nebo kladné číslo (ne „{0}“)", a ?? ""));
  return v;
}

function parseCheck(w: string[]): RefCmd {
  const c: Extract<RefCmd, { kind: "checkDims" }> = { kind: "checkDims" };
  for (let i = 0; i < w.length; i++) {
    const x = fold(w[i]);
    if (VIEW.has(x)) {
      const v = VIEWS[fold(w[i + 1] ?? "")];
      if (!v && c.view) continue;
      if (!v) throw new Error(tr("kontrola kót: pohled přední, horní, levý, pravý, zadní nebo spodní (ne „{0}“)", w[i + 1] ?? ""));
      c.view = v;
      i++;
    } else if (VIEWS[x]) c.view = VIEWS[x];
    else if (isRefViewId(w[i])) c.refView = w[i];
    else if (SHEET.has(x)) c.sheet = num(w[++i]);
    else if (TOL.has(x)) c.tol = num(w[++i]);
    else if (SCALE.has(x)) c.scale = parseScaleArg(w[++i]);
    else if (REF.has(x) || WITH.has(x) || CHECK.has(x) || DIMS.has(x)) continue;
    else throw new Error(tr("kontrola kót: neznámá volba „{0}“", w[i]));
  }
  return c;
}

/** řádky do seznamu příkazů (AGENT_COMMANDS) a návodu */
export const REFERENCE_COMMANDS: { cmd: string; en: string; de: string; desc: string }[] = [
  {
    cmd: 'předloha "výkres.dwg" [data:…;base64,…] · předloha stav · předloha výtah [kóty|díry|kusovník|razítko|poznámky|značky|pozice|pohledy|listy|rozpory] [list N] [pohled N.M] [vše] · předloha otevřít|odebrat',
    en: "reference, reference status, reference extract, reference open, reference remove",
    de: "vorlage, vorlage status, vorlage auszug, vorlage öffnen, vorlage entfernen",
    desc: tr("předloha = výkres zákazníka DWG / DXF / vektorové PDF připojený k dokumentu (soubor připojte v konzoli tlačítkem „Připojit soubor…“ nebo window.mncad.attach): listy, pohledy, měřítka, kóty s tolerancí / uložením / počtem a změřenou hodnotou (rozpor „text ≠ geometrie“), díry i normálie AutoCAD Mechanical, kusovník, pozice, razítka, poznámky, drsnost, tolerance tvaru, rozpory; otevřít = jako 2D výkres v nové záložce"),
  },
  {
    cmd: "porovnat předloha pohled přední|horní|levý|pravý|zadní|spodní [N.M] [list N] [tolerance 0,06] [měřítko 1:2] [se skrytými|bez skrytých] [otočení 90] [zrcadlit] [posun dx dy]",
    en: "compare reference view",
    de: "vergleichen vorlage ansicht",
    desc: tr("kontrola 1:1: pohled modelu (promítnutý jako ve výkrese) proti obrysu pohledu předlohy (bez os, kót, šraf, tenkých a konstrukčních čar) – pokrytí v toleranci (výchozí 0,06 mm) oběma směry, úseky mimo toleranci s polohou a obrázek SVG překryvu (stáhne se); bez N.M se najde nejlépe odpovídající pohled předlohy, zadaný N.M bez kontroly velikosti; ✓ obě pokrytí ≥ 99,5 %, ✗ i model s geometrií navíc"),
  },
  {
    cmd: "předloha kontrola kót [pohled přední] [N.M] [list N] [tolerance 0,06] [měřítko 1:2] · kontrola kót …",
    en: "reference check dimensions, check dimensions",
    de: "vorlage maße prüfen, maße prüfen",
    desc: tr("kóty předlohy proti modelu: každá kóta se změří v modelu mezi stejnými body (rozměry, rozteče děr, Ø, R, i od virtuálního rohu) → ✓ / ✗ s hodnotou modelu, ⚠ bez bodu v modelu; u výkresu více dílů jen list, který modelu odpovídá; výsledek se uloží do dokumentu (po změně modelu zastaralý); kontrolu kót vlastního výkresu ukazuje výkres stav"),
  },
];
