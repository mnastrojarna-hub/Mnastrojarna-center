/**
 * Kola a ozubení – sdílené typy (vlna 19). Čistá matematika: žádné DOM, žádné jádro (replicad) – běží v Node, ve workeru i v UI.
 * Popis rozhraní je v `index.ts`.
 */
import type { Vec3 } from "../types";

export type GearKind = "spur" | "helical" | "herringbone" | "internal" | "rack" | "bevel" | "hypoid" | "worm" | "wormwheel" | "cycloid" | "cyclodisc" | "sprocket" | "pulley" | "ratchet";
/** id prvku rozšíření */
export type GearExt = `gear.${GearKind}`;
/** data prvku (plochá tabulka klíč → hodnota, JSON) */
export type GearData = Record<string, unknown>;
export type Lang = "cs" | "en" | "de";

/** jeden řádek tabulky = jeden klíč dat */
export type GearRow = {
  /** klíč v datech (ASCII) – zároveň `ExtParam.key` a klíč obecného příkazu `prvek gear.* klíč=hodnota` */
  key: string;
  label: string;
  /** značka veličiny („mₙ“, „z“, „β“) – tabulka a výkres */
  symbol?: string;
  kind: "number" | "int" | "enum" | "bool" | "text" | "vec3" | "point" | "direction" | "mode";
  unit?: "mm" | "°" | "";
  /** řádek, na který se uživatel musí podívat (nahoře, tučně); všechno ostatní má rozumnou výchozí hodnotu */
  required?: boolean;
  /** výchozí hodnota (0 = „automaticky“ / „žádné“ tam, kde to říká nápověda); řádek druhu „direction“ má objekt Direction */
  def: number | string | boolean | number[] | { kind: string; [k: string]: unknown };
  min?: number;
  max?: number;
  step?: number;
  options?: { v: string; l: string }[];
  /** doporučené hodnoty (moduly ISO 54…) – našeptávač v tabulce */
  preset?: number[];
  /** jedna věta lidsky, jmenuje normu */
  hint: string;
  group: "basic" | "teeth" | "body" | "place" | "advanced";
  /** řádek se ukáže jen když… */
  when?: (d: GearData) => boolean;
  /** klíčová slova textového zápisu, první = kanonické (dokument → skript) */
  words: Record<Lang, string[]>;
  /** slova hodnot výčtu / příznaků („pravé“, „right“, „rechts“) */
  enumWords?: Record<string, Record<Lang, string[]>>;
};
/** složené zápisy textové gramatiky: `díra 20 pero`, `náboj 40 15`, `díry 6 12 80` */
export type GearPhrase = { words: Record<Lang, string[]>; keys: string[]; flags?: { words: Record<Lang, string[]>; set: GearData }[] };

/** hláška kontroly zadání (`text` je už přeložený, lidsky) */
export type Issue = { level: "error" | "warn" | "info"; code: string; key?: string; text: string };
/** `ok` = žádná chyba (varování nevadí) */
export type Validation = { ok: boolean; issues: Issue[] };

export type Vec2 = [number, number];
export type CurveKind = "involute" | "trochoid" | "epicycloid" | "hypocycloid" | "epitrochoid-offset" | "spherical" | "spiral";
export type Seg2 =
  | { t: "line"; a: Vec2; b: Vec2 }
  /** přesný kruhový oblouk (úhly v radiánech; `ccw` = proti směru hodin od a0 do a1) */
  | { t: "arc"; c: Vec2; r: number; a0: number; a1: number; ccw: boolean }
  /**
   * přesné body křivky, jejich parametry (rostoucí) a derivace dP/dparam na koncích – jádro jimi proloží kubický B-spline
   * (chyba ≤ 4·10⁻⁵ mm u m = 10). `g` = Greenův integrál ½∮(x dy − y dx) přesné křivky (pro plochu profilu).
   */
  | { t: "curve"; kind: CurveKind; pts: Vec2[]; params: number[]; d0: Vec2; d1: Vec2; g?: number };
export type Profile2D = {
  /**
   * JEDNA rozteč, proti směru hodin, od středu patního oblouku mezery −1/0 po střed patního oblouku mezery 0/1 (zub 0 na +X).
   * Hřeben: jedna rozteč podél +X (viz `pitch`). Uzavřený obrys (rohatka, kotouč reduktoru…) má `count` opakování také.
   */
  tooth: Seg2[];
  /** z – počet opakování kolem počátku (hřeben: počet zubů) */
  count: number;
  /** hřeben: posun na jeden zub (jinak se opakuje otáčením o 2π/count) */
  pitch?: number;
  /** průměry kružnic: roztečná, hlavová, patní, základní, začátek evolventy */
  circles: { ref: number; tip: number; root: number; base?: number; form?: number };
  /** přesná plocha uzavřeného obrysu (Greenova věta přes úseky) – pro objem a hmotnost; hřeben: plocha jedné rozteče nad patní přímkou */
  area: number;
};
export type GearDataRow = { key: string; label: string; symbol?: string; value: string; unit?: string; group: "basic" | "geometry" | "check" | "pair" };

