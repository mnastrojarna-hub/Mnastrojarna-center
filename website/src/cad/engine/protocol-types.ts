/**
 * Datové typy protokolu běhu textového skriptu (CAD-HEADLESS-NAVRH.md kap. 4.3) – stejné pro CLI (`mncad run --json`),
 * místní HTTP API (`mncad serve`) i konzoli prohlížeče. Formátování stručného a plného protokolu je v `protocol.ts`,
 * registr kódů hlášek v `codes.ts`.
 *
 * Modul je čistě typový (žádný kód za běhu) – smí ho importovat engine, CLI i aplikace.
 */
import type { CadLang } from "../i18n";
import type { Vec3 } from "../types";

/** úroveň záznamu: ✓ ok, ℹ note, ⚠ warn, ✗ error, `=` measure (vyžádaná hodnota / výpis) */
export type Level = "ok" | "note" | "warn" | "error" | "measure";

/**
 * Jeden záznam protokolu.
 * * `line` – řádek skriptu (1…), `null` = bez řádku (`L-`: hostitel, časový limit, dokument z `--open`).
 * * `lines` – všechny řádky sloučených záznamů (`mergeEntries`: stejná úroveň, kód, dokument, text i data; `L-` zvlášť);
 *   `line` = první z nich, `count` = počet výskytů. Hlášky s jiným textem nebo daty se nikdy neslučují.
 * * `code` – stabilní kód z `codes.ts` (ASCII, stejný ve všech jazycích). U `=` je to druh výpisu (`measure`, `clash`, …).
 * * `text` – u ✓/ℹ/⚠/✗ lokalizovaný volný text; u `=` strojová část `klíč=hodnota …` (víc řádků = víceřádkový výpis).
 * * `doc` – název dokumentu, ke kterému se záznam vztahuje.
 */
export type Entry = { line: number | null; lines?: number[]; level: Level; code?: string; text: string; doc?: string; data?: unknown; count?: number };

/** souhrn jednoho dokumentu běhu (řádek `D`, JSON `docs[]`) */
export type DocSummary = {
  ref: string;
  name: string;
  kind: "part" | "assembly" | "draft";
  /** hlavní dokument běhu (`--doc`, jinak poslední sestava, jinak aktivní) – jeho řádek D je ve stručném protokolu vždy */
  main?: boolean;
  features?: { ok: number; warn: number; error: number };
  /** objem dílu; u sestavy součet objemů komponent (V.sum, rozhodnutí 15.1) */
  volume_mm3?: number;
  /** u sestavy objem sjednocení komponent bez překryvů (V.union, rozhodnutí 15.1) – když se počítal */
  volume_union_mm3?: number;
  /** objem přesně z B-rep (false = ze sítě, ℹ geom.approx) */
  exact?: boolean;
  mass_kg?: number;
  density?: number;
  densityAssumed?: boolean;
  bbox?: [Vec3, Vec3];
  components?: number;
  parts?: number;
  mates?: { total: number; ok: number; conflict: number; missing: number; suppressed: number };
  clashes?: { total: number; thread: number; real: number; undetermined: number };
  sheets?: number;
};

/** zapsaný soubor (řádek `F`, JSON `files[]`) */
export type OutFile = {
  name: string;
  format: string;
  bytes: number;
  sha256: string;
  doc: string;
  path?: string;
  base64?: string;
  url?: string;
  sheets?: number;
  check?: { ok: boolean; text: string };
  run?: "fail";
};

export type ShareMode = "self" | "store" | "link";
/** sdílený odkaz (řádek `O`); `exp` = ISO datum `YYYY-MM-DD` nebo `null` (bez platnosti) */
export type ShareInfo = { url: string; mode: ShareMode; bytes: number; exp: string | null; note?: string };

/** přebytek stručného protokolu – celý protokol je v souboru `file` (`protocol-full.txt`) */
export type Overflow = { entries: number; bytes: number; file: string };

export type RunCounts = { lines: number; ops: number; ok: number; notes: number; warnings: number; errors: number };
export type OpTiming = { line: number; op: string; ms: number };

export type RunReport = {
  v: 1;
  ok: boolean;
  strict: boolean;
  /** přísný režim zastavil běh na tomto řádku a kódu (hlavička `STOP`) */
  stopped?: { line: number | null; code: string };
  ms: number;
  lang: CadLang;
  counts: RunCounts;
  entries: Entry[];
  docs: DocSummary[];
  files: OutFile[];
  share?: ShareInfo;
  /** 5 nejpomalejších operací */
  timing: OpTiming[];
  /** nejvyšší hlášená paměť běhu (WASM halda + RSS), MB */
  peakMB: number;
  /** stručný protokol (vyplní `finalizeReport` / `toJson`) */
  protocol: string;
  overflow?: Overflow;
  /** plný protokol (jen na vyžádání: `--full`, HTTP `full: true`) */
  full?: string;
};

/** volby běhu skriptu (`runScript`, balík B2; CLI a HTTP je předávají beze změny) */
export type RunOptions = {
  /** `setDocument(json, { inPlace: true })` – nahradit dokument aktivní záložky jedním krokem historie */
  inPlace?: boolean;
  strict?: boolean | { except: string[] };
  mode?: "full" | "short";
  /** tvrdý rozpočet stručného protokolu v bajtech UTF-8 (výchozí 2048) */
  budget?: number;
  lang?: CadLang;
  /** dokumenty k otevření před během (`--open`, HTTP `open`) */
  open?: string[];
  /** vypsat i ℹ (s nejnižší prioritou) */
  notes?: boolean;
};
