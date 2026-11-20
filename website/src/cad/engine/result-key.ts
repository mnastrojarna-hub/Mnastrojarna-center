/**
 * Identita výsledku analýzy (vlna 22, bod 1 – „žádné falešné zelené“): výsledek kontroly (kolize, stav vazeb, měření,
 * porovnání s referencí, pohybová studie…) platí jen pro
 *
 *   klíč dokumentu (`Workspace.docKey`) + revizi geometrie + konfiguraci + polohu mechanismu,
 *
 * pro které vznikl. Všechno se skládá z klíčů, které už existují: `docKey` (id dokumentu záložky), `sourceKey` (obsah dílu:
 * prvky, proměnné, vazby parametrů, konfigurace) a `clashSig` (listy sestavy: díl, skrytí, světové matice = poloha).
 * Jiný klíč dokumentu = výsledek k dokumentu nepatří („nezkontrolováno“), jiný otisk = dokument se od výpočtu změnil
 * („neplatí“). Nikdy se neukáže zelený stav, který nejde ověřit – záznam bez otisku se bere jako neplatný.
 *
 * Kdo co používá:
 *  * kolize – `ws.asm.clash` (záznam s `sig`), stav `clashStateOf`; panel Kolize aplikace čte jen přes něj;
 *  * stav vazeb – `ws.asm.mateStatus` + razítko (`setMateStatus` / `mateStatusState`);
 *  * měření a porovnání s referencí – razítko na výsledku (`stampResult`) a poznámka v pracovním prostoru (`noteResult`),
 *    aby textový stav (`stav`) a řádek D uměly říct, že uložený výsledek už dokumentu neodpovídá (`staleResults`);
 *  * pohybová studie (balík M) – klíč `resultKey("motion", docKey, doc, studySig)` a sonda `registerStaleProbe`.
 *
 * Modul nemá stav dokumentů ani závislost na Reactu – stejný v prohlížeči i v CLI.
 */
import { flattenLeaves, type Leaf } from "../asm-flatten";
import { hashPair, sourceKey } from "../assembly";
import { clashSig } from "../clash-class";
import type { MateStatus } from "../mates";
import type { CadDoc } from "../types";
import type { DocKey, Workspace } from "./workspace";

/** druh uloženého výsledku */
export type ResultKind = "clash" | "mates" | "measure" | "compare" | "motion" | "inspect" | "overlay";

/** poloha mechanismu, pro kterou výsledek vznikl: polohy uložené v dokumentu, nebo zobrazený krok pohybové studie */
export type PoseRef = "doc" | "step";

/** identita výsledku – pro co byl spočítán */
export type ResultId = {
  kind: ResultKind;
  /** klíč dokumentu (`Workspace.docKey`) */
  doc: DocKey;
  /** otisk stavu: revize geometrie + konfigurace + poloha (díl `sourceKey`, sestava `clashSig`, vazby `mateSig`) */
  sig: string;
  /** krátká revize modelu `r·a1b2c3` (jen k zobrazení – shodu určuje `sig`) */
  rev: string;
  /** název dokumentu v době výpočtu */
  name: string;
  /** počet kontrolovaných komponent (sestava) */
  comps?: number;
  pose: PoseRef;
  /** čas výpočtu (text podle jazyka) */
  at?: string;
  /** řádek skriptu, na kterém výsledek vznikl (textové příkazy) */
  line?: number | null;
};

/** stav uloženého výsledku vůči nynějšímu stavu dokumentu */
export type ResultState = "ok" | "stale" | "unchecked";
/** stav panelu Kolize: platný výsledek bez průniku / s průniky, neplatný, žádný */
export type ClashState = "ok" | "clash" | "stale" | "unchecked";

/* ───────────────────────── otisky a revize ───────────────────────── */

/** 6 šestnáctkových znaků z otisku řetězce (tatáž FNV dvojice jako `sourceKey` – žádné druhé hashování) */
export function shortHash(s: string): string {
  return hashPair(s)[0].toString(16).padStart(8, "0").slice(0, 6);
}

/**
 * Otisk geometrie dokumentu: díl = `sourceKey` (prvky, proměnné, vazby parametrů, aktivní konfigurace a konfigurace),
 * sestava = `clashSig` (listy: cesta id, `sourceKey` dílu, skrytí, světové matice – tedy i poloha mechanismu), 2D výkres =
 * otisk entit. Stejný otisk = stejná geometrie ve stejné konfiguraci a poloze.
 */
export function geometrySig(doc: CadDoc): string {
  if (doc.kind === "assembly") return clashSig(doc);
  if (doc.kind === "draft") return `draft:${hashPair(JSON.stringify(doc.draft ?? null)).join(".")}`;
  return sourceKey({ kind: "part", doc });
}

