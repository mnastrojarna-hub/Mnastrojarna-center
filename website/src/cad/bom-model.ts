/**
 * Model kusovníku (vlna 22, body 22g a 19) – jediné místo, které rozhoduje, co se o položce kusovníku napíše:
 *
 *  * druh položky: vyráběný díl (výkres, číslo výkresu, označení materiálu), normálie (norma, rozměr, pevnostní třída /
 *    tolerance) a nakupovaný díl (katalogové číslo, výrobce) – `supplyOf`. Druh se zadá na komponentě (přepis), na dílu
 *    (zdroj), jinak platí výchozí: importovaný soubor / díl jen z importu (STEP bez prvků) → nakupovaný, normálie z knihovny
 *    (skupina Normálie, číslo podle normy ISO / DIN / EN…) → normálie, vlastní díl → vyráběný;
 *  * materiál a hmotnost řádku – `bomPartInfo` (stejná funkce pro text, CLI, aplikaci i výkres): vyráběný díl = označení
 *    materiálu dílu, bez něj „— (třída Ocel)“ (nikdy tiché „Ocel“); normálie = pevnostní třída (12.9, 8.8, A2-70, 200 HV),
 *    jinak „dle normy“; třída materiálu v jazyce rozhraní v okamžiku volání (MATERIALS se překládá při načtení modulu);
 *  * CSV: jeden zapisovač pro kusovník sestavy i kusovník výkresu (`bomCsvText`), desetinný oddělovač podle jazyka
 *    (čeština a němčina čárka, angličtina tečka), oddíly podle druhu (sloupec Druh, řádky seřazené vyráběné → normálie →
 *    nakupované);
 *  * upozornění kusovníku a úplnost dokumentace (`bomNotes`, `docSupply`): vyráběný díl bez čísla / bez výkresu / bez
 *    označení materiálu, souhrn „vyráběné 2 (1 bez výkresu), normálie 2, nakupované 0“.
 *
 * Čisté funkce bez Reactu – stejné v prohlížeči i v CLI. Kusovník na listu (drawing.ts `partsList`) a balík D4 (čitelnost
 * listu) staví na stejných polích řádku.
 */
import { MATERIALS, massKg } from "@/lib/mesh-metrics";
import { groupKey } from "./asm-groups";
import { getLang, tr } from "./i18n";
import type { AsmComponent, BuildResult, CadDoc, SupplyInfo, SupplyKind } from "./types";

/** pořadí oddílů kusovníku */
export const SUPPLY_KINDS: readonly SupplyKind[] = ["make", "standard", "buy"];
export const supplyRank = (k: SupplyKind | undefined): number => (k ? SUPPLY_KINDS.indexOf(k) : 0);

/** druh jedním slovem (výpis komponent, sloupec CSV, GUI) */
export const supplyWord = (k: SupplyKind): string => (k === "make" ? tr("vyráběný") : k === "standard" ? tr("normálie") : tr("nakupovaný"));
/** nadpis oddílu kusovníku */
export const supplySection = (k: SupplyKind): string => (k === "make" ? tr("Vyráběné díly") : k === "standard" ? tr("Normálie") : tr("Nakupované díly"));

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").trim();
/** slova druhu (CS / EN / DE, bez diakritiky); „auto“ = zrušit ruční volbu (platí výchozí) */
const KIND_WORDS: Record<string, SupplyKind | "auto"> = {
  vyrabeny: "make", vyrabena: "make", vyrabene: "make", vyrobit: "make", vlastni: "make", make: "make", made: "make", manufactured: "make", fertigung: "make", fertigungsteil: "make", eigenteil: "make",
  normalie: "standard", normalii: "standard", norma: "standard", standard: "standard", "standard-part": "standard", std: "standard", normteil: "standard", norm: "standard",
  nakupovany: "buy", nakupovana: "buy", nakupovane: "buy", nakup: "buy", koupit: "buy", buy: "buy", bought: "buy", purchased: "buy", kauf: "buy", kaufteil: "buy", zukauf: "buy", zukaufteil: "buy",
  auto: "auto", vychozi: "auto", automaticky: "auto", default: "auto", automatisch: "auto", standardwert: "auto",
};
/** druh ze slova textového příkazu nebo GUI (null = neznámé slovo) */
export function supplyKindOf(word: string): SupplyKind | "auto" | null {
  return KIND_WORDS[fold(word)] ?? null;
}
/** slova druhu pro nápovědu v hlášce o neznámém slově */
export const supplyWordsHelp = (): string => tr("vyráběný | normálie | nakupovaný | auto");

