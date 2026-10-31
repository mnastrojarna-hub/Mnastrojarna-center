import type { Locale } from "@/i18n/config";
import { cs, type Dict } from "./cs";
import { de } from "./de";
import { en } from "./en";

const DICTS: Record<Locale, Dict> = { cs, en, de };

export function getDict(locale: Locale): Dict {
  return DICTS[locale];
}

export type { Dict };

/** Jednoduché dosazení {klíč} do šablony. */
export function fill(s: string, vars: Record<string, string>) {
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}