/* ───────── revize nezávislá na náhodných id (fáze 2: stejný skript = stejná revize v prohlížeči, CLI i při opakování) ───────── */

/**
 * Id prvků, komponent, entit skici… vznikají náhodně (`uid()`), takže stejný skript dá v každém běhu jiná id. Otisk pro
 * revizi proto nahradí každé id (hodnotu klíče `id` kdekoli ve stromu) pořadovým `#n` podle prvního výskytu – i v odkazech
 * na ně (hodnoty jiných polí, klíče map, cesty `a/b`), takže odkaz zůstane odkazem na tentýž prvek. Stejná geometrie a stejné
 * odkazy = stejný text bez ohledu na náhodná id; jiný parametr / jiný odkaz = jiný text.
 */
function collectIds(root: unknown, out: Map<string, string>): Map<string, string> {
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) {
      for (const y of x) walk(y);
      return;
    }
    if (!x || typeof x !== "object") return;
    for (const [k, y] of Object.entries(x)) {
      if (k === "id" && typeof y === "string" && y && !out.has(y)) out.set(y, `#${out.size}`);
      walk(y);
    }
  };
  walk(root);
  return out;
}
/**
 * JSON s id nahrazenými podle `ids`: celé slovo z [A-Za-z0-9_-] (id z `uid()` i id s pomlčkou; odkazy skládají id s `/ : . |`
 * a mezerou, nikdy s písmenem) – jiný text beze změny
 */
function canonJson(v: unknown, ids: Map<string, string>): string {
  const s = JSON.stringify(v) ?? "";
  return ids.size ? s.replace(/[A-Za-z0-9_-]+/g, (m) => ids.get(m) ?? m) : s;
}
const partRevMemo = new WeakMap<object, string>();
/** otisk obsahu dílu pro revizi (prvky, proměnné, vazby parametrů, konfigurace – jako `sourceKey`, bez náhodných id) */
function partRevSig(d: CadDoc): string {
  let r = partRevMemo.get(d);
  if (r === undefined) {
    const o = { f: d.features, v: d.variables, b: d.bindings, c: d.activeConfig, cf: d.configs };
    r = hashPair(canonJson(o, collectIds(o, new Map()))).map((h) => h.toString(36)).join("");
    partRevMemo.set(d, r);
  }
  return r;
}
/** id komponent sestavy (i podsestav) v pořadí stromu – listy sestavy mají cestu z těchto id */
function compIds(comps: readonly { id: string; source: { kind: string; doc?: CadDoc } }[] | undefined, out: Map<string, string>): Map<string, string> {
  for (const c of comps ?? []) {
    if (c.id && !out.has(c.id)) out.set(c.id, `#${out.size}`);
    if (c.source.kind === "asm") compIds(c.source.doc?.components, out);
  }
  return out;
}

/**
 * Otisk, ze kterého vzniká revize modelu `r·xxxxxx` (`modelRev`): týž obsah jako `geometrySig` (díl = obsah dílu, sestava =
 * listy, jejich díly, skrytí a světové matice, 2D výkres = entity), ale bez náhodných id. Shodu výsledku s dokumentem dál určuje
 * `geometrySig` (s id – přísnější: jiná id = „neplatí“, slabší tvrzení), revize je jen k zobrazení a záznamům (soubor, export,
 * řádky F a D, PDF), kde musí být stejná pro tentýž model v prohlížeči i v CLI.
 */
export function revisionSig(doc: CadDoc): string {
  if (doc.kind === "assembly") {
    const ids = compIds(doc.components, new Map());
    const q = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
    const leaves = flattenLeaves(doc).map((l) => [l.id, l.comp.source.kind === "part" ? partRevSig(l.comp.source.doc) : l.key, l.hidden ? 1 : 0, l.matrix.map(q)]);
    return `asm:${canonJson(leaves, ids)}`;
  }
  if (doc.kind === "draft") {
    const dr = doc.draft ?? null;
    return `draft:${canonJson(dr, collectIds(dr, new Map()))}`;
  }
  return `part:${partRevSig(doc)}`;
}

/** krátká revize modelu k zobrazení: `r·` + 6 šestnáctkových znaků otisku `revisionSig` (stejný model = stejná revize všude) */
export function modelRev(doc: CadDoc): string {
  return revOf(revisionSig(doc));
}
/** krátká revize z hotového otisku (když ho volající už má) */
export const revOf = (sig: string): string => `r·${shortHash(sig)}`;

/**
 * Otisk sestavy z už spočítaných listů (`flattenLeaves(doc)`) – přesně týž řetězec jako `clashSig(doc)` (hlídá test), bez
 * dalšího rozkladu sestavy: aplikace listy zobrazené sestavy má a otisk potřebuje při každém překreslení.
 */
