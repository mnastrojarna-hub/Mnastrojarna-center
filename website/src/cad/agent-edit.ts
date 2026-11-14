/**
 * Úpravy EXISTUJÍCÍHO modelu textem (konzole „Textové příkazy“, `window.mncad.run`) – vše, co člověk dělá ve stromu prvků,
 * v panelu Proměnné / Stavy a ve skicáři nad hotovou skicou:
 *
 * - prvky historie: `upravit <prvek> klíč=hodnota …` / `upravit <prvek> {JSON}` (i vazba na proměnné `klíč==výraz`, plochy a hrany
 *   pravidlem nad tělesem PŘED prvkem), `potlačit` / `zapnout`, `smazat <prvek>`, `přejmenovat … na …`, `přesunout … před|za|nahoru|dolů`,
 *   `duplikovat … [jako …]`;
 * - historie dokumentu: `zpět [N]` / `znovu [N]` (skutečné kroky historie – jeden běh `run` = jeden krok; provádí cad-app.tsx přes `histStep`);
 * - proměnné a konfigurace (stavy dílu): `proměnná d = 20`, `proměnné`, `konfigurace "Krátká" t=10 potlačit "Díra 1"`, `konfigurace aktivní …`;
 * - existující skica: `skica "Skica 1"` (cíl dalších řádků), `entita e3 klíč=hodnota`, `smazat e3 v1 k2`, `kóta k1 65|referenční|řídicí`,
 *   `odsadit e1 5 [ven|dovnitř] [řetězec]`, `promítnout hrany E3;E7|vše [pomocné]`.
 *
 * Čisté funkce bez prohlížeče (testovatelné v Node); co potřebuje jádro (topologie pro pravidla, otisky výběru, hrany modelu),
 * dostanou jako rozhraní `EditKernel`. Slova příkazů platí česky, anglicky i německy bez ohledu na jazyk rozhraní.
 */
import { addWithAutoClose } from "./poly-close";
import type { EdgeLite, FaceLite } from "./agent";
import { describeConstraint, describeDim, entityText, solveSketchFeature, targetSketch, withTextIds, type SketchTarget } from "./agent-sketch";
import { getExt, type ExtParam } from "./ext/registry";
import { toAxisDef, toDirection } from "./ext/place";
import { getLang, tr } from "./i18n";
import { evalExpr, exprRefs, getPath as numAt, resolveVariables, VAR_NAME } from "./params";
import { pickFieldsOf } from "./pick-fields";
import { EXTRUDE_EDIT_FIELDS, extrudeFieldValue } from "./agent-extr";
import { measureDim } from "./sketch-solver";
import { offsetEntity } from "./sketch-ops";
import { isSplineTangentKey, patchSplineTangentKey } from "./agent-surfaces";
import { changedHoleKeys, holeFieldRules } from "./agent-hole";
import { chainOf, offsetChain, projectModelLines, type ChainSeg } from "./sketch-tools";
import { uid, type CadDoc, type Config, type Feature, type SketchConstraint, type SketchDim, type SketchEntity, type Vec2, type Vec3 } from "./types";

type SketchF = Extract<Feature, { type: "sketch" }>;

/* ───────────────────────── příkazy ───────────────────────── */
export type MoveWhere = { kind: "before"; ref: string } | { kind: "after"; ref: string } | { kind: "up"; n: number } | { kind: "down"; n: number } | { kind: "start" } | { kind: "end" };
export type EditCmd =
  /** `upravit <prvek> klíč=hodnota …` (pairs) nebo `upravit <prvek> {JSON záplata}` (patch); bez klíčů = výpis parametrů */
  | { kind: "edit"; target: string; pairs: [string, string][]; patch?: Record<string, unknown> }
  /** potlačit (on = true) / zapnout (on = false) */
  | { kind: "suppress"; targets: string[]; on: boolean }
  /** `smazat <prvek> …` – nebo položky skici (e3, v1, k2): rozhodne se podle toho, co ve skici / historii je */
  | { kind: "delete"; targets: string[] }
  | { kind: "rename"; target: string; name: string }
  | { kind: "move"; target: string; where: MoveWhere }
  | { kind: "duplicate"; target: string; name?: string }
  /** skutečná historie dokumentu (provádí aplikace přes `histStep`) */
  | { kind: "undo" | "redo"; n: number }
  | { kind: "var"; name: string; expr: string; note?: string }
  | { kind: "varDelete"; name: string }
  | { kind: "vars" }
  /** založí / přepíše konfiguraci: hodnoty proměnných (výrazy), potlačené prvky (undefined = beze změny) */
  | { kind: "config"; name: string; values: [string, string][]; suppress?: string[] }
  | { kind: "configActive"; name: string | null }
  | { kind: "configDelete"; name: string }
  | { kind: "configs" }
  /** `skica "Skica 1"` – existující skica jako cíl dalších řádků bloku; `target.id` doplní provedení */
  | { kind: "openSketch"; name: string; target: SketchTarget }
  | { kind: "entity"; id: string; pairs: [string, string][] }
  | { kind: "dimEdit"; id: string; value?: number; driving?: boolean }
  | { kind: "offset"; ids: string[]; dist: number; side: "out" | "in" | "left" | "right"; chain: boolean }
  /** edges: indexy hran (E3 → 2), „all“ = všechny hrany (kolmý průmět), „plane“ = hrany v rovině skici */
  | { kind: "project"; edges: number[] | "all" | "plane"; construction: boolean };
/** operace programu (AgentOp v agent.ts); `sketch` = skica bloku u úprav skici */
export type EditOp = { k: "edit"; cmd: EditCmd; line: number; sketch?: SketchTarget };
/** výsledek rozboru řádku: `pop` = smazat poslední prvek (dosavadní operace); `block` = co s blokem skici; `entities` = text za dvojtečkou */
export type EditParse = { pop: true } | { cmd: EditCmd; block: "end" | "keep" | "open"; entities?: string };

/* ───────────────────────── pomocné ───────────────────────── */
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const isNum = (t: string) => /^[+-]?(\d+[.,]?\d*|[.,]\d+)(mm|°)?$/i.test(t.trim());
const num = (t: string) => parseFloat(t.trim().replace(",", "."));
const fmt = (v: number) => {
  const s = String(Math.round(v * 1000) / 1000).replace(/^-0$/, "0");
  return getLang() === "en" ? s : s.replace(".", ",");
};
/** slova oddělená mezerami a středníky; text v uvozovkách je jedno slovo */
function words(text: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|„([^“]*)“|'([^']*)'|([^\s;]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  return out;
}
/** hodnota `klíč=hodnota`: číslo, ano/ne, seznam `a;b;c`, JSON `[…]` / `{…}`, jinak text (jako u příkazu `prvek`) */
export function parseValue(raw: string): unknown {
  const t = raw.trim();
  if (/^[[{]/.test(t)) {
    try {
      return JSON.parse(t);
    } catch {
      throw new Error(tr("hodnotu „{0}“ nelze přečíst jako JSON", t));
    }
  }
  const f = fold(t);
  if (["ano", "true", "yes", "ja", "on"].includes(f)) return true;
  if (["ne", "false", "no", "nein", "off"].includes(f)) return false;
  if (t.includes(";")) return t.split(";").map((x) => parseValue(x));
  if (isNum(t)) return num(t);
  return t;
}
/** `klíč=hodnota klíč="text s mezerami" klíč=[1, 2] klíč={"a":{"b":1}}` → dvojice (JSON do 4 úrovní vnoření) */
export function keyValues(text: string): [string, string][] {
  const out: [string, string][] = [];
  const re = /([^\s=]+)=("[^"]*"|„[^“]*“|\[(?:[^[\]]|\[[^[\]]*\])*\]|\{(?:[^{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*\}|\S*)/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(text))) {
    const gap = text.slice(last, m.index).trim();
    if (gap) throw new Error(tr("„{0}“ není ve tvaru klíč=hodnota", gap));
    out.push([m[1], m[2].replace(/^["„]|["“]$/g, "")]);
    last = re.lastIndex;
  }
  const rest = text.slice(last).trim();
  if (rest) throw new Error(tr("„{0}“ není ve tvaru klíč=hodnota", rest));
  return out;
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const getAt = (o: unknown, path: string[]): unknown => path.reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), o);
function setAt(o: Record<string, unknown>, path: string[], v: unknown) {
  let cur = o;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = /^\d+$/.test(path[i + 1]) ? [] : {};
    cur = cur[k] as Record<string, unknown>;
  }
  if (v === undefined) delete cur[path[path.length - 1]];
  else cur[path[path.length - 1]] = v;
}
/** RFC 7386: objekty se slučují, `null` pole odstraní, ostatní hodnoty nahradí */
function mergePatch(target: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete target[k];
    else if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object" && !Array.isArray(target[k])) mergePatch(target[k] as Record<string, unknown>, v as Record<string, unknown>);
    else target[k] = v;
  }
}
/** ano / ne v jazyce rozhraní (obojí je i platný vstup hodnoty) */
const YES_NO = { cs: ["ano", "ne"], en: ["yes", "no"], de: ["ja", "nein"] } as const;
/** hodnota pro protokol: čísla s desetinnou čárkou, vektory [a; b], odkazy na prvky názvem, dlouhý JSON zkrácený */
function show(v: unknown, doc?: CadDoc): string {
  if (v === undefined || v === null) return "–";
  if (typeof v === "number") return fmt(v);
  if (typeof v === "boolean") return YES_NO[getLang()][v ? 0 : 1];
  if (typeof v === "string") {
    const f = doc?.features.find((x) => x.id === v);
    return f ? `„${f.name}“` : v;
  }
  if (Array.isArray(v) && v.every((x) => typeof x === "number")) return `[${v.map(fmt).join("; ")}]`;
  const s = JSON.stringify(v);
  return s.length > 70 ? s.slice(0, 67) + "…" : s;
}
const nameList = (doc: CadDoc, pred: (f: Feature) => boolean = () => true) => {
  const list = doc.features.filter(pred).map((x) => x.name);
  return (list.length > 40 ? [...list.slice(0, 40), "…"] : list).join(", ") || "—";
};