/**
 * Volby těla kola společné všem druhům (průměry v mm). `tipD`/`rootD` = hlavový / patní průměr pro meze náboje a děr;
 * `b` = šířka věnce. Nula = „žádné“.
 */
export type BodyOpts = {
  b: number;
  bore: number;
  keyway: boolean;
  hubD: number;
  hubL: number;
  hubSide: "top" | "bottom" | "both";
  setScrew: string;
  holesN: number;
  holesD: number;
  holesPcd: number;
  webT: number;
  chamfer: number;
};

/** Popis jednoho druhu kola: řádky tabulky, výchozí hodnoty, kontrola, výpočet, profil, polotovar, tabulka ozubení. */
export interface KindDef<I = unknown, C = unknown> {
  kind: GearKind;
  ext: GearExt;
  /** název druhu („Čelní kolo s přímými zuby“) */
  label: string;
  /** krátce („čelní“) – souhrn ve `stav` */
  short: string;
  /** normy uvedené v nápovědě */
  standards: string[];
  rows: GearRow[];
  phrases: GearPhrase[];
  /** slova druhu pro `kolo <druh>` */
  words: Record<Lang, string[]>;
  /** klíče, které berou volné tokeny v pořadí (řetězové kolo: ["chain"]) */
  positional?: string[];
  /** co je přesné a co přiblížené (jedna věta do nápovědy tabulky) */
  accuracy: string;
  /** výchozí data (= `ExtDef.make()`); obsahuje KAŽDÝ klíč dat */
  defaults(): GearData;
  /** tolerantní typovaný pohled na data (čísla, výčty, starší hodnoty) */
  read(data: GearData): I;
  /** hlášky ukazují na řádek přes `Issue.key` */
  validate(i: I): Validation;
  /** všechny odvozené rozměry (čísla, mm / rad) */
  compute(i: I): C;
  /** jmenovitý profil: čelní (šnek: osový, hřeben: normálný) */
  profile(i: I, c: C): Profile2D;
  /** poloviční řez soustruženého polotovaru (r, z) včetně náboje, stojiny a sražení (bez díry) */
  blank(i: I, c: C): Vec2[];
  /** tabulka ozubení (tabulka, text, výkres) */
  dataRows(i: I, c: C): GearDataRow[];
  /** jeden řádek pro `stav` */
  summary(i: I, c: C): string;
  /** název prvku („Ozubené kolo m2 z24“) */
  name(i: I): string;
}

/** mřížka bodů jedné záplaty boku (řady = řezy): `rows[iv][iu]`, parametry v u, derivace podle u na koncích každé řady */
export type PatchGridData = { rows: Vec3[][]; tu: number[]; d0?: Vec3[]; d1?: Vec3[] };
/** pás záplat jednoho zubu mezi řezy (parametry řezů `tv`); pásy na sebe navazují společnou řadou */
export type PatchGroup = { grids: PatchGridData[]; tv: number[] };

// ---------------- soukolí ----------------

export type PairKind = "spur" | "helical" | "herringbone" | "internal" | "rack" | "bevel" | "hypoid" | "worm" | "cycloid" | "cyclodisc" | "sprocket" | "pulley";
/** hodnoty řádků `PAIR_ROWS[kind]` (z1, z2 | i, m, a, x1, x2, jn, b…) */
export type PairInput = { kind: PairKind; values: GearData };
export type PairWheel = { ext: GearExt; name: string; data: GearData };
export type PairResult = {
  ok: boolean;
  issues: Issue[];
  /** převod, a, a_w, α_w, Σx, x1, x2, k, ε_α, ε_β, vůle… */
  rows: GearDataRow[];
  wheels: [PairWheel, PairWheel];
  /** poloha komponent v sestavě; `rot` = Eulerovy úhly jako assembly.ts (R = Rx·Ry·Rz), ° */
  placement: [{ at: Vec3; rot: Vec3 }, { at: Vec3; rot: Vec3 }];
  /** vazba sestavy; `faceA`/`faceB` = pravidla ploch pro `sestava vazba` („Ø20“, „spodní“) */
  mate: { kind: "gear" | "rack"; teeth?: [number, number]; ratio?: number; module?: number; flip: boolean; faceA: string; faceB: string };
  asmName: string;
};