/** číslo podle normy (ISO 4762 – …, DIN 912 …, EN …, ČSN …) – pozná normálii u starších dokumentů bez druhu */
const STD_RE = /^(ISO|DIN|EN|ČSN|CSN|ANSI|ASME|JIS|GB|UNI|NF|SN)\s?\d/i;
/** označení podle normy (ISO / DIN / EN / ČSN … + číslo) – celé označení z knihovny smí nahradit číslo generátoru */
export const isStandardDesignation = (s: string | undefined): boolean => !!s && STD_RE.test(s.trim());
/** pevnostní třída / třída vlastností (12.9, 8.8, 8, 10, A2-70, A4-80, 200 HV) – materiál normálie v kusovníku */
export const isStrengthClass = (g: string | undefined): boolean => !!g && /^(\d{1,2}(\.\d)?|A[1-5]-\d{2,3}|\d{2,3}\s?HV)$/i.test(g.trim());

/**
 * Označení normálie rozdělené na normu, rozměr a třídu / toleranci: „ISO 4762 – M12×40 – 12.9“ → ISO 4762 · M12×40 · 12.9,
 * „ISO 8734 – 8×30 – m6“ → ISO 8734 · 8×30 · m6. Bez normy na začátku zůstane celé označení rozměrem.
 */
export function stdParts(designation: string | undefined): { standard?: string; size?: string; grade?: string } {
  const s = (designation ?? "").trim();
  if (!s) return {};
  const parts = s.split(/\s+[–—-]\s+/).map((x) => x.trim()).filter(Boolean);
  if (!STD_RE.test(parts[0] ?? "")) return { size: s };
  return { standard: parts[0], ...(parts[1] ? { size: parts[1] } : {}), ...(parts.length > 2 ? { grade: parts.slice(2).join(" – ") } : {}) };
}

/** díl je jen importovaný model (STEP / IGES bez vlastních prvků) – výchozí druh nakupovaný */
export const importOnly = (d: CadDoc): boolean => d.features.length > 0 && d.features.every((f) => f.type === "import");

/** číslo výkresu / normy řádku: z komponenty, jinak z vlastností vloženého dílu */
export const compNumber = (c: AsmComponent): string | undefined => c.number?.trim() || (c.source.kind === "part" ? c.source.doc.props?.number?.trim() : undefined) || undefined;

/** výchozí druh dílu bez ruční volby a důvod (pro výpis a GUI „výchozí: …“) */
export function defaultSupply(c: AsmComponent): { kind: SupplyKind; why: "file" | "import" | "library" | "own" } {
  if (c.source.kind === "file") return { kind: "buy", why: "file" };
  if (c.source.kind === "part" && importOnly(c.source.doc)) return { kind: "buy", why: "import" };
  if (c.source.kind === "part" && (groupKey(c.group) === "Normálie" || STD_RE.test(compNumber(c) ?? ""))) return { kind: "standard", why: "library" };
  return { kind: "make", why: "own" };
}

export type Supply = SupplyInfo & { kind: SupplyKind; /** druh zadaný ručně (komponenta / díl), ne výchozí */ explicit: boolean; why: "component" | "part" | "file" | "import" | "library" | "own" };

const defined = (o: SupplyInfo | undefined): SupplyInfo => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== "")) as SupplyInfo;

/**
 * Druh položky komponenty a její údaje: komponenta (přepis) > díl (zdroj) > výchozí podle původu. Normálie bez rozepsané
 * normy si normu, rozměr a třídu vezme z čísla (označení z knihovny).
 */
export function supplyOf(c: AsmComponent): Supply {
  const part = c.source.kind === "part" ? c.source.doc : undefined;
  const info: SupplyInfo = { ...defined(part?.supply), ...defined(c.supply) };
  const own = c.supply?.kind ? "component" : part?.supply?.kind ? "part" : null;
  const def = own ? null : defaultSupply(c);
  const kind = (own ? info.kind : def!.kind) as SupplyKind;
  const out: Supply = { ...info, kind, explicit: !!own, why: own ?? def!.why };
  if (kind === "standard") {
    const d = stdParts(compNumber(c));
    out.standard ??= d.standard;
    out.size ??= d.size;
    out.grade ??= d.grade;
  }
  return out;
}