/* ───────────────────────── slova příkazů (CS / EN / DE) ───────────────────────── */
const W = (...w: string[]) => new Set(w.map(fold));
const EDIT = W("upravit", "uprav", "změnit", "zmenit", "edit", "modify", "change", "bearbeiten", "ändern", "aendern");
const SUPPRESS = W("potlačit", "potlacit", "suppress", "unterdrücken", "unterdruecken");
const UNSUPPRESS = W("zapnout", "unsuppress", "aktivieren", "reaktivieren");
const DELETE = W("smazat", "odstranit", "delete", "remove", "del", "löschen", "loeschen", "entfernen");
const LAST = W("poslední", "posledni", "last", "letzte", "letzter", "letztes", "$last");
const RENAME = W("přejmenovat", "prejmenovat", "rename", "umbenennen");
const RENAME_TO = W("na", "to", "zu", "in", "als", "->", "→");
const MOVE = W("přesunout", "presunout", "posunout", "move", "verschieben");
const DUPLICATE = W("duplikovat", "duplicate", "dup", "duplizieren");
const AS = W("jako", "as", "als");
const UNDO = W("zpět", "zpet", "undo", "rückgängig", "rueckgaengig", "zurück", "zurueck");
const REDO = W("znovu", "redo", "wiederherstellen");
const VAR = W("proměnná", "promenna", "variable", "var", "variabel");
const VARS = W("proměnné", "promenne", "variables", "variablen", "vars");
const NOTE = W("poznámka", "poznamka", "note", "notiz");
const CONFIG = W("konfigurace", "config", "configuration", "configs", "configurations", "konfiguration", "konfigurationen", "varianta", "varianty", "variant", "variants", "variante", "varianten");
const ACTIVE = W("aktivní", "aktivni", "aktivovat", "active", "activate", "aktiv", "aktivieren");
const NONE = W("žádná", "zadna", "žádné", "zadne", "nic", "výchozí", "vychozi", "none", "default", "keine", "kein", "standard", "-");
const SKETCH = W("skica", "náčrt", "nacrt", "sketch", "skizze");
const ENTITY = W("entita", "entity", "objekt");
const DIM = W("kóta", "kota", "dim", "bemaßung", "bemassung", "maß", "mass");
const OFFSET = W("odsadit", "offset", "versetzen");
const PROJECT = W("promítnout", "promitnout", "project", "projizieren");
const REF = W("referenční", "referencni", "reference", "ref", "referenz", "driven");
const DRIVE = W("řídicí", "ridici", "řídící", "ridici", "driving", "steuernd");
const OUT = W("ven", "vně", "vne", "out", "outside", "außen", "aussen");
const IN = W("dovnitř", "dovnitr", "uvnitř", "uvnitr", "in", "inside", "innen");
const LEFT = W("vlevo", "doleva", "left", "links");
const RIGHT = W("vpravo", "doprava", "right", "rechts");
const CHAIN = W("řetězec", "retezec", "řetěz", "retez", "chain", "kette");
const EDGES = W("hrany", "hrana", "edges", "edge", "kanten", "kante");
const ALL = W("vše", "vse", "všechny", "vsechny", "all", "alle");
const IN_PLANE = W("rovina", "v rovině", "rovine", "plane", "inplane", "ebene");
const CONSTRUCTION = W("pomocné", "pomocne", "pomocná", "pomocna", "construction", "hilfs", "hilfslinien", "konstruktion");
const BEFORE = W("před", "pred", "before", "vor");
const AFTER = W("za", "after", "nach", "hinter");
const UP = W("nahoru", "výš", "vys", "výše", "vyse", "up", "hoch", "nach oben", "aufwärts", "aufwaerts");
const DOWN = W("dolů", "dolu", "níž", "niz", "níže", "nize", "down", "runter", "nach unten", "abwärts", "abwaerts");
const START = W("začátek", "zacatek", "na začátek", "na zacatek", "start", "to start", "anfang", "an anfang", "an den anfang");
const END = W("konec", "na konec", "end", "to end", "ende", "ans ende", "an das ende");

/** položka skici v příkazu smazat: entita e3, vazba v1, kóta k2 */
const SKETCH_ITEM = /^(e\d+|v\d+|k\d+)$/i;

/* ───────────────────────── rozbor řádku ───────────────────────── */
/**
 * Rozbor řádku úpravy. Vrací null, když řádek není příkaz úprav (pak ho čte běžný parser agent.ts).
 * `inBlock` = předchozí řádky tvoří blok skici (skica, entity, vazby, kóty) – smazat e3 / entita … do něj patří.
 */
export function parseEditLine(line: string, inBlock = false, lineNo = 0): EditParse | null {
  const m = /^\s*(\S+)\s*([\s\S]*)$/.exec(line);
  if (!m) return null;
  const w = fold(m[1]);
  const rest = m[2].trim();
  const tk = words(rest);
  if (SKETCH.has(w)) {
    // `skica "Skica 1"` / `skica "Skica 1": kružnice 10` – jen samotný název v uvozovkách (jinak nová skica, viz agent.ts)
    const q = /^(?:"([^"]+)"|„([^“]+)“)\s*(?::\s*([\s\S]*))?$/.exec(rest);
    if (!q) return null;
    const name = (q[1] ?? q[2]).trim();
    if (/^(xy|xz|yz)$/i.test(name)) return null;
    return { cmd: { kind: "openSketch", name, target: { id: "", line: lineNo } }, block: "open", ...(q[3]?.trim() ? { entities: q[3].trim() } : {}) };
  }
  if (EDIT.has(w)) return { cmd: parseEdit(rest), block: "end" };
  if (SUPPRESS.has(w) || UNSUPPRESS.has(w)) {
    if (!tk.length) throw new Error(SUPPRESS.has(w) ? tr("potlačit potřebuje prvek: potlačit \"Díra 1\" [\"Pole 1\" …]") : tr("zapnout potřebuje prvek: zapnout \"Díra 1\" [\"Pole 1\" …]"));
    return { cmd: { kind: "suppress", targets: tk, on: SUPPRESS.has(w) }, block: "end" };
  }
  if (DELETE.has(w)) {
    if (!tk.length || (tk.length === 1 && LAST.has(fold(tk[0])))) return { pop: true };
    const sketchy = tk.every((t) => SKETCH_ITEM.test(t));
    return { cmd: { kind: "delete", targets: tk }, block: sketchy ? "keep" : inBlock ? "keep" : "end" };
  }
  if (RENAME.has(w)) {
    const i = tk.findIndex((t, k) => k > 0 && RENAME_TO.has(fold(t)));
    if (i < 1 || i === tk.length - 1) throw new Error(tr("přejmenovat potřebuje prvek a nový název: přejmenovat \"Díra 1\" na \"Díra M8\""));
    return { cmd: { kind: "rename", target: tk.slice(0, i).join(" "), name: tk.slice(i + 1).join(" ") }, block: "end" };
  }
  if (MOVE.has(w)) return { cmd: parseMove(tk), block: "end" };
  if (DUPLICATE.has(w)) {
    const i = tk.findIndex((t, k) => k > 0 && AS.has(fold(t)));
    const target = (i > 0 ? tk.slice(0, i) : tk).join(" ");
    if (!target) throw new Error(tr("duplikovat potřebuje prvek: duplikovat \"Díra 1\" [jako \"Díra 2\"]"));
    const name = i > 0 ? tk.slice(i + 1).join(" ").trim() : "";
    return { cmd: { kind: "duplicate", target, ...(name ? { name } : {}) }, block: "end" };
  }
  // „wiederholen“ je německy i pole (muster) – jako znovu jen samotné nebo s počtem kroků
  if (UNDO.has(w) || REDO.has(w) || (w === "wiederholen" && tk.length <= 1 && (!tk.length || /^\d+$/.test(tk[0])))) {
    const undo = UNDO.has(w);
    if (tk.length > 1 || (tk.length === 1 && !/^\d+$/.test(tk[0]))) throw new Error(undo ? tr("zpět [N] – N = počet kroků historie (výchozí 1); poslední prvek smaže „smazat poslední“") : tr("znovu [N] – N = počet kroků historie (výchozí 1)"));
    const n = tk.length ? Number(tk[0]) : 1;
    if (!(n >= 1)) throw new Error(tr("počet kroků musí být aspoň 1"));
    return { cmd: { kind: undo ? "undo" : "redo", n }, block: "end" };
  }
  if (VARS.has(w) && !tk.length) return { cmd: { kind: "vars" }, block: "end" };
  if (VAR.has(w) || VARS.has(w)) return { cmd: parseVar(rest), block: "end" };
  if (CONFIG.has(w)) return { cmd: parseConfig(tk), block: "end" };
  if (ENTITY.has(w)) {
    const em = /^(\S+)\s*([\s\S]*)$/.exec(rest);
    if (!em || !em[2].trim()) throw new Error(tr("entita potřebuje id a klíč=hodnota: entita e3 cx=10 cy=5 r=4 · entita e1 a=0;0 b=60;0 · entita e2 pomocná=ano"));
    return { cmd: { kind: "entity", id: em[1], pairs: keyValues(em[2]) }, block: "keep" };
  }
  if (DIM.has(w) && /^k\d+$/i.test(tk[0] ?? "")) return { cmd: parseDimEdit(tk), block: "keep" };
  if (OFFSET.has(w)) return { cmd: parseOffset(tk), block: "keep" };
  if (PROJECT.has(w)) return { cmd: parseProject(tk), block: "keep" };
  return null;
}

/** `<prvek> klíč=hodnota …` nebo `<prvek> {JSON}`; prvek v uvozovkách, id, `$last`, `@3` nebo název bez uvozovek */
function parseEdit(rest: string): EditCmd {
  let target = "";
  let tail = "";
  const q = /^(?:"([^"]*)"|„([^“]*)“|'([^']*)')\s*([\s\S]*)$/.exec(rest);
  if (q) {
    target = q[1] ?? q[2] ?? q[3];
    tail = q[4];
  } else {
    const m = /^(.*?)\s+((?:[^\s=]+=|\{)[\s\S]*)$/.exec(rest);
    if (m) [target, tail] = [m[1], m[2]];
    else target = rest;
  }
  target = target.trim();
  tail = tail.trim();
  if (!target) throw new Error(tr("upravit potřebuje prvek a změny: upravit \"Díra 1\" diameter=10 depth=12 · upravit $last edges=svislé · upravit \"Pole 1\" {\"count\": 6}"));
  if (tail.startsWith("{")) {
    let patch: unknown;
    try {
      patch = JSON.parse(tail);
    } catch (e) {
      throw new Error(tr("JSON záplatu nelze přečíst: {0}", (e as Error).message));
    }
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error(tr("JSON záplata musí být objekt: upravit \"Díra 1\" {\"diameter\": 10}"));
    return { kind: "edit", target, pairs: [], patch: patch as Record<string, unknown> };
  }
  return { kind: "edit", target, pairs: keyValues(tail) };
}

function parseMove(tk: string[]): EditCmd {
  const usage = tr("přesunout potřebuje prvek a místo: přesunout \"Díra 1\" před|za \"Vysunutí 2\" · přesunout \"Díra 1\" nahoru|dolů [N] · přesunout \"Díra 1\" na začátek|konec");
  for (let i = 1; i < tk.length; i++) {
    const one = fold(tk[i]);
    const two = i + 1 < tk.length ? fold(`${tk[i]} ${tk[i + 1]}`) : "";
    const target = tk.slice(0, i).join(" ");
    const after = (k: number) => tk.slice(i + k);
    if (two && (UP.has(two) || DOWN.has(two) || START.has(two) || END.has(two))) {
      const nRest = after(2);
      if (START.has(two) || END.has(two)) return { kind: "move", target, where: { kind: START.has(two) ? "start" : "end" } };
      return { kind: "move", target, where: { kind: UP.has(two) ? "up" : "down", n: nRest.length && /^\d+$/.test(nRest[0]) ? Number(nRest[0]) : 1 } };
    }
    if (UP.has(one) || DOWN.has(one)) {
      const nRest = after(1);
      if (nRest.length > 1 || (nRest.length === 1 && !/^\d+$/.test(nRest[0]))) throw new Error(usage);
      return { kind: "move", target, where: { kind: UP.has(one) ? "up" : "down", n: nRest.length ? Number(nRest[0]) : 1 } };
    }
    if (START.has(one) || END.has(one)) return { kind: "move", target, where: { kind: START.has(one) ? "start" : "end" } };
    if (BEFORE.has(one) || AFTER.has(one)) {
      const ref = after(1).join(" ");
      if (!ref) throw new Error(usage);
      return { kind: "move", target, where: { kind: BEFORE.has(one) ? "before" : "after", ref } };
    }
  }
  throw new Error(usage);
}

