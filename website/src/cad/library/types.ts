/** Typy knihovny normálií. */
import type { CadDoc } from "../types";

export type ParamSchema =
  | { key: string; label: string; kind: "enum"; options: { v: string; l: string }[]; default: string; hint?: string }
  | { key: string; label: string; kind: "number"; min?: number; max?: number; step?: number; unit?: string; default: number; hint?: string }
  | { key: string; label: string; kind: "bool"; default: boolean; hint?: string };

export type Values = Record<string, string | number | boolean>;

export type Group =
  | "Spojovací materiál"
  | "Kolíky a pera"
  | "Pojistné kroužky"
  | "Ložiska"
  | "Ozubení a řetězy"
  | "Řemenice"
  | "Ocelové profily a trubky"
  | "Pružiny a těsnění"
  | "Normálie forem";

export const GROUPS: Group[] = ["Spojovací materiál", "Kolíky a pera", "Pojistné kroužky", "Ložiska", "Ozubení a řetězy", "Řemenice", "Ocelové profily a trubky", "Pružiny a těsnění", "Normálie forem"];

/** Výsledek rozpoznání textového dotazu rodinou: hodnoty parametrů + skóre (0–1). */
export type ParseHit = { values: Partial<Values>; score: number };

export type Family = {
  id: string;
  name: string;
  group: Group;
  /** název ikony z cad-icons */
  icon: string;
  standards: string[];
  /** klíčová slova (bez diakritiky, malá písmena) – česky i anglicky */
  keywords: string[];
  params: ParamSchema[];
  /** tabulka rozměrů podle hlavního parametru (pro zobrazení v dialogu) */
  sizes?: { key: string; columns: { key: string; label: string }[]; rows: Record<string, string | number>[] };
  /** rozpozná rodinu v normalizovaném textu („m8x30“, „ipe 200 1500“) */
  parse?: (q: string) => ParseHit | null;
  describe: (v: Values) => string;
  make: (v: Values) => CadDoc;
};

export type SearchResult = { family: Family; values: Values; score: number; designation: string };

export function defaults(f: Family): Values {
  const v: Values = {};
  for (const p of f.params) v[p.key] = p.default;
  return v;
}

export function withDefaults(f: Family, partial: Partial<Values>): Values {
  const v = defaults(f);
  for (const [k, val] of Object.entries(partial)) if (val != null) v[k] = val;
  return v;
}