export function leavesSig(leaves: readonly Pick<Leaf, "id" | "key" | "hidden" | "matrix">[]): string {
  const q = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
  return JSON.stringify(leaves.map((l) => [l.id, l.key, l.hidden ? 1 : 0, l.matrix.map(q)]));
}

/**
 * Otisk, pro který platí stav vazeb sestavy: geometrie a polohy listů (`clashSig`), ukotvení komponent a vazby samotné
 * (plochy, hodnoty, otočení, potlačení). Posunutá komponenta, upravený díl, změněná nebo smazaná vazba, krok zpět = jiný otisk.
 */
export function mateSig(doc: CadDoc): string {
  return mateSigOf(doc, clashSig(doc));
}
/** otisk vazeb z hotového otisku sestavy `sig` (= `clashSig(doc)` / `leavesSig(listy)`) */
export function mateSigOf(doc: CadDoc, sig: string): string {
  return `${sig}|${JSON.stringify([(doc.components ?? []).map((c) => [c.id, c.fixed ? 1 : 0]), doc.mates ?? []])}`;
}

/**
 * Jeden řetězcový klíč výsledku pro mezipaměti (balík M: mezipaměť pohybové studie = `Map<resultKey, výsledek>`):
 * druh + klíč dokumentu + otisk geometrie / konfigurace / polohy + vlastní část (např. otisk studie: motory, kroky, volby).
 */
export function resultKey(kind: ResultKind, docKey: DocKey, doc: CadDoc, extra = ""): string {
  const [h1, h2] = hashPair(geometrySig(doc));
  return `${kind}|${docKey}|${h1.toString(36)}${h2.toString(36)}|${extra}`;
}

/** identita výsledku pro dokument `doc` pod klíčem `docKey`; `sig` výchozí = otisk geometrie (`geometrySig`) */
export function resultId(kind: ResultKind, docKey: DocKey, doc: CadDoc, o: Partial<Pick<ResultId, "sig" | "comps" | "pose" | "at" | "line">> = {}): ResultId {
  return {
    kind,
    doc: docKey,
    sig: o.sig ?? geometrySig(doc),
    rev: modelRev(doc),
    name: doc.name,
    pose: o.pose ?? "doc",
    ...(o.comps !== undefined ? { comps: o.comps } : {}),
    ...(o.at !== undefined ? { at: o.at } : {}),
    ...(o.line !== undefined ? { line: o.line } : {}),
  };
}

/* ───────────────────────── razítko na výsledku ───────────────────────── */

const stamps = new WeakMap<object, ResultId>();

/** označí objekt výsledku identitou, pro kterou vznikl (objekt se nemění – razítko je vedle něj) */
export function stampResult<T extends object>(value: T, id: ResultId): T {
  stamps.set(value, id);
  return value;
}
/** identita, pro kterou výsledek vznikl (bez razítka undefined) */
export function resultIdOf(value: object | null | undefined): ResultId | undefined {
  return value ? stamps.get(value) : undefined;
}

/**
 * Stav výsledku vůči nynějšímu stavu: bez výsledku nebo výsledek jiného dokumentu = „unchecked“ (k tomuto dokumentu nic není),
 * jiný otisk nebo výsledek bez razítka = „stale“ (nelze doložit, že platí), jinak „ok“.
 */
export function resultState(value: object | null | undefined, cur: { doc: DocKey; sig: string }): ResultState {
  if (!value) return "unchecked";
  const id = stamps.get(value);
  if (!id) return "stale";
  if (id.doc !== cur.doc) return "unchecked";
  return id.sig === cur.sig ? "ok" : "stale";
}

/* ───────────────────────── kolize ───────────────────────── */

type ClashEntryLike = { res: readonly unknown[]; sig?: string };

/**
 * Stav záznamu kontroly kolizí dokumentu vůči otisku NYNĚJŠÍHO zobrazeného stavu sestavy (`clashSig` dokumentu, při
 * zobrazeném kroku pohybové studie dokumentu v poloze kroku). Záznam bez otisku se nedá ověřit → „stale“.
 */
export function clashStateOf(entry: ClashEntryLike | null | undefined, sigNow: string): ClashState {
  if (!entry) return "unchecked";
  if (!entry.sig || entry.sig !== sigNow) return "stale";
  return entry.res.length ? "clash" : "ok";
}
/** stav kontroly kolizí sestavy `doc` pod klíčem `key` (polohy z dokumentu) */
export function clashState(ws: Workspace, key: DocKey, doc: CadDoc): ClashState {
  return doc.kind === "assembly" ? clashStateOf(ws.asm.clash.get(key), clashSig(doc)) : "unchecked";
}

/* ───────────────────────── stav vazeb ───────────────────────── */