/* ───────────────────────── materiál a hmotnost ───────────────────────── */

/** české klíče tříd materiálu (MATERIALS.label se překládá při načtení modulu – v CLI ještě před volbou jazyka) */
const CLASS_KEY: Record<string, string> = { ocel: "Ocel", nerez: "Nerez", hlinik: "Hliník", mosaz: "Mosaz", med: "Měď", titan: "Titan", pom: "POM (plast)" };
/** třída materiálu (hustota) v jazyce rozhraní v okamžiku volání; označení oceli (1.2311 …) beze změny */
export function materialClassLabel(id: string | undefined): string {
  const k = id ?? "ocel";
  if (CLASS_KEY[k]) return tr(CLASS_KEY[k]);
  const mt = MATERIALS.find((x) => x.id === k);
  return (mt?.label ?? k).split(" – ")[0];
}
const densityOf = (id: string | undefined) => MATERIALS.find((x) => x.id === (id ?? "ocel"))?.density ?? 7.85;

export type BomPartInfo = { material?: string; massKg?: number; /** vyráběný díl bez označení materiálu – v kusovníku jen třída */ noDesignation?: boolean };

/**
 * Materiál a hmotnost komponenty do kusovníku – JEDNA funkce pro text (`kusovník`), CLI (CSV, list sestavy) a aplikaci
 * (tabulka Kusovník, výkresové prostředí). `r` = výsledek stavby dílu (hmotnost z objemu a hustoty třídy).
 */
export function bomPartInfo(c: AsmComponent, r: BuildResult | null | undefined): BomPartInfo {
  const part = c.source.kind === "part" ? c.source.doc : undefined;
  const matId = part ? part.material : (c.material ?? "ocel");
  const mass = r?.metrics ? massKg(r.metrics.volume, densityOf(matId)) : undefined;
  const named = part?.materialName?.trim();
  const cls = materialClassLabel(matId);
  if (c.source.kind === "asm") return { massKg: mass };
  const s = supplyOf(c);
  if (s.kind === "standard") {
    if (isStrengthClass(s.grade)) return { material: s.grade!.trim(), massKg: mass };
    if (named) return { material: named, massKg: mass };
    // normálie z jiné oceli než výchozí třídy (1.7131 vodicí sloupek) – označení oceli; obecná ocel = podle normy
    return { material: matId && matId !== "ocel" && !CLASS_KEY[matId] ? cls : tr("dle normy"), massKg: mass };
  }
  if (named) return { material: named, massKg: mass };
  // nakupovaný díl: třída stačí; třída, která sama je označením oceli (1.2311, 1.7131 …), je označení i u vyráběného dílu
  if (s.kind === "buy" || !CLASS_KEY[matId ?? "ocel"]) return { material: cls, massKg: mass };
  return { material: tr("— (třída {0})", cls), massKg: mass, noDesignation: true };
}

/* ───────────────────────── čísla a CSV ───────────────────────── */

/** desetinná čárka (čeština, němčina) nebo tečka (angličtina) – CSV a texty kusovníku */
export const decimalComma = (): boolean => getLang() !== "en";
/** číslo do buňky CSV podle jazyka: pevný počet míst, čárka / tečka */
export function csvNum(n: number | undefined, digits = 3): string {
  if (n == null || !Number.isFinite(n)) return "";
  const s = n.toFixed(digits);
  return decimalComma() ? s.replace(".", ",") : s;
}
/** popis CSV do protokolu: oddělovač a desetinný oddělovač */
export const csvCaption = (): string => (decimalComma() ? tr("CSV (oddělovač ;, desetinná čárka):") : tr("CSV (oddělovač ;, desetinná tečka):"));

/** řádek kusovníku pro CSV a list (společná pole `BomRow` sestavy a `BomItem` výkresu) */
export type BomLine = {
  pos: number;
  name: string;
  number?: string;
  qty: number;
  material?: string;
  massKg?: number;
  group?: string;
  note?: string;
  level?: number;
  kind?: SupplyKind;
  standard?: string;
  size?: string;
  grade?: string;
  catalog?: string;
  vendor?: string;
  noDesignation?: boolean;
};

