/**
 * Pružiny – společné typy (čisté, bez jádra a bez DOM). Popis API je v `index.ts`.
 */
import { getLang } from "../i18n";
import type { Vec3 } from "../types";

export type SpringKind = "compression" | "extension" | "torsion" | "disc";
export type SpringExt = `spring.${SpringKind}`;
export const SPRING_KINDS: SpringKind[] = ["compression", "extension", "torsion", "disc"];
export const SPRING_EXTS: SpringExt[] = SPRING_KINDS.map((k) => `spring.${k}` as SpringExt);
export type SpringData = Record<string, unknown>;
export type Lang = "cs" | "en" | "de";

/** hláška výpočtu: `key` = řádek tabulky, ke kterému patří (zobrazí se vedle něj); text česky přes tr() */
export type Issue = { level: "error" | "warn" | "info"; key?: string; text: string };

/** Řádek vstupní tabulky (= klíč v datech prvku, parametr formuláře i slovo textového příkazu). */
export type SpringRow = {
  key: string;
  /** český popisek (tr) */
  label: string;
  /** značka podle normy (d, D, L0, n…) */
  symbol?: string;
  kind: "number" | "enum" | "bool";
  unit?: string;
  /** výchozí hodnota; u čísel `undefined` = „nezadáno / dopočítat“ */
  def?: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: { v: string; l: string }[];
  /** krátká nápověda s normou */
  hint: string;
  /** povinný řádek (tučně nahoře) – ostatní mají výchozí hodnotu nebo se dopočítají */
  required?: boolean;
  group: "basic" | "ends" | "load" | "material" | "place";
  /** řádek je jedním z alternativních zadání (např. D | De | Di) – stačí vyplnit jeden z dané skupiny */
  alt?: string;
  /** zobrazit jen když… */
  when?: (d: SpringData) => boolean;
  /** slova textového příkazu (první = kanonické, používá převodník dokument → skript) */
  words: Record<Lang, string[]>;
  /** slova pro hodnoty výčtu (např. konce „broušené“ / „ground“ / „geschliffen“) */
  enumWords?: Record<string, Record<Lang, string[]>>;
};

/** Spočtený řádek tabulky (živě pod vstupy, v textu `pružina tabulka` a na výkrese). */
export type CalcRow = {
  key: string;
  label: string;
  symbol?: string;
  /** naformátovaná hodnota s jednotkou */
  text: string;
  value?: number;
  unit?: string;
  level?: "ok" | "warn" | "error";
  /** řádek patří do tabulky na výkrese (EN ISO 2162-2) */
  drawing?: boolean;
};

/**
 * Mechanický model pružiny pro sestavu a dynamiku (balík motion): délky v mm, síla v N, tuhost v N/mm
 * (u zkrutné pružiny `torsion`: úhel ve stupních, moment v N·mm, tuhost v N·mm/°).
 */
export type SpringModel = {
  kind: SpringKind;
  /** volná délka L0 (tlačná: celková, tažná: mezi vnitřními okraji oček, talířová: výška sloupce) */
  free: number;
  /** délka na doraz Ln (tlačná, talířová – plně stlačený sloupec), tažná: Lk těla bez oček */
  solid?: number;
  /** tuhost (lineární) – u talířové v bodě s = 0 */
  rate: number;
  /** předpětí F0 (tažná) [N] */
  preload?: number;
  /** hmotnost pružiny [kg] */
  massKg: number;
  /** síla v délce L (tažná: L > L0, tlačná: L < L0); talířová nelineárně */
  forceAt: (L: number) => number;
  /** zkrutná: moment v úhlu α [°] od volné polohy */
  torqueAt?: (deg: number) => number;
  /** střední průměr D a průměr drátu d (talířová: De, t) */
  D: number;
  d: number;
};

/** Výsledek výpočtu jedné pružiny. */
export type SpringCalc = {
  kind: SpringKind;
  ok: boolean;
  issues: Issue[];
  /** všechny číselné výsledky (klíč → hodnota v mm / N / N/mm / MPa / Hz / kg) */
  v: Record<string, number>;
  /** spočtené řádky tabulky */
  rows: CalcRow[];
  /** název dílu, např. „Tlačná pružina 2 × 20 × 50“ */
  title: string;
  /** jednořádkový souhrn (stav dokumentu) */
  summary: string;
  model: SpringModel | null;
};

/** Střednice drátu (osa pružiny = +Z v souřadnicích prvku, začátek v počátku). */
export type SpringPath = {
  /** body střednice */
  pts: Vec3[];
  /** jednotkové tečny v bodech */
  tangents: Vec3[];
  /** úsek dráhy, ke kterému bod patří (konec úseku = možný zlom tečny / křivosti – hranice hran v jádře) */
  seg: number[];
  /** průměr drátu */
  d: number;
  /** broušené konce: těleso se ořízne rovinami z = clip[0] a z = clip[1] */
  clip?: [number, number];
};

const DEC = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d || 0;
/** číslo pro text a tabulku (desetinná čárka v češtině a němčině) */
export function fmt(n: number | undefined, d = 2): string {
  if (n === undefined || !Number.isFinite(n)) return "–";
  const s = String(DEC(n, d));
  return getLang() === "en" ? s : s.replace(".", ",");
}
/** číslo pro data / skript (tečka, bez zbytečných nul) */
export const num6 = (n: number) => DEC(n, 6);