/**
 * Uloží stav vazeb pod klíčem dokumentu s razítkem stavu sestavy, který popisuje: `doc` = sestava, pro kterou stav platí
 * (po řešení = sestava s polohami z řešiče). Jediná cesta zápisu – čtení bez razítka se bere jako neplatné.
 */
export function setMateStatus(ws: Workspace, key: DocKey, doc: CadDoc, status: Record<string, MateStatus>): Record<string, MateStatus> {
  stampResult(status, resultId("mates", key, doc, { sig: mateSig(doc), comps: (doc.components ?? []).length }));
  ws.asm.mateStatus.set(key, status);
  return status;
}

/**
 * Stav vazeb dokumentu a jeho platnost pro NYNĚJŠÍ stav sestavy: „ok“ = spočítán přesně pro tyto polohy, díly a vazby;
 * „stale“ = sestava se od výpočtu změnila (nebo stav popisuje polohy po přepočtu, které v dokumentu nejsou);
 * „unchecked“ = žádný stav. Zelené „splněno“ smí ukázat jen „ok“.
 */
export function mateStatusState(ws: Workspace, key: DocKey, doc: CadDoc): { status?: Record<string, MateStatus>; state: ResultState } {
  const status = ws.asm.mateStatus.get(key);
  if (!status) return { state: "unchecked" };
  if (doc.kind !== "assembly") return { status, state: "stale" };
  return { status, state: resultState(status, { doc: key, sig: mateSig(doc) }) };
}

/* ───────────────────────── poznámky o uložených výsledcích (měření, porovnání) ───────────────────────── */

/** poznámky visí na mezipamětech sestavy pracovního prostoru (`ws.asm` – stejný objekt i za obalem prostoru v CLI / serve) */
const notes = new WeakMap<object, Map<string, ResultId>>();
const noteKey = (kind: ResultKind, doc: DocKey) => `${kind}|${doc}`;

/** poslední výsledek druhu `id.kind` dokumentu `id.doc` (měření, porovnání s referencí) – pro `stav` a řádek D */
export function noteResult(ws: Workspace, id: ResultId): void {
  let m = notes.get(ws.asm);
  if (!m) notes.set(ws.asm, (m = new Map()));
  m.set(noteKey(id.kind, id.doc), id);
}
/** zapomene uložené výsledky dokumentu (dokument nahrazen jiným / výsledek zahozen); bez `kind` všechny druhy */
export function dropResults(ws: Workspace, doc: DocKey, kind?: ResultKind): void {
  const m = notes.get(ws.asm);
  if (!m) return;
  for (const k of [...m.keys()]) if (k.endsWith(`|${doc}`) && (!kind || k.startsWith(`${kind}|`))) m.delete(k);
}
/** poznamenané výsledky dokumentu */
export function notedResults(ws: Workspace, doc: DocKey): ResultId[] {
  return [...(notes.get(ws.asm)?.values() ?? [])].filter((x) => x.doc === doc);
}

/** další druhy uložených výsledků (balík M: pohybová studie) – sonda vrátí true, když uložený výsledek dokumentu neplatí */
type StaleProbe = (ws: Workspace, key: DocKey, doc: CadDoc) => boolean;
const probes = new Map<ResultKind, StaleProbe>();
export function registerStaleProbe(kind: ResultKind, probe: StaleProbe): void {
  probes.set(kind, probe);
}

/** pevné pořadí druhů ve výpisu `stale=` */
const STALE_ORDER: ResultKind[] = ["clash", "mates", "motion", "measure", "compare", "inspect", "overlay"];

/**
 * Druhy uložených výsledků dokumentu, které pro jeho nynější stav NEPLATÍ (řádek D `stale=…`, `stav`): kontrola kolizí
 * s jiným otiskem, stav vazeb pro jiný stav sestavy, měření / porovnání s referencí z dřívější revize, sondy dalších balíků.
 * Výsledek, který nikdy nevznikl, zastaralý není (to je „nezkontrolováno“).
 */
export function staleResults(ws: Workspace, key: DocKey, doc: CadDoc): ResultKind[] {
  const out = new Set<ResultKind>();
  if (doc.kind === "assembly") {
    if (clashState(ws, key, doc) === "stale") out.add("clash");
    if ((doc.mates ?? []).length && mateStatusState(ws, key, doc).state === "stale") out.add("mates");
  }
  if (doc.kind !== "draft") {
    const geo = geometrySig(doc);
    for (const id of notedResults(ws, key)) if (id.sig !== geo) out.add(id.kind);
  }
  for (const [kind, probe] of probes) {
    try {
      if (probe(ws, key, doc)) out.add(kind);
    } catch {
      /* sonda cizího balíku nesmí shodit stav dokumentu */
    }
  }
  return STALE_ORDER.filter((k) => out.has(k));
}