/** `d = 20 [poznámka "…"]` · `smazat d` (i `delete d`, `löschen d`) */
function parseVar(rest: string): EditCmd {
  const usage = tr("proměnná <název> = <výraz> [poznámka \"…\"] · proměnná smazat <název> · proměnné (výpis)");
  const tk = words(rest);
  if (tk.length >= 2 && (DELETE.has(fold(tk[0])) || DELETE.has(fold(tk[1])))) {
    const name = DELETE.has(fold(tk[0])) ? tk[1] : tk[0];
    if (tk.length !== 2) throw new Error(usage);
    return { kind: "varDelete", name };
  }
  const m = /^([^\s=]+)\s*=\s*([\s\S]*)$/.exec(rest);
  if (!m) throw new Error(usage);
  let expr = m[2].trim();
  let note: string | undefined;
  const n = /^([\s\S]*?)\s+(poznámka|poznamka|note|notiz)\s+(?:"([^"]*)"|„([^“]*)“|(.+))$/i.exec(expr);
  if (n) {
    expr = n[1].trim();
    note = (n[3] ?? n[4] ?? n[5] ?? "").trim();
  }
  expr = expr.replace(/^=\s*/, "");
  if (!expr) throw new Error(usage);
  return { kind: "var", name: m[1], expr, ...(note !== undefined ? { note } : {}) };
}

function parseConfig(tk: string[]): EditCmd {
  const usage = tr("konfigurace \"<název>\" [proměnná=hodnota …] [potlačit <prvek>;<prvek>] · konfigurace aktivní \"<název>\"|žádná · konfigurace smazat \"<název>\" · konfigurace (výpis)");
  if (!tk.length) return { kind: "configs" };
  const head = fold(tk[0]);
  if (ACTIVE.has(head)) {
    const name = tk.slice(1).join(" ").trim();
    if (!name) throw new Error(usage);
    return { kind: "configActive", name: NONE.has(fold(name)) ? null : name };
  }
  if (DELETE.has(head)) {
    const name = tk.slice(1).join(" ").trim();
    if (!name) throw new Error(usage);
    return { kind: "configDelete", name };
  }
  const nameEnd = tk.findIndex((t) => t.includes("=") || SUPPRESS.has(fold(t)));
  const name = (nameEnd < 0 ? tk : tk.slice(0, nameEnd)).join(" ").trim();
  if (!name) throw new Error(usage);
  const values: [string, string][] = [];
  let suppress: string[] | undefined;
  for (let i = nameEnd < 0 ? tk.length : nameEnd; i < tk.length; i++) {
    const t = tk[i];
    if (SUPPRESS.has(fold(t))) {
      const list = tk.slice(i + 1);
      suppress = list.length === 1 && NONE.has(fold(list[0])) ? [] : list;
      if (!list.length) throw new Error(usage);
      break;
    }
    const kv = /^([^=]+)=(.+)$/.exec(t);
    if (!kv) throw new Error(tr("konfigurace: „{0}“ není ve tvaru proměnná=hodnota – {1}", t, usage));
    values.push([kv[1], kv[2]]);
  }
  return { kind: "config", name, values, ...(suppress ? { suppress } : {}) };
}

function parseDimEdit(tk: string[]): EditCmd {
  const usage = tr("kóta k1 65 (nová hodnota) · kóta k1 referenční · kóta k1 řídicí – čísla kót k1, k2… vypíše stav skici");
  const cmd: { kind: "dimEdit"; id: string; value?: number; driving?: boolean } = { kind: "dimEdit", id: tk[0].toLowerCase() };
  for (const t of tk.slice(1)) {
    const f = fold(t);
    const v = t.replace(/^[øØ⌀rR](?=[\d.,])/, "");
    if (REF.has(f)) cmd.driving = false;
    else if (DRIVE.has(f)) cmd.driving = true;
    else if (isNum(v) && cmd.value === undefined) cmd.value = num(v);
    else throw new Error(usage);
  }
  if (cmd.value === undefined && cmd.driving === undefined) throw new Error(usage);
  if (cmd.value !== undefined && cmd.driving === false) throw new Error(tr("kóta {0}: referenční kóta jen měří – hodnotu nelze zadat zároveň s „referenční“", cmd.id));
  return cmd;
}

function parseOffset(tk: string[]): EditCmd {
  const usage = tr("odsadit e1 [e2 …] <vzdálenost> [ven|dovnitř|vlevo|vpravo] [řetězec]");
  const ids: string[] = [];
  let dist: number | undefined;
  let side: "out" | "in" | "left" | "right" = "out";
  let chain = false;
  for (const t of tk) {
    const f = fold(t);
    if (isNum(t)) {
      if (dist !== undefined) throw new Error(usage);
      dist = num(t);
    } else if (OUT.has(f)) side = "out";
    else if (IN.has(f)) side = "in";
    else if (LEFT.has(f)) side = "left";
    else if (RIGHT.has(f)) side = "right";
    else if (CHAIN.has(f)) chain = true;
    else if (["o", "um", "by"].includes(f)) continue;
    else ids.push(t);
  }
  if (!ids.length || dist === undefined || !(Math.abs(dist) > 0)) throw new Error(usage);
  if (dist < 0) {
    dist = -dist;
    side = side === "out" ? "in" : side === "in" ? "out" : side === "left" ? "right" : "left";
  }
  return { kind: "offset", ids, dist, side, chain };
}

function parseProject(tk: string[]): EditCmd {
  const usage = tr("promítnout hrany E3;E7 | vše | rovina [pomocné] – E čísla jako popisky pro výběr (hrany tělesa před skicou)");
  let list = tk;
  if (list.length && EDGES.has(fold(list[0]))) list = list.slice(1);
  let construction = false;
  const rest: string[] = [];
  for (const t of list) {
    if (CONSTRUCTION.has(fold(t))) construction = true;
    else rest.push(t);
  }
  const joined = fold(rest.join(" "));
  if (!rest.length || IN_PLANE.has(joined)) return { kind: "project", edges: "plane", construction };
  if (ALL.has(joined)) return { kind: "project", edges: "all", construction };
  const edges = rest.map((t) => {
    const m = /^e?(\d+)$/i.exec(t);
    if (!m || Number(m[1]) < 1) throw new Error(usage);
    return Number(m[1]) - 1;
  });
  return { kind: "project", edges, construction };
}

/* ───────────────────────── odkazy na prvky a závislosti ───────────────────────── */
/** prvek podle textu: `$last` / poslední, `@3` (pořadí v historii), id, název (bez ohledu na velikost písmen a diakritiku) */
export function findFeature(doc: CadDoc, text: string): Feature | null {
  const q = text.trim();
  if (!q) return null;
  const fq = fold(q);
  if (LAST.has(fq)) return doc.features[doc.features.length - 1] ?? null;
  const h = /^@(\d+)$/.exec(q);
  if (h) return doc.features[Number(h[1]) - 1] ?? null;
  const byId = doc.features.find((f) => f.id === q);
  if (byId) return byId;
  const rev = [...doc.features].reverse();
  return rev.find((f) => f.name.toLowerCase() === q.toLowerCase()) ?? rev.find((f) => fold(f.name) === fq) ?? null;
}
const notFound = (doc: CadDoc, text: string) => new Error(tr("„{0}“ v historii není – k dispozici: {1}", text, nameList(doc)));
function oneFeature(doc: CadDoc, text: string): Feature {
  const f = findFeature(doc, text);
  if (!f) throw notFound(doc, text);
  return f;
}
/** více prvků za sebou: nejdelší shoda slov s názvem (názvy s mezerami i bez uvozovek: „Díra 1 Díra 2“) */
export function takeFeatures(doc: CadDoc, tokens: string[]): Feature[] {
  const out: Feature[] = [];
  for (let i = 0; i < tokens.length; ) {
    let hit: Feature | null = null;
    let used = 0;
    for (let j = tokens.length; j > i && !hit; j--) {
      hit = findFeature(doc, tokens.slice(i, j).join(" "));
      used = j - i;
    }
    if (!hit) throw notFound(doc, tokens[i]);
    if (!out.includes(hit)) out.push(hit);
    i += used;
  }
  return out;
}

/**
 * Název nového prvku z textového příkazu, který v dokumentu už má prvek stejného typu (výchozí „Skica 1“ z dřívějšího běhu příkazů –
 * parser čísluje názvy jen v rámci jednoho vstupu), dostane další volné číslo, aby odkazy názvem (upravit "Skica 2") byly jednoznačné.
 */
export function freeName(features: Feature[], f: Feature): string {
  const m = /^(.*\S)\s+(\d+)$/.exec(f.name);
  if (!m || !features.some((x) => x.id !== f.id && x.type === f.type && x.name === f.name)) return f.name;
  const used = new Set(features.map((x) => x.name));
  let n = Number(m[2]);
  while (used.has(`${m[1]} ${n}`)) n++;
  return `${m[1]} ${n}`;
}