const esc = (s: string | number | undefined) => {
  const t = s == null ? "" : String(s);
  return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/**
 * Kusovník jako CSV pro Excel (středníky, UTF-8 s BOM, CRLF): Pozice; Název; Číslo výkresu / norma; Ks; Materiál; Hmotnost
 * 1 ks; Hmotnost celkem; Druh; Norma; Rozměr; Třída / tolerance; Katalogové číslo; Výrobce; Skupina (+ Poznámka, má-li ji
 * některý řádek). Řádky v pořadí pozic (oddíly podle druhu), čísla s desetinným oddělovačem jazyka. `groupLabel` = název
 * skupiny v jazyce rozhraní (asm-groups.ts).
 */
export function bomCsvText(rows: readonly BomLine[], groupLabel: (g?: string) => string = (g) => g ?? ""): string {
  const withNote = rows.some((r) => r.note);
  const head = [tr("Pozice"), tr("Název"), tr("Číslo výkresu / norma"), tr("Ks"), tr("Materiál"), tr("Hmotnost 1 ks [kg]"), tr("Hmotnost celkem [kg]"), tr("Druh"), tr("Norma"), tr("Rozměr"), tr("Třída / tolerance"), tr("Katalogové číslo"), tr("Výrobce"), tr("Skupina"), ...(withNote ? [tr("Poznámka")] : [])];
  const lines = [...rows]
    .sort((a, b) => a.pos - b.pos)
    .map((r) =>
      [
        r.pos,
        r.name,
        r.number,
        r.qty,
        r.material,
        csvNum(r.massKg),
        r.massKg != null ? csvNum(r.massKg * r.qty) : "",
        r.kind ? supplyWord(r.kind) : "",
        r.standard,
        r.size,
        r.grade,
        r.catalog,
        r.vendor,
        r.group ? groupLabel(r.group) : "",
        ...(withNote ? [r.note] : []),
      ]
        .map(esc)
        .join(";"),
    );
  return "﻿" + [head.map(esc).join(";"), ...lines].join("\r\n") + "\r\n";
}

/* ───────────────────────── upozornění a úplnost dokumentace ───────────────────────── */

/** druhy přítomné v kusovníku (oddíly se ukazují jen při dvou a více) */
export const kindsIn = (rows: readonly Pick<BomLine, "kind">[]): SupplyKind[] => SUPPLY_KINDS.filter((k) => rows.some((r) => (r.kind ?? "make") === k));

/**
 * Upozornění kusovníku (⚠, nikdy tichá prázdná buňka): vyráběné díly bez čísla výkresu a bez označení materiálu.
 * Podsestavy (`assembly`) se nehodnotí – mají své díly.
 */
export function bomNotes(rows: readonly (BomLine & { assembly?: boolean })[]): { noNumber: string[]; noMaterial: string[] } {
  const make = rows.filter((r) => !r.assembly && (r.kind ?? "make") === "make");
  return { noNumber: make.filter((r) => !r.number?.trim()).map((r) => r.name), noMaterial: make.filter((r) => r.noDesignation).map((r) => r.name) };
}

/** vyráběný díl a jeho dokumentace (výkres v dílu, číslo) */
export type MakeDoc = { name: string; number?: string; drawing: boolean; comps: number };
/** úplnost dokumentace sestavy po druzích (CLI `--formats`, kusovník, kontrola) */
export type DocSupply = { make: MakeDoc[]; standard: number; buy: number };

/**
 * Úplnost dokumentace sestavy (rekurzivně přes podsestavy, každý zdroj jednou): vyráběné díly s informací, zda mají výkres
 * a číslo; počty normálií a nakupovaných položek. Výkresy se přibalují a kontrolují jen u vyráběných dílů.
 */
export function docSupply(asm: CadDoc, key: (c: AsmComponent) => string): DocSupply {
  const make = new Map<string, MakeDoc>();
  const std = new Set<string>();
  const buy = new Set<string>();
  const walk = (comps: readonly AsmComponent[], depth: number) => {
    for (const c of comps) {
      if (c.source.kind === "asm") {
        if (depth < 16) walk(c.source.doc.components ?? [], depth + 1);
        continue;
      }
      const s = supplyOf(c);
      const k = `${key(c)}|${compNumber(c) ?? ""}`;
      if (s.kind === "standard") std.add(k);
      else if (s.kind === "buy") buy.add(k);
      else {
        const m = make.get(k);
        if (m) m.comps++;
        else make.set(k, { name: c.source.kind === "part" ? c.source.doc.name || c.name : c.name, number: compNumber(c), drawing: c.source.kind === "part" && !!c.source.doc.drawings?.length, comps: 1 });
      }
    }
  };
  walk(asm.components ?? [], 0);
  return { make: [...make.values()], standard: std.size, buy: buy.size };
}

/** jednořádkový souhrn dokumentace: „vyráběné 2 (bez výkresu 1), normálie 2, nakupované 0“ */
export function docSupplyLine(s: DocSupply): string {
  const missing = s.make.filter((m) => !m.drawing).length;
  return tr("vyráběné {0}{1}, normálie {2}, nakupované {3}", s.make.length, missing ? tr(" (bez výkresu {0})", missing) : "", s.standard, s.buy);
}
/** vyráběné díly, kterým chybí výkres nebo číslo: „Přidržovač (bez výkresu, bez čísla)“ */
export function makeIncomplete(s: DocSupply, hints?: ReadonlyMap<string, { ref: string; number?: string; drawing: boolean }>): string[] {
  return s.make
    .filter((m) => !m.drawing || !m.number)
    .map((m) => {
      // díl v záložce výkres / číslo má, jen kopie v sestavě je starší: neradit „bez výkresu“, ale obnovit (bod 22g, kolo 6)
      const h = hints?.get(m.name);
      const fromTab = [!m.drawing && h?.drawing ? tr("výkres") : "", !m.number && h?.number ? tr("číslo") : ""].filter(Boolean);
      const miss = [!m.drawing && !h?.drawing ? tr("bez výkresu") : "", !m.number && !h?.number ? tr("bez čísla") : ""].filter(Boolean);
      if (fromTab.length && h) miss.push(tr("{0} má díl v záložce, kopie v sestavě je starší: sestava obnovit {1}", fromTab.join(", "), h.ref));
      return `${m.name} (${miss.join(", ")})`;
    });
}

/** volby druhu pro GUI (hodnota "" = výchozí podle původu) */
export const supplyOptions = (): { v: SupplyKind | ""; l: string }[] => [{ v: "", l: tr("výchozí") }, ...SUPPLY_KINDS.map((k) => ({ v: k, l: supplyWord(k) }))];

/** slova údajů druhu (CS / EN / DE, bez diakritiky) – příkaz dílu `druh …` a volby `sestava komponenta … druh …` */
const FIELD_WORDS: Record<string, "catalog" | "vendor" | "size" | "grade"> = {
  katalog: "catalog", katalogove: "catalog", catalog: "catalog", catalogue: "catalog", katalognummer: "catalog", bestellnummer: "catalog",
  vyrobce: "vendor", dodavatel: "vendor", vendor: "vendor", manufacturer: "vendor", supplier: "vendor", hersteller: "vendor", lieferant: "vendor",
  rozmer: "size", size: "size", grosse: "size", groesse: "size", abmessung: "size",
  trida: "grade", class: "grade", grade: "grade", klasse: "grade", festigkeitsklasse: "grade",
};

/**
 * Řádek příkazu dílu `druh nakupovaný [katalog "SFJ8-30"] [výrobce "…"] [rozměr "…"] [třída "…"]` (tokeny bez uvozovek) →
 * druh a údaje dílu; `druh auto` = zpět na výchozí ({}). Neznámé slovo = chyba s nápovědou.
 */
export function parseSupplyTokens(tokens: readonly string[]): SupplyInfo {
  const k = supplyKindOf(tokens[0] ?? "");
  if (!k) throw new Error(tr("druh: čekám {0}, ne „{1}“", supplyWordsHelp(), tokens[0] ?? ""));
  const out: SupplyInfo = k === "auto" ? {} : { kind: k };
  for (let i = 1; i < tokens.length; i += 2) {
    const f = FIELD_WORDS[fold(tokens[i])];
    if (!f) throw new Error(tr("druh: neznámá volba „{0}“ – katalog \"…\", výrobce \"…\", rozměr \"…\", třída \"…\"", tokens[i]));
    const v = tokens[i + 1]?.trim();
    if (!v) throw new Error(tr("{0}: chybí hodnota", tokens[i]));
    out[f] = v;
  }
  return out;
}