/** id dřívějších prvků, na které prvek odkazuje (sketchId, featureId, profileId, pathId, data rozšíření, planeDef, body skici…), s cestou */
export function featureRefs(f: Feature, ids: Set<string>): { id: string; path: string }[] {
  const out: { id: string; path: string }[] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === "string") {
      if (v !== f.id && ids.has(v)) out.push({ id: v, path });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${i}`));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (!path && (k === "id" || k === "name" || k === "entities" || k === "constraints" || k === "dims")) continue;
        walk(x, path ? `${path}.${k}` : k);
      }
  };
  walk(f, "");
  return out;
}
/** prvky, které na `id` odkazují (přímo), s cestou odkazu */
export function dependentsOf(doc: CadDoc, id: string): { f: Feature; path: string }[] {
  const ids = new Set([id]);
  return doc.features.flatMap((f) => featureRefs(f, ids).slice(0, 1).map((r) => ({ f, path: r.path })));
}
/** přímé i nepřímé závislé prvky (id) */
function dependentsDeep(doc: CadDoc, roots: string[]): string[] {
  const out = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift()!;
    for (const { f } of dependentsOf(doc, id)) if (!out.has(f.id) && !roots.includes(f.id)) (out.add(f.id), queue.push(f.id));
  }
  return [...out];
}
/** první porušení pořadí: prvek odkazuje na prvek, který je až za ním (skica za vysunutím…) */
export function orderProblem(features: Feature[]): { user: Feature; used: Feature; path: string } | null {
  const ids = new Set(features.map((f) => f.id));
  const pos = new Map(features.map((f, i) => [f.id, i]));
  for (let i = 0; i < features.length; i++)
    for (const r of featureRefs(features[i], ids)) if ((pos.get(r.id) ?? -1) > i) return { user: features[i], used: features[pos.get(r.id)!], path: r.path };
  return null;
}

/* ───────────────────────── jádro (rozhraní) ───────────────────────── */
type Topo = { faces: FaceLite[]; edges: EdgeLite[]; bbox: [Vec3, Vec3]; bodies?: { faceCount: number; edgeCount: number }[] };
export type EditKernel = {
  /** plochy a hrany tělesa dokumentu (aktivní těleso první) – `cad.topology` */
  topology?: (doc: CadDoc) => Promise<Topo | null>;
  selectFaces?: (rule: string[], faces: FaceLite[], bbox: [Vec3, Vec3]) => number[];
  selectEdges?: (rule: string[], edges: EdgeLite[], bbox: [Vec3, Vec3]) => number[];
  /** otisky výběru prvku nad dokumentem PŘED ním (`stampFeature` z use-pick-sigs.ts) */
  stamp?: (before: CadDoc, f: Feature) => Promise<Feature>;
  /** stavba dokumentu (hrany modelu pro průmět do skici) – `cad.build` */
  build?: (doc: CadDoc) => Promise<{ mesh: { lines: ArrayLike<number>; edgeGroups: ArrayLike<number> } | null }>;
};
export type EditCtx = { kernel?: EditKernel; /** skica otevřená ve skicáři (cíl úprav skici bez bloku) */ openSketchId?: string | null };
/** `touched` = prvky, jejichž výsledek (✓ / ⚠ / ✗) má protokol vypsat po stavbě; `removed` = smazané prvky */
export type EditResult = { doc: CadDoc; log: string[]; changed: boolean; touched: string[]; removed: string[] };

const before = (doc: CadDoc, i: number, f: Feature): CadDoc => ({ ...doc, features: doc.features.slice(0, i), activeBody: f.body ?? doc.activeBody });

/* ───────────────────────── provedení ───────────────────────── */
/** Provede příkaz úprav nad kopií dokumentu (zpět / znovu provádí aplikace – `histStep`). */
export async function applyEdit(doc0: CadDoc, cmd: EditCmd, ctx: EditCtx = {}, sketch?: SketchTarget): Promise<EditResult> {
  const doc: CadDoc = { ...doc0, features: [...doc0.features] };
  const res: EditResult = { doc, log: [], changed: false, touched: [], removed: [] };
  switch (cmd.kind) {
    case "edit":
      return editFeature(res, cmd, ctx);
    case "suppress": {
      const list = takeFeatures(doc, cmd.targets);
      const done: string[] = [];
      const same: string[] = [];
      for (const f of list) {
        const i = doc.features.indexOf(f);
        if (!!f.suppressed === cmd.on) same.push(f.name);
        else {
          const g = { ...f } as Feature;
          if (cmd.on) g.suppressed = true;
          else delete g.suppressed;
          doc.features[i] = g;
          done.push(f.name);
          res.changed = true;
        }
      }
      const ids = list.map((f) => f.id);
      res.touched = [...(cmd.on ? [] : ids), ...dependentsDeep(doc, ids)];
      if (done.length) res.log.push(cmd.on ? tr("✓ potlačeno: {0}", done.join(", ")) : tr("✓ zapnuto: {0}", done.join(", ")));
      if (same.length) res.log.push(cmd.on ? tr("✓ už potlačeno: {0}", same.join(", ")) : tr("✓ už zapnuto: {0}", same.join(", ")));
      const cfg = doc.activeConfig ? doc.configs?.find((c) => c.id === doc.activeConfig) : undefined;
      const byCfg = cfg ? list.filter((f) => cfg.suppressed.includes(f.id)).map((f) => f.name) : [];
      if (!cmd.on && byCfg.length) res.log.push(tr("⚠ {0} zůstává potlačeno aktivní konfigurací „{1}“ – změníte: konfigurace \"{1}\" potlačit …", byCfg.join(", "), cfg!.name));
      return res;
    }
    case "delete":
      return deleteItems(res, cmd.targets, ctx, sketch);
    case "rename": {
      const f = oneFeature(doc, cmd.target);
      const name = cmd.name.trim();
      if (!name) throw new Error(tr("přejmenovat potřebuje prvek a nový název: přejmenovat \"Díra 1\" na \"Díra M8\""));
      const i = doc.features.indexOf(f);
      doc.features[i] = { ...f, name } as Feature;
      res.changed = name !== f.name;
      res.log.push(tr("✓ přejmenováno: {0} → {1}", f.name, name));
      const dup = doc.features.filter((x, k) => k !== i && x.name.toLowerCase() === name.toLowerCase());
      if (dup.length) res.log.push(tr("⚠ název „{0}“ má i jiný prvek – odkaz názvem vybere ten poslední; použijte jiný název nebo @pořadí", name));
      return res;
    }
    case "move":
      return moveFeature(res, cmd.target, cmd.where);
    case "duplicate": {
      const f = oneFeature(doc, cmd.target);
      const i = doc.features.indexOf(f);
      const copy = { ...clone(f), id: uid(), name: cmd.name?.trim() || tr("{0} (kopie)", f.name) } as Feature;
      doc.features.splice(i + 1, 0, copy);
      res.changed = true;
      res.touched = [copy.id];
      res.log.push(tr("✓ {0} duplikován jako „{1}“ (pozice {2})", f.name, copy.name, i + 2));
      return res;
    }
    case "undo":
    case "redo":
      throw new Error(tr("zpět / znovu provádí aplikace (historie dokumentu)"));
    case "var":
    case "varDelete":
    case "vars":
      return variables(res, cmd);
    case "config":
    case "configActive":
    case "configDelete":
    case "configs":
      return configs(res, cmd);
    case "openSketch": {
      const f = findFeature(doc, cmd.name);
      if (!f || f.type !== "sketch") throw new Error(tr("skica „{0}“ v dokumentu není – skici: {1}", cmd.name, nameList(doc, (x) => x.type === "sketch")));
      cmd.target.id = f.id;
      res.log.push(tr("✓ skica „{0}“ je cílem dalších řádků (entity, vazby, kóty, entita, smazat e…, kóta k…) – {1}", f.name, sketchCounts(f)));
      return res;
    }
    case "entity":
    case "dimEdit":
    case "offset":
    case "project":
      return sketchEdit(res, cmd, ctx, sketch);
  }
}

/* ───────────────────────── upravit ───────────────────────── */
/** volitelná pole prvků (`pole?:` v typu Feature, types.ts) – klíč, který prvek zatím nemá, je platný jen z tohoto seznamu (hlídá test) */
export const OPTIONAL_KEYS = new Set(
  "angle angle2 axisDef body bothWays centerRef centerlineId circleRadius closed constraints count2 csAngle csDiameter d2 d3 dims dir dirDef dirDef2 direction2 draftAngle edgeSigs end endCond endDir endLen endPoint endScale equalSpacing extent extent2 faceRef faceRefs faceRefs2 faceRefsMid faceSigs faceSigs2 faces faces2 featureIds fit from geometryOnly guideId guideIds internal keepNormal kind nameB newName outerOnly outward partingSketchId planeDef points positionRef pull r2 radial radii radii2 rotateAxisDef scaleEnd setback size skip smooth spacing spacing2 spacingMode stagger startCond startDir startLen startPoint step suppressed symmetric tangentChain thicknesses thin thread threadDepth tipAngle transition translateRef twist twistTurns vertexRefs vertexSigs vertices".split(
    " ",
  ),
);
// tvary 7. vlny (agent-shapes.ts): kuželosečka eliptického zaoblení, setback pro jednotlivé vrcholy
for (const k of ["rho", "setbacks"]) OPTIONAL_KEYS.add(k);
// díra 12. vlny (agent-hole.ts): vrták závitové díry – upravit "Díra 1" tapDrill=minor
OPTIONAL_KEYS.add("tapDrill");
// vlna 12 (agent-extr.ts): břit a rohy úkosu vysunutí, výška kolmo na skicu u šikmého směru
for (const k of ["draftLand", "draftCorners", "normalHeight"]) OPTIONAL_KEYS.add(k);
const SKETCH_KEYS = new Set(["sketchId", "profileId", "pathId", "guideId", "partingSketchId", "centerlineId"]);
const SKETCH_LISTS = new Set(["sketchIds", "profileIds", "guideIds"]);
const MODE_WORDS: [string, Set<string>][] = [
  ["cut", W("cut", "odebrat", "odečíst", "odecist", "vyříznout", "subtract", "minus", "abziehen", "ausschneiden", "subtrahieren")],
  ["intersect", W("intersect", "průnik", "prunik", "schnittmenge")],
  ["new", W("new", "nové", "nove", "newbody", "samostatně", "neu", "neukörper", "separat")],
  ["add", W("add", "přidat", "pridat", "sloučit", "union", "plus", "hinzufügen", "vereinigen")],
];
/** české a německé názvy častých polí prvku → pole (jen když prvek pole s tímto názvem sám nemá) */
const FIELD_ALIAS: Record<string, string> = Object.fromEntries(
  (
    [
      ["edges", "hrany", "hrana", "kanten", "kante"],
      ["faces", "plochy", "plocha", "flachen", "flaechen", "flache"],
      ["diameter", "prumer", "durchmesser"],
      ["depth", "hloubka", "tiefe"],
      ["height", "vyska", "hohe", "hoehe"],
      ["radius", "polomer", "halbmesser"],
      ["distance", "vzdalenost", "abstand"],
      ["length", "delka", "lange", "laenge"],
      ["count", "pocet", "anzahl"],
      ["spacing", "roztec", "teilung"],
      ["angle", "uhel", "winkel"],
      ["thickness", "tloustka", "dicke", "starke", "staerke"],
      ["position", "poloha", "lage"],
      ["axis", "osa", "achse"],
      ["mode", "rezim", "modus"],
      ["size", "velikost", "rozmery", "grosse"],
    ] as const
  ).flatMap(([k, ...names]) => names.map((n) => [n, k] as const)),
);
const modeOf = (v: unknown) => (typeof v === "string" ? (MODE_WORDS.find(([, s]) => s.has(fold(v)))?.[0] ?? v) : v);
/** výpis parametrů prvku (upravit bez změn) */
function paramsText(f: Feature): string {
  const rec = f as unknown as Record<string, unknown>;
  if (f.type === "ext") {
    const def = getExt(f.ext);
    const data = (f.data ?? {}) as Record<string, unknown>;
    const ps = (def?.params ?? []).map((p) => `${p.key}${fold(p.label) !== fold(p.key) ? ` („${tr(p.label)}“)` : ""}=${show(data[p.key])}`);
    return tr("Parametry „{0}“ ({1}): {2}", f.name, f.ext, ps.join(" · ") || Object.keys(data).join(", "));
  }
  const ps = Object.entries(rec)
    .filter(([k]) => !["id", "name", "type", "entities", "constraints", "dims"].includes(k) && !/Sigs\d?$/.test(k))
    .map(([k, v]) => `${k}=${show(v)}`);
  if (f.type === "sketch") ps.push(tr("entit {0} (upravíte: skica \"{1}\" + entita e3 …)", f.entities.length, f.name));
  return tr("Parametry „{0}“ ({1}): {2}", f.name, f.type, ps.join(" · "));
}

async function editFeature(res: EditResult, cmd: Extract<EditCmd, { kind: "edit" }>, ctx: EditCtx): Promise<EditResult> {
  const doc = res.doc;
  const f0 = oneFeature(doc, cmd.target);
  const i = doc.features.indexOf(f0);
  if (!cmd.pairs.length && !cmd.patch) {
    res.log.push(paramsText(f0));
    return res;
  }
  const f = clone(f0) as Feature;
  const rec = f as unknown as Record<string, unknown>;
  const changes: string[] = [];
  const bindings = { ...(doc.bindings ?? {}) };
  let bindChanged = false;
  /** pole výběru (plochy / hrany) změněná touto úpravou – jejich otisky se smažou a spočtou znovu */
  const picked = new Set<string>();
  const rules: { path: string[]; kind: "faces" | "edges"; rule: string[] }[] = [];
  const fields = pickFieldsOf(f);
  const cfg = doc.activeConfig ? doc.configs?.find((c) => c.id === doc.activeConfig) : undefined;
  const scope = () => resolveVariables(doc.variables, cfg?.values ?? {}).values;
  const refTo = (v: unknown, sketchOnly: boolean): unknown => {
    if (typeof v !== "string") return v;
    const hit = findFeature({ ...doc, features: doc.features.slice(0, i) }, v);
    if (!hit || (sketchOnly && hit.type !== "sketch")) throw new Error(tr("„{0}“ před prvkem „{1}“ není – {2}: {3}", v, f0.name, sketchOnly ? tr("skici") : tr("prvky"), nameList({ ...doc, features: doc.features.slice(0, i) }, (x) => !sketchOnly || x.type === "sketch")));
    return hit.id;
  };
  if (cmd.patch) {
    for (const k of ["id", "type", "ext"]) if (k in cmd.patch && cmd.patch[k] !== rec[k]) throw new Error(tr("id, typ a druh rozšíření prvku nelze měnit – smažte prvek a vytvořte nový"));
    const prev = clone(rec);
    mergePatch(rec, cmd.patch);
    for (const k of Object.keys(cmd.patch)) changes.push(`${k} ${show(prev[k], doc)} → ${show(rec[k], doc)}`);
    for (const fd of fields)
      if (getAt(cmd.patch, fd.path) !== undefined) {
        picked.add(fd.path.join("."));
        setAt(rec, fd.sigPath, undefined);
      }
  }
  for (const [key0, raw] of cmd.pairs) {
    const fk = fold(key0);
    if (["id", "type", "ext"].includes(fk)) throw new Error(tr("id, typ a druh rozšíření prvku nelze měnit – smažte prvek a vytvořte nový"));
    if (fk === "name" || fk === "nazev" || fk === "name_") {
      const name = raw.trim();
      if (!name) throw new Error(tr("název nesmí být prázdný"));
      changes.push(`${tr("název")} ${f.name} → ${name}`);
      f.name = name;
      continue;
    }
    // cesta k poli: u rozšíření klíč nebo popisek parametru (data.…), jinak pole prvku (size.0, extent…)
    let path: string[];
    let prm: ExtParam | undefined;
    if (f.type === "ext") {
      const def = getExt(f.ext);
      const data = (f.data ?? {}) as Record<string, unknown>;
      const [head, ...sub] = key0.replace(/^data\./, "").split(".");
      prm = def?.params?.find((p) => fold(p.key) === fold(head) || fold(tr(p.label)) === fold(head) || fold(p.label) === fold(head)) ?? def?.params?.find((p) => p.key === FIELD_ALIAS[fold(head)]);
      const k = prm?.key ?? (head in data ? head : undefined);
      if (!k) throw new Error(tr("prvek {0}: neznámý parametr „{1}“ – parametry: {2}", f.ext, key0, [...new Set([...(def?.params ?? []).map((p) => p.key), ...Object.keys(data)])].join(", ")));
      path = ["data", k, ...sub];
    } else {
      path = key0.split(".");
      const alias = FIELD_ALIAS[fold(path[0])];
      if (!(path[0] in rec) && alias && (alias in rec || OPTIONAL_KEYS.has(alias))) path[0] = alias;
      if (!(path[0] in rec) && !OPTIONAL_KEYS.has(path[0])) throw new Error(tr("„{0}“ není parametr prvku „{1}“ ({2}) – parametry: {3}", key0, f.name, f.type, Object.keys(rec).filter((k) => !["id", "name", "type"].includes(k) && !/Sigs\d?$/.test(k)).join(", ")));
    }
    const pathStr = path.join(".");
    const bindKey = `${f.id}:${pathStr}`;
    let old = getAt(rec, path);
    // vázaný parametr: platná hodnota je podle výrazu (uložené číslo může být starší)
    if (bindings[bindKey] !== undefined)
      try {
        old = evalExpr(bindings[bindKey], scope());
      } catch {
        /* chyba výrazu – ukáže se uložené číslo */
      }
    // vazba na proměnné: klíč==výraz (hodnota začíná „=“)
    if (raw.trim().startsWith("=")) {
      const expr = raw.trim().replace(/^=\s*/, "");
      if (typeof numAt(rec, pathStr) !== "number") throw new Error(tr("vazbu na proměnné lze zadat jen u číselného parametru – „{0}“ je {1}", key0, show(old, doc)));
      if (!exprRefs(expr).length) throw new Error(tr("výraz „{0}“ neobsahuje proměnnou – číslo zadejte bez „=“ ({1}={0})", expr, key0));
      let v: number;
      try {
        v = evalExpr(expr, scope());
      } catch (e) {
        throw new Error(tr("{0}: {1} – proměnné: {2}", key0, (e as Error).message, (doc.variables ?? []).map((x) => x.name).join(", ") || tr("žádné (založíte: proměnná d = 20)")));
      }
      bindings[bindKey] = expr;
      bindChanged = true;
      setAt(rec, path, v);
      changes.push(tr("{0} = {1} (= {2}) – vazba na proměnné", pathStr, expr, fmt(v)));
      continue;
    }
    let v = parseValue(raw);
    const fd = fields.find((x) => x.path.join(".") === pathStr);
    if (fd) {
      // plochy / hrany: čísla (indexy jako u příkazu prvek), popisky F3 / E7, „vše“, nebo pravidlo nad tělesem před prvkem
      const list = Array.isArray(v) ? v : [v];
      const label = list.every((x) => typeof x === "string" && /^[FEV]\d+$/i.test(x));
      if (list.length === 1 && typeof list[0] === "string" && ALL.has(fold(list[0])) && path.join(".") === "edges" && (f.type === "fillet" || f.type === "chamfer")) v = "all";
      else if (label) v = (list as string[]).map((x) => Number(x.slice(1)) - 1);
      else if (!list.every((x) => typeof x === "number")) {
        if (fd.kind === "vertex") throw new Error(tr("vrcholy zadejte čísly (V3 nebo indexy) – pravidlo umí jen plochy a hrany"));
        rules.push({ path, kind: fd.kind === "face" ? "faces" : "edges", rule: list.map((x) => fold(String(x))) });
        v = old;
      }
      picked.add(pathStr);
      setAt(rec, fd.sigPath, undefined);
    } else if (f.type === "ext" && prm) {
      if (prm.kind === "enum" && typeof v === "string") {
        const s = v;
        const opt = prm.options.find((x) => fold(x.v) === fold(s) || fold(x.l) === fold(s) || fold(tr(x.l)) === fold(s));
        if (!opt) throw new Error(tr("prvek {0}: parametr „{1}“ má hodnoty {2}", f.ext, prm.key, prm.options.map((x) => x.v).join(" | ")));
        v = opt.v;
      } else if (prm.kind === "direction" || prm.kind === "axis") {
        const d = prm.kind === "direction" ? toDirection(v) : toAxisDef(v);
        if (!d) throw new Error(tr("prvek {0}: parametr „{1}“ je {2} – X | Y | Z | -Z | vektor 1;0;1 | JSON", f.ext, prm.key, prm.kind === "direction" ? tr("směr") : tr("osa")));
        v = d;
      } else if (prm.kind === "mode") v = modeOf(v);
      else if (prm.kind === "sketch") v = refTo(v, true);
      else if (prm.kind === "feature") v = refTo(v, false);
      else if (prm.kind === "sketches") v = (Array.isArray(v) ? v : [v]).map((x) => refTo(x, true));
    } else if (path.length === 1 && SKETCH_KEYS.has(path[0])) v = refTo(v, true);
    else if (path.length === 1 && SKETCH_LISTS.has(path[0])) v = (Array.isArray(v) ? v : [v]).map((x) => refTo(x, true));
    else if (pathStr === "featureId") v = refTo(v, false);
    else if (pathStr === "featureIds") v = (Array.isArray(v) ? v : [v]).map((x) => refTo(x, false));
    else if (pathStr === "mode") v = modeOf(v);
    else if (EXTRUDE_EDIT_FIELDS.has(pathStr)) v = extrudeFieldValue(pathStr, v, key0); // rohy / břit úkosu, výška kolmo (agent-extr.ts)
    // typ hodnoty musí sedět s dosavadní (číslo za číslo, vektor za vektor)
    if (!rules.some((r) => r.path.join(".") === pathStr)) {
      if (typeof old === "number" && typeof v !== "number") throw new Error(tr("„{0}“ čeká číslo (dosud {1}), zadáno „{2}“", key0, show(old), raw));
      if (Array.isArray(old) && old.every((x) => typeof x === "number") && old.length && !(Array.isArray(v) && v.length === old.length && v.every((x) => typeof x === "number")) && !fd) throw new Error(tr("„{0}“ čeká {1} čísel oddělených středníkem (dosud {2}), zadáno „{3}“", key0, old.length, show(old), raw));
      if (typeof old === "boolean" && typeof v !== "boolean") throw new Error(tr("„{0}“ čeká ano / ne (dosud {1}), zadáno „{2}“", key0, show(old), raw));
      setAt(rec, path, v);
      changes.push(`${pathStr} ${show(old, doc)} → ${show(v, doc)}`);
    }
    // číslo místo výrazu zruší vazbu parametru na proměnné
    if (bindings[bindKey] !== undefined) {
      changes.push(tr("vazba {0} = {1} zrušena", pathStr, bindings[bindKey]));
      delete bindings[bindKey];
      bindChanged = true;
    }
  }
  // pravidla ploch / hran nad tělesem PŘED prvkem (stejně jako „Ze seznamu…“ a výběr pravidlem při vzniku prvku)
  if (rules.length) {
    const k = ctx.kernel;
    if (!k?.topology || !k.selectFaces || !k.selectEdges) throw new Error(tr("výběr pravidlem potřebuje jádro (v konzoli programu)"));
    const t0 = await k.topology(before(doc, i, f));
    if (!t0) throw new Error(tr("před prvkem „{0}“ není těleso – plochy a hrany zadejte čísly", f.name));
    const act = t0.bodies && t0.bodies.length > 1 ? t0.bodies[0] : null;
    const t = act ? { ...t0, faces: t0.faces.filter((x) => x.index < act.faceCount), edges: t0.edges.filter((x) => x.index < act.edgeCount) } : t0;
    for (const r of rules) {
      const idx = r.kind === "faces" ? k.selectFaces(r.rule, t.faces, t.bbox) : k.selectEdges(r.rule, t.edges, t.bbox);
      if (!idx.length) throw new Error(r.kind === "faces" ? tr("žádná plocha neodpovídá pravidlu „{0}“ (ploch celkem {1})", r.rule.join(" "), t.faces.length) : tr("žádná hrana neodpovídá pravidlu „{0}“ (hran celkem {1})", r.rule.join(" "), t.edges.length));
      const old = getAt(rec, r.path);
      setAt(rec, r.path, idx);
      changes.push(tr("{0} {1} → {2} ({3} podle pravidla „{4}“)", r.path.join("."), show(old), show(idx), idx.length, r.rule.join(" ")));
    }
  }
  // díra: vrták závitové díry a dno podle stejných pravidel jako text a formulář (agent-hole.ts)
  if (f.type === "hole" && f0.type === "hole") changes.push(...holeFieldRules(f, changedHoleKeys(f0, f)));
  let out = f;
  if (picked.size && ctx.kernel?.stamp) out = await ctx.kernel.stamp(before(doc, i, f), f); // otisky vybraných entit (přežijí přečíslování)
  doc.features[i] = out;
  if (bindChanged) doc.bindings = bindings;
  res.changed = true;
  res.touched = [f.id, ...dependentsDeep(doc, [f.id])];
  res.log.push(`✓ ${f0.name}: ${changes.join(", ")}`);
  if (f.suppressed) res.log.push(tr("⚠ „{0}“ je potlačený – změna se projeví po: zapnout \"{0}\"", f.name));
  return res;
}

/* ───────────────────────── smazat ───────────────────────── */
async function deleteItems(res: EditResult, targets: string[], ctx: EditCtx, sketch?: SketchTarget): Promise<EditResult> {
  const doc = res.doc;
  // položky skici (e3, v1, k2): skica bloku / otevřená ve skicáři / poslední – jen když je ve skice najdeme všechny
  let si = -1;
  try {
    si = targetSketch(doc.features, sketch, ctx.openSketchId);
  } catch {
    si = -1;
  }
  if (si >= 0) {
    const sk = doc.features[si] as SketchF;
    const found = targets.map((t) => sketchItem(sk, t));
    if (found.every(Boolean)) return deleteSketchItems(res, si, found as SketchItem[]);
    if (targets.every((t) => SKETCH_ITEM.test(t)) && !targets.some((t) => findFeature(doc, t))) {
      const miss = targets.filter((t, k) => !found[k]);
      throw new Error(tr("{0} ve skice „{1}“ není – {2}", miss.join(", "), sk.name, sketchCounts(sk)));
    }
  } else if (targets.every((t) => SKETCH_ITEM.test(t)) && !targets.some((t) => findFeature(doc, t))) throw new Error(tr("není žádná skica – nejdřív „skica XY: …“"));
  const list = takeFeatures(doc, targets);
  const ids = new Set(list.map((f) => f.id));
  const deps = list.flatMap((f) => dependentsOf(doc, f.id)).filter((x) => !ids.has(x.f.id));
  const deep = dependentsDeep(doc, [...ids]).filter((id) => !ids.has(id));
  doc.features = doc.features.filter((f) => !ids.has(f.id));
  // vazby parametrů a potlačení v konfiguracích smazaných prvků už nemají smysl
  if (doc.bindings) doc.bindings = Object.fromEntries(Object.entries(doc.bindings).filter(([k]) => !ids.has(k.slice(0, k.indexOf(":")))));
  if (doc.configs) doc.configs = doc.configs.map((c) => (c.suppressed.some((x) => ids.has(x)) ? { ...c, suppressed: c.suppressed.filter((x) => !ids.has(x)) } : c));
  res.changed = true;
  res.removed = [...ids];
  res.touched = deep;
  res.log.push(tr("✓ smazáno: {0}", list.map((f) => f.name).join(", ")));
  if (deps.length) res.log.push(tr("⚠ na smazané odkazují: {0} – po výpočtu nejspíš ✗; smažte je také, nebo je upravte (upravit …)", [...new Map(deps.map((x) => [x.f.id, `${x.f.name} (${x.path})`])).values()].join(", ")));
  return res;
}
type SketchItem = { kind: "e"; e: SketchEntity } | { kind: "v"; c: SketchConstraint; n: number } | { kind: "k"; d: SketchDim; n: number };
function sketchItem(sk: SketchF, t: string): SketchItem | null {
  const e = sk.entities.find((x) => x.id === t) ?? sk.entities.find((x) => x.id.toLowerCase() === t.toLowerCase());
  if (e) return { kind: "e", e };
  const m = /^([vk])(\d+)$/i.exec(t);
  if (!m) return null;
  const n = Number(m[2]);
  if (m[1].toLowerCase() === "v") {
    const c = sk.constraints?.[n - 1];
    return c ? { kind: "v", c, n } : null;
  }
  const d = sk.dims?.[n - 1];
  return d ? { kind: "k", d, n } : null;
}
const sketchCounts = (sk: SketchF) => {
  const nc = sk.constraints?.length ?? 0;
  const nd = sk.dims?.length ?? 0;
  return tr("entity: {0}; vazby: {1}; kóty: {2}", sk.entities.map((e) => e.id).join(", ") || "—", nc ? (nc > 1 ? `v1–v${nc}` : "v1") : "—", nd ? (nd > 1 ? `k1–k${nd}` : "k1") : "—");
};
function deleteSketchItems(res: EditResult, si: number, items: SketchItem[]): EditResult {
  const doc = res.doc;
  const sk = doc.features[si] as SketchF;
  const ents = new Map(sk.entities.map((e) => [e.id, e]));
  const delE = new Set(items.flatMap((x) => (x.kind === "e" ? [x.e.id] : [])));
  const delC = new Set(items.flatMap((x) => (x.kind === "v" ? [x.c.id] : [])));
  const delD = new Set(items.flatMap((x) => (x.kind === "k" ? [x.d.id] : [])));
  const cons = sk.constraints ?? [];
  const dims = sk.dims ?? [];
  // s entitou zmizí i vazby a kóty, které na ni odkazují
  const withC = cons.filter((c) => !delC.has(c.id) && c.refs.some((r) => delE.has(r.e)));
  const withD = dims.filter((d) => !delD.has(d.id) && d.refs.some((r) => delE.has(r.e)));
  const text = items.map((x) => (x.kind === "e" ? entityText(x.e) : x.kind === "v" ? `v${x.n} ${describeConstraint(x.c, ents)}` : `k${x.n} ${describeDim(x.d, ents)}`));
  let next: SketchF = {
    ...sk,
    entities: sk.entities.filter((e) => !delE.has(e.id)),
    constraints: cons.filter((c) => !delC.has(c.id) && !withC.includes(c)),
    dims: dims.filter((d) => !delD.has(d.id) && !withD.includes(d)),
  };
  const extra = withC.length || withD.length ? " " + tr("(s entitami i vazby {0} a kóty {1})", withC.length, withD.length) : "";
  let solved = "";
  if (next.constraints?.length || next.dims?.length) {
    const r = solveSketchFeature(next);
    next = r.feature;
    solved = ` → ${r.text}`;
  }
  doc.features[si] = next;
  res.changed = true;
  res.touched = [sk.id, ...dependentsDeep(doc, [sk.id])];
  res.log.push(tr("✓ ze skici „{0}“ smazáno: {1}{2}{3}", sk.name, text.join(" · "), extra, solved));
  if (items.some((x) => x.kind !== "e")) res.log.push(tr("  čísla vazeb a kót se přečíslovala – aktuální vypíše stav"));
  return res;
}

/* ───────────────────────── přesunout ───────────────────────── */
function moveFeature(res: EditResult, target: string, where: MoveWhere): EditResult {
  const doc = res.doc;
  const f = oneFeature(doc, target);
  const from = doc.features.indexOf(f);
  const rest = doc.features.filter((x) => x !== f);
  let to: number;
  let ref: Feature | null = null;
  if (where.kind === "before" || where.kind === "after") {
    ref = oneFeature(doc, where.ref);
    if (ref === f) throw new Error(tr("prvek nelze přesunout vůči sobě samému"));
    to = rest.indexOf(ref) + (where.kind === "after" ? 1 : 0);
  } else if (where.kind === "start" || where.kind === "end") to = where.kind === "start" ? 0 : rest.length;
  else to = Math.max(0, Math.min(rest.length, from + (where.kind === "up" ? -where.n : where.n)));
  const next = [...rest];
  next.splice(to, 0, f);
  if (to === from) {
    res.log.push(tr("✓ „{0}“ už je na pozici {1}", f.name, from + 1));
    return res;
  }
  const bad = orderProblem(next);
  if (bad && !orderProblem(doc.features))
    throw new Error(tr("přesunout „{0}“ na pozici {1} nelze: „{2}“ používá „{3}“ ({4}) – použitý prvek musí zůstat v historii před prvkem, který ho používá", f.name, to + 1, bad.user.name, bad.used.name, bad.path));
  doc.features = next;
  res.changed = true;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  res.touched = next.slice(lo, hi + 1).map((x) => x.id);
  const place = ref ? (where.kind === "before" ? tr("před „{0}“", ref.name) : tr("za „{0}“", ref.name)) : "";
  res.log.push(tr("✓ „{0}“ přesunut {1}(pozice {2} → {3})", f.name, place ? place + " " : "", from + 1, to + 1));
  return res;
}

/* ───────────────────────── proměnné a konfigurace ───────────────────────── */
const activeCfg = (doc: CadDoc): Config | undefined => (doc.activeConfig ? doc.configs?.find((c) => c.id === doc.activeConfig) : undefined);
/** prvky a cesty parametrů, jejichž vazba používá proměnnou */
const bindingsUsing = (doc: CadDoc, name: string) =>
  Object.entries(doc.bindings ?? {}).flatMap(([k, expr]) => {
    if (!exprRefs(expr).includes(name)) return [];
    const f = doc.features.find((x) => x.id === k.slice(0, k.indexOf(":")));
    return f ? [{ f, path: k.slice(k.indexOf(":") + 1) }] : [];
  });
function variables(res: EditResult, cmd: Extract<EditCmd, { kind: "var" | "varDelete" | "vars" }>): EditResult {
  const doc = res.doc;
  const vars = [...(doc.variables ?? [])];
  const cfg = activeCfg(doc);
  if (cmd.kind === "vars") {
    const { values, errors } = resolveVariables(vars, cfg?.values ?? {});
    if (!vars.length) res.log.push(tr("Proměnné: žádné – založíte: proměnná d = 20"));
    else res.log.push(tr("Proměnné ({0}): {1}", vars.length, vars.map((v) => `${v.name} = ${v.expr} → ${errors[v.name] ? "✗ " + errors[v.name] : fmt(values[v.name])}${v.note ? ` („${v.note}“)` : ""}`).join(" · ")));
    res.log.push(...paramStatusLines(doc));
    return res;
  }
  const at = vars.findIndex((v) => v.name === cmd.name);
  if (cmd.kind === "varDelete") {
    if (at < 0) throw new Error(tr("proměnná „{0}“ není – proměnné: {1}", cmd.name, vars.map((v) => v.name).join(", ") || "—"));
    vars.splice(at, 1);
    doc.variables = vars;
    res.changed = true;
    const users = [...vars.filter((v) => exprRefs(v.expr).includes(cmd.name)).map((v) => v.name), ...bindingsUsing(doc, cmd.name).map((x) => `${x.f.name}.${x.path}`)];
    res.log.push(tr("✓ proměnná {0} smazána", cmd.name));
    if (users.length) res.log.push(tr("⚠ na {0} odkazují: {1} – teď skončí chybou proměnných; upravte je (proměnná …, upravit … klíč=číslo)", cmd.name, users.join(", ")));
    res.touched = bindingsUsing(res.doc, cmd.name).map((x) => x.f.id);
    return res;
  }
  if (!VAR_NAME.test(cmd.name)) throw new Error(tr("neplatný název proměnné „{0}“ – písmena, číslice, podtržítko; nesmí začínat číslicí", cmd.name));
  const prev = at >= 0 ? vars[at] : undefined;
  const v = { name: cmd.name, expr: cmd.expr, ...(cmd.note !== undefined ? (cmd.note ? { note: cmd.note } : {}) : prev?.note ? { note: prev.note } : {}) };
  if (at >= 0) vars[at] = v;
  else vars.push(v);
  const before0 = prev ? resolveVariables(doc.variables, cfg?.values ?? {}).values[cmd.name] : undefined;
  const { values, errors } = resolveVariables(vars, cfg?.values ?? {});
  if (errors[cmd.name]) throw new Error(tr("proměnná {0} = {1}: {2} – proměnné: {3}", cmd.name, cmd.expr, errors[cmd.name], (doc.variables ?? []).map((x) => x.name).join(", ") || "—"));
  doc.variables = vars;
  res.changed = true;
  const users = bindingsUsing(doc, cmd.name);
  res.touched = users.map((x) => x.f.id);
  res.log.push(
    `✓ ${tr("proměnná {0} = {1} → {2}", cmd.name, cmd.expr, fmt(values[cmd.name]))}${prev ? " " + tr("(bylo {0} → {1})", prev.expr, before0 !== undefined ? fmt(before0) : "–") : ""}${users.length ? "; " + tr("vazby: {0}", users.map((x) => `${x.f.name}.${x.path}`).join(", ")) : ""}`,
  );
  if (cfg && cmd.name in cfg.values) res.log.push(tr("⚠ aktivní konfigurace „{0}“ přepisuje {1} = {2} – výraz platí bez ní (konfigurace aktivní žádná)", cfg.name, cmd.name, fmt(cfg.values[cmd.name])));
  return res;
}
const cfgText = (doc: CadDoc, c: Config) => {
  const vals = Object.entries(c.values).map(([k, v]) => `${k} = ${fmt(v)}`);
  const sup = c.suppressed.map((id) => doc.features.find((f) => f.id === id)?.name).filter(Boolean);
  return [vals.join(", "), sup.length ? tr("potlačeno: {0}", sup.join(", ")) : ""].filter(Boolean).join("; ") || tr("beze změn proti výchozímu stavu");
};
function findConfig(doc: CadDoc, name: string): Config | undefined {
  const q = name.trim();
  return doc.configs?.find((c) => c.id === q || c.name.toLowerCase() === q.toLowerCase()) ?? doc.configs?.find((c) => fold(c.name) === fold(q));
}
function configs(res: EditResult, cmd: Extract<EditCmd, { kind: "config" | "configActive" | "configDelete" | "configs" }>): EditResult {
  const doc = res.doc;
  const list = [...(doc.configs ?? [])];
  const names = () => list.map((c) => c.name).join(", ") || "—";
  if (cmd.kind === "configs") {
    if (!list.length) res.log.push(tr("Konfigurace: žádné – založíte: konfigurace \"Krátká\" t=10 [potlačit \"Díra 1\"]"));
    else res.log.push(tr("Konfigurace ({0}): {1}", list.length, list.map((c) => `${c.name}${c.id === doc.activeConfig ? tr(" (aktivní)") : ""}: ${cfgText(doc, c)}`).join(" · ")));
    if (!doc.activeConfig && list.length) res.log.push(tr("  aktivní: žádná (výchozí hodnoty proměnných)"));
    return res;
  }
  if (cmd.kind === "configActive") {
    if (cmd.name === null) {
      res.changed = !!doc.activeConfig;
      doc.activeConfig = null;
      res.log.push(tr("✓ aktivní konfigurace: žádná (výchozí hodnoty proměnných, bez potlačení konfigurací)"));
      return res;
    }
    const c = findConfig(doc, cmd.name);
    if (!c) throw new Error(tr("konfigurace „{0}“ není – konfigurace: {1}", cmd.name, names()));
    res.changed = doc.activeConfig !== c.id;
    doc.activeConfig = c.id;
    res.log.push(tr("✓ aktivní konfigurace „{0}“: {1}", c.name, cfgText(doc, c)));
    return res;
  }
  if (cmd.kind === "configDelete") {
    const c = findConfig(doc, cmd.name);
    if (!c) throw new Error(tr("konfigurace „{0}“ není – konfigurace: {1}", cmd.name, names()));
    doc.configs = list.filter((x) => x !== c);
    if (doc.activeConfig === c.id) doc.activeConfig = null;
    res.changed = true;
    res.log.push(tr("✓ konfigurace „{0}“ smazána", c.name));
    return res;
  }
  const vars = doc.variables ?? [];
  const old = findConfig(doc, cmd.name);
  const c: Config = old ? { ...old, values: { ...old.values }, suppressed: [...old.suppressed] } : { id: uid(), name: cmd.name.trim(), values: {}, suppressed: [] };
  const scope = resolveVariables(vars, {}).values;
  for (const [k, raw] of cmd.values) {
    if (!vars.some((v) => v.name === k)) throw new Error(tr("konfigurace: proměnná „{0}“ není – proměnné: {1} (založíte: proměnná {0} = …)", k, vars.map((v) => v.name).join(", ") || "—"));
    let v: number;
    try {
      v = evalExpr(raw, scope);
    } catch (e) {
      throw new Error(tr("konfigurace: {0}={1}: {2}", k, raw, (e as Error).message));
    }
    c.values[k] = v;
  }
  if (cmd.suppress) c.suppressed = cmd.suppress.length ? takeFeatures(doc, cmd.suppress).map((f) => f.id) : [];
  doc.configs = old ? list.map((x) => (x === old ? c : x)) : [...list, c];
  res.changed = true;
  const active = doc.activeConfig === c.id;
  res.log.push(`✓ ${old ? tr("konfigurace „{0}“ upravena: {1}", c.name, cfgText(doc, c)) : tr("konfigurace „{0}“ založena: {1}", c.name, cfgText(doc, c))}${active ? tr(" (aktivní)") : " – " + tr("aktivujete: konfigurace aktivní \"{0}\"", c.name)}`);
  return res;
}
/** Řádky textového stavu: vazby parametrů na proměnné s hodnotami a konfigurace (aktivní označená). */
export function paramStatusLines(doc: CadDoc): string[] {
  const out: string[] = [];
  const cfg = activeCfg(doc);
  const { values } = resolveVariables(doc.variables, cfg?.values ?? {});
  const binds = Object.entries(doc.bindings ?? {}).flatMap(([k, expr]) => {
    const f = doc.features.find((x) => x.id === k.slice(0, k.indexOf(":")));
    if (!f) return [];
    let val: string;
    try {
      val = fmt(evalExpr(expr, values));
    } catch (e) {
      val = "✗ " + (e as Error).message;
    }
    return [`${f.name}.${k.slice(k.indexOf(":") + 1)} = ${expr} (= ${val})`];
  });
  if (binds.length) out.push(tr("Vazby parametrů: {0}", binds.join("; ")));
  if (doc.configs?.length) out.push(tr("Konfigurace: {0}", doc.configs.map((c) => c.name + (c.id === doc.activeConfig ? tr(" (aktivní)") : "")).join(", ")));
  return out;
}

/* ───────────────────────── zpět / znovu ───────────────────────── */
export type Hist<T> = { past: T[]; present: T; future: T[] };
/** N kroků historie zpět / znovu (stejně jako Ctrl+Z / Ctrl+Y); `moved` = kolik kroků se skutečně provedlo */
export function histStep<T>(h: Hist<T>, dir: "undo" | "redo", n: number): { hist: Hist<T>; moved: number } {
  let { past, present, future } = h;
  let moved = 0;
  for (; moved < n; moved++) {
    if (dir === "undo") {
      if (!past.length) break;
      future = [present, ...future];
      present = past[past.length - 1];
      past = past.slice(0, -1);
    } else {
      if (!future.length) break;
      past = [...past, present];
      present = future[0];
      future = future.slice(1);
    }
  }
  return { hist: moved ? { ...h, past, present, future } : h, moved };
}
/** řádek protokolu po zpět / znovu */
export function historyText(dir: "undo" | "redo", n: number, moved: number, h: { past: unknown[]; future: unknown[] }): string {
  const rest = tr("(zbývá zpět {0}, znovu {1})", h.past.length, h.future.length);
  if (!moved) return `✗ ${dir === "undo" ? tr("zpět: historie je prázdná – není co vrátit") : tr("znovu: není co obnovit (žádný vrácený krok)")} ${rest}`;
  const head = dir === "undo" ? tr("✓ zpět o {0} krok(ů)", moved) : tr("✓ znovu {0} krok(ů)", moved);
  return `${head}${moved < n ? " " + tr("– víc kroků v historii není") : ""} ${rest}`;
}

/* ───────────────────────── úpravy existující skici ───────────────────────── */
const ENT_ALIAS: Record<string, string> = Object.fromEntries(
  (
    [
      ["construction", "pomocna", "pomocny", "pomocne", "construction", "hilfs", "hilfslinie", "konstruktion", "konstrukcni"],
      ["r", "polomer", "radius", "halbmesser", "r"],
      ["diameter", "prumer", "diameter", "durchmesser", "d"],
      ["center", "stred", "center", "centre", "mitte"],
      ["angle", "uhel", "angle", "winkel", "natoceni"],
      ["width", "sirka", "width", "breite", "w"],
      ["height", "vyska", "height", "hohe", "hoehe", "h"],
      ["length", "delka", "length", "lange", "laenge", "l"],
      ["sides", "stran", "strany", "sides", "seiten", "n"],
      ["closed", "uzavrena", "uzavreny", "uzavrit", "closed", "geschlossen"],
      ["points", "body", "points", "punkte"],
    ] as const
  ).flatMap(([k, ...names]) => names.map((n) => [n, k] as const)),
);
const vec2 = (v: unknown, key: string): Vec2 => {
  if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number")) return [v[0], v[1]];
  throw new Error(tr("„{0}“ čeká bod x;y (např. {0}=10;5)", key));
};
const pos = (v: unknown, key: string): number => {
  if (typeof v !== "number" || !(v > 0)) throw new Error(tr("„{0}“ čeká kladné číslo", key));
  return v;
};
/** `entita e3 klíč=hodnota …` – nová podoba entity (bez řešení vazeb) */
function patchEntity(e: SketchEntity, pairs: [string, string][]): { e: SketchEntity; changes: string[] } {
  const n = clone(e) as SketchEntity & Record<string, unknown>;
  const changes: string[] = [];
  const keys = Object.keys(e).filter((k) => k !== "id" && k !== "type" && k !== "autoClose");
  if (pairs.some(([k]) => (ENT_ALIAS[fold(k)] ?? k) === "closed")) delete n.autoClose; // uzavření teď určil autor (poly-close.ts)
  for (const [key0, raw] of pairs) {
    const v = parseValue(raw);
    const a = ENT_ALIAS[fold(key0)] ?? key0;
    const set = (k: string, val: unknown) => {
      changes.push(`${k} ${show(n[k])} → ${show(val)}`);
      n[k] = val;
    };
    if (a === "construction") {
      if (typeof v !== "boolean") throw new Error(tr("„{0}“ čeká ano / ne", key0));
      changes.push(`${tr("pomocná")} ${show(!!n.construction)} → ${show(v)}`);
      if (v) n.construction = true;
      else delete n.construction;
    } else if (a === "diameter" && "r" in n && n.type !== "rect") set("r", pos(v, key0) / 2);
    else if (a === "center" && "cx" in n) {
      const c = vec2(v, key0);
      changes.push(`${tr("střed")} [${fmt(n.cx as number)}; ${fmt(n.cy as number)}] → [${fmt(c[0])}; ${fmt(c[1])}]`);
      n.cx = c[0];
      n.cy = c[1];
    } else if (a === "width" && (n.type === "rect" || n.type === "slot")) set(n.type === "rect" ? "w" : "width", pos(v, key0));
    else if (a === "height" && n.type === "rect") set("h", pos(v, key0));
    else if (a === "length" && n.type === "slot") set("length", pos(v, key0));
    else if (a === "points" && "points" in n) {
      const list = Array.isArray(v) ? v : [];
      if (list.length < 4 || list.length % 2 || !list.every((x) => typeof x === "number")) throw new Error(tr("„{0}“ čeká body x1;y1;x2;y2;… (aspoň dva)", key0));
      const pts: Vec2[] = [];
      for (let k = 0; k < list.length; k += 2) pts.push([list[k] as number, list[k + 1] as number]);
      set("points", pts);
    } else if (/^p\d+$/i.test(a) && "points" in n) {
      const k = Number(a.slice(1));
      const pts = [...(n.points as Vec2[])];
      if (k >= pts.length) throw new Error(tr("entita {0} má body p0–p{1}", e.id, pts.length - 1));
      changes.push(`${a} ${show(pts[k])} → ${show(vec2(v, key0))}`);
      pts[k] = vec2(v, key0);
      n.points = pts;
    } else if (n.type === "spline" && isSplineTangentKey(key0)) {
      const pt = patchSplineTangentKey(n as Extract<SketchEntity, { type: "spline" }>, key0, v)!; // tečny splinu: tečna-začátek=30, tečna-p1=vyp, váha-konec=2
      changes.push(pt.change);
      Object.assign(n, { tangents: pt.e.tangents, weights: pt.e.weights });
      if (!pt.e.tangents) delete n.tangents;
      if (!pt.e.weights) delete n.weights;
    } else if (keys.includes(a)) {
      const old = n[a];
      if (Array.isArray(old)) set(a, vec2(v, key0));
      else if (typeof old === "boolean") {
        if (typeof v !== "boolean") throw new Error(tr("„{0}“ čeká ano / ne", key0));
        set(a, v);
      } else if (typeof old === "number") {
        if (typeof v !== "number") throw new Error(tr("„{0}“ čeká číslo", key0));
        if (["r", "w", "h", "width", "length", "rx", "ry"].includes(a) && !(v > 0) && !(a === "r" && n.type === "rect" && v === 0)) throw new Error(tr("„{0}“ čeká kladné číslo", key0));
        if (a === "sides" && !(Number.isInteger(v) && v >= 3)) throw new Error(tr("počet stran mnohoúhelníku je celé číslo aspoň 3"));
        set(a, v);
      } else throw new Error(tr("„{0}“ nelze měnit", key0));
    } else throw new Error(tr("entita {0} ({1}) nemá „{2}“ – lze: {3}", e.id, e.type, key0, [...keys.filter((k) => k !== "construction"), tr("pomocná"), ...("r" in n && n.type !== "rect" ? [tr("průměr")] : []), ...("cx" in n ? [tr("střed")] : []), ...("points" in n ? ["p0…"] : [])].join(", ")));
  }
  return { e: n, changes };
}
/** odsazení: kladné d = vlevo od směru u otevřené entity, ven u uzavřené; u uzavřeného řetězce podle orientace */
function signedOffset(side: "out" | "in" | "left" | "right", d: number, closedShape: boolean, ccw?: boolean): number {
  const leftPos = side === "left" || side === "out";
  if (!closedShape) return leftPos ? d : -d;
  if (side === "left" || side === "right") throw new Error(tr("u uzavřeného tvaru zadejte stranu ven / dovnitř"));
  if (ccw === undefined) return side === "out" ? d : -d;
  // řetězec: kladně = vlevo; u řetězce proti směru hodin je vlevo uvnitř
  return (side === "out") !== ccw ? d : -d;
}
const chainCcw = (segs: ChainSeg[]): boolean => {
  const pts: Vec2[] = [];
  for (const s of segs) {
    pts.push(s.a);
    if (s.arc) {
      const t = (s.arc.t0 + s.arc.t1) / 2;
      pts.push([s.arc.c[0] + s.arc.r * Math.cos(t), s.arc.c[1] + s.arc.r * Math.sin(t)]);
    }
  }
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a > 0;
};
const CLOSED_TYPES = new Set(["circle", "rect", "polygon", "slot", "ellipse"]);

async function sketchEdit(res: EditResult, cmd: Extract<EditCmd, { kind: "entity" | "dimEdit" | "offset" | "project" }>, ctx: EditCtx, sketch?: SketchTarget): Promise<EditResult> {
  const doc = res.doc;
  const si = targetSketch(doc.features, sketch, ctx.openSketchId);
  const sk = doc.features[si] as SketchF;
  const finish = (next: SketchF, line: string) => {
    doc.features[si] = next;
    res.changed = true;
    res.touched = [sk.id, ...dependentsDeep(doc, [sk.id])];
    res.log.push(line);
    return res;
  };
  const solved = (next: SketchF): { feature: SketchF; text: string; ok: boolean } => {
    if (!next.constraints?.length && !next.dims?.length) return { feature: next, text: "", ok: true };
    const r = solveSketchFeature(next);
    return { feature: r.feature, text: ` → ${r.text}`, ok: r.ok };
  };
  if (cmd.kind === "entity") {
    const e = sk.entities.find((x) => x.id === cmd.id) ?? sk.entities.find((x) => x.id.toLowerCase() === cmd.id.toLowerCase());
    if (!e) throw new Error(tr("entita „{0}“ ve skice „{1}“ není – entity: {2}", cmd.id, sk.name, sk.entities.map((x) => x.id).join(", ") || "—"));
    const p = patchEntity(e, cmd.pairs);
    const m = addWithAutoClose({ ...sk, entities: sk.entities.map((x) => (x === e ? p.e : x)) }, []); // úprava může uzavřít obrys – automaticky uzavřené čáry znovu posoudit (poly-close.ts)
    const r = solved({ ...sk, ...m.patch });
    const after = r.feature.entities.find((x) => x.id === e.id)!;
    const out = finish(r.feature, `${r.ok ? "✓" : "⚠"} ${tr("entita {0} ve skice „{1}“: {2} = {3}{4}", e.id, sk.name, p.changes.join(", "), entityText(after), r.text)}`);
    out.log.push(...m.notes);
    return out;
  }
  if (cmd.kind === "dimEdit") {
    const n = Number(cmd.id.slice(1));
    const d = sk.dims?.[n - 1];
    if (!d) throw new Error(tr("kóta {0} ve skice „{1}“ není – {2}", cmd.id, sk.name, sketchCounts(sk)));
    const ents = new Map(sk.entities.map((x) => [x.id, x]));
    const nd: SketchDim = { ...d };
    const notes: string[] = [];
    if (cmd.value !== undefined) {
      if (d.type === "angle" && !(cmd.value > 0 && cmd.value < 180)) throw new Error(tr("kóta úhel: hodnota musí být mezi 0° a 180° (zadáno {0})", fmt(cmd.value)));
      if (d.type !== "angle" && !(cmd.value > 0) && !((d.type === "horizontal" || d.type === "vertical") && cmd.value === 0)) throw new Error(tr("kóta {0}: hodnota musí být kladná (zadáno {1})", cmd.id, fmt(cmd.value)));
      nd.value = cmd.value;
      if (!d.driving) notes.push(tr("referenční kóta se stala řídicí"));
      nd.driving = true;
    } else if (cmd.driving === false) {
      nd.driving = false;
      nd.value = Math.round((measureDim(ents, d) ?? d.value) * 1e6) / 1e6;
    } else {
      nd.driving = true;
      nd.value = Math.round((measureDim(ents, d) ?? d.value) * 1e6) / 1e6;
    }
    const trial: SketchF = { ...sk, dims: (sk.dims ?? []).map((x) => (x === d ? nd : x)) };
    const was = solveSketchFeature(sk);
    const r = solveSketchFeature(trial);
    const fresh = [...r.analysis.conflicts, ...r.analysis.redundant].filter((id) => ![...was.analysis.conflicts, ...was.analysis.redundant].includes(id));
    if (fresh.length || (was.ok && !r.ok)) throw new Error(tr("kóta {0} ({1}) nezměněna – {2}", cmd.id, describeDim(nd, ents), r.analysis.status === "over" ? tr("skicu by přeurčila (v rozporu s vazbami a kótami, nebo nadbytečná)") : tr("řešič nenašel řešení – hodnota nejde s dosavadními vazbami splnit")));
    return finish(r.feature, `${r.ok ? "✓" : "⚠"} ${tr("kóta {0} ve skice „{1}“: {2} → {3}", cmd.id, sk.name, describeDim(d, ents), describeDim(nd, ents))}${notes.length ? ` (${notes.join(", ")})` : ""} → ${r.text}`);
  }
  if (cmd.kind === "offset") {
    const made: SketchEntity[] = [];
    const parts: string[] = [];
    const done = new Set<string>();
    for (const id of cmd.ids) {
      if (done.has(id)) continue;
      const e = sk.entities.find((x) => x.id === id);
      if (!e) throw new Error(tr("entita „{0}“ ve skice „{1}“ není – entity: {2}", id, sk.name, sk.entities.map((x) => x.id).join(", ") || "—"));
      if (cmd.chain) {
        if (e.type !== "line" && e.type !== "arc") throw new Error(tr("řetězec začíná úsečkou nebo obloukem – {0} je {1}", e.id, e.type));
        const ch = chainOf(sk.entities, e.id);
        const out = offsetChain(ch.segs, ch.closed, signedOffset(cmd.side, cmd.dist, ch.closed, ch.closed ? chainCcw(ch.segs) : undefined), e.construction);
        if (!out?.length) throw new Error(tr("řetězec {0} nelze odsadit o {1} mm (oblouk by zanikl)", e.id, fmt(cmd.dist)));
        ch.segs.forEach((s) => done.add(s.id));
        made.push(...out);
        parts.push(tr("řetězec {0} ({1} úseků{2})", ch.segs.map((s) => s.id).join("+"), ch.segs.length, ch.closed ? tr(", uzavřený") : ""));
      } else {
        const closed = CLOSED_TYPES.has(e.type) || ((e.type === "polyline" || e.type === "spline") && e.closed);
        const o = offsetEntity(e, signedOffset(cmd.side, cmd.dist, closed));
        if (!o) throw new Error(tr("entitu {0} nelze odsadit o {1} mm (rozměr by zanikl)", e.id, fmt(cmd.dist)));
        made.push(o);
        parts.push(e.id);
      }
      done.add(id);
    }
    const ids = withTextIds(sk.entities, made);
    const side = { out: tr("ven"), in: tr("dovnitř"), left: tr("vlevo"), right: tr("vpravo") }[cmd.side];
    return finish({ ...sk, entities: [...sk.entities, ...ids] }, tr("✓ ve skice „{0}“ odsazeno o {1} mm {2}: {3} → nové entity {4}", sk.name, fmt(cmd.dist), side, parts.join(", "), ids.map((x) => x.id).join(", ")));
  }
  // promítnout hrany modelu (tělesa před skicou) do roviny skici
  const k = ctx.kernel;
  if (!k?.build) throw new Error(tr("promítnutí hran potřebuje jádro (v konzoli programu)"));
  const r = await k.build({ ...doc, features: doc.features.slice(0, si) });
  const mesh = r.mesh;
  if (!mesh || !mesh.lines.length) throw new Error(tr("před skicou „{0}“ není těleso – není co promítnout", sk.name));
  let lines: ArrayLike<number> = mesh.lines;
  if (Array.isArray(cmd.edges)) {
    const want = new Set(cmd.edges);
    const g = mesh.edgeGroups;
    let count = 0;
    const out: number[] = [];
    for (let j = 0; j + 2 < g.length; j += 3) {
      count = Math.max(count, g[j + 2] + 1);
      if (!want.has(g[j + 2])) continue;
      for (let q = g[j] * 3; q < (g[j] + g[j + 1]) * 3; q++) out.push(mesh.lines[q]);
    }
    const miss = cmd.edges.filter((e) => e >= count);
    if (miss.length) throw new Error(tr("hrana {0} v tělese před skicou není – hran je {1} (E1 až E{1})", miss.map((e) => `E${e + 1}`).join(", "), count));
    lines = out;
  }
  const ents = projectModelLines(lines, sk.plane, { inPlaneOnly: cmd.edges === "plane", construction: cmd.construction || undefined });
  if (!ents.length) throw new Error(cmd.edges === "plane" ? tr("žádná hrana modelu neleží v rovině skici „{0}“ – zadejte hrany čísly (promítnout hrany E3;E7) nebo vše", sk.name) : tr("průmět hran do skici „{0}“ je prázdný (hrany kolmé na rovinu skici)", sk.name));
  const ids = withTextIds(sk.entities, ents);
  const what = Array.isArray(cmd.edges) ? cmd.edges.map((e) => `E${e + 1}`).join(", ") : cmd.edges === "all" ? tr("všechny hrany") : tr("hrany v rovině skici");
  const idText = ids.length > 2 ? `${ids[0].id}–${ids[ids.length - 1].id}` : ids.map((x) => x.id).join(", ");
  return finish({ ...sk, entities: [...sk.entities, ...ids] }, tr("✓ do skici „{0}“ promítnuto ({1}): {2} úseček {3}{4}", sk.name, what, ids.length, idText, cmd.construction ? tr(" (pomocné)") : ""));
}
