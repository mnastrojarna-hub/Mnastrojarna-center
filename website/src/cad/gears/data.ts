/** Tabulka ozubení (data pro tabulku, text a výkres), souhrn pro `stav` a seznam kol dílu. Čistá matematika – bez jádra. */
import { tr } from "../i18n";
import type { CadDoc, Feature } from "../types";
import { kindOfExt, withDefaults } from "./registry";
import type { GearData, GearDataRow, GearExt, Profile2D, Validation } from "./types";

const need = (ext: string) => {
  const def = kindOfExt(ext);
  if (!def) throw new Error(tr("„{0}“ není prvek ozubení.", ext));
  return def;
};

/** kontrola zadání (hlášky u řádků) */
export function gearValidate(ext: string, data: GearData): Validation {
  const def = need(ext);
  return def.validate(def.read(withDefaults(def, data)));
}
/** všechny odvozené rozměry jako čísla (mm, rad) */
export function gearCompute(ext: string, data: GearData): Record<string, number> {
  const def = need(ext);
  const c = def.compute(def.read(withDefaults(def, data))) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(c)) if (typeof v === "number") out[k] = v;
  return out;
}
/** jmenovitý profil (čelní řez; šnek osový, hřeben normálný) */
export function gearProfile(ext: string, data: GearData): Profile2D {
  const def = need(ext);
  const i = def.read(withDefaults(def, data));
  return def.profile(i, def.compute(i));
}
/** řádky tabulky ozubení */
export function gearDataRows(ext: string, data: GearData): GearDataRow[] {
  const def = need(ext);
  const i = def.read(withDefaults(def, data));
  return def.dataRows(i, def.compute(i));
}
/** tabulka ozubení jako řádky textu (protokol příkazu `kolo tabulka`) */
export function gearTableText(name: string, ext: string, data: GearData): string[] {
  const def = need(ext);
  const rows = gearDataRows(ext, data);
  const w = Math.max(...rows.map((r) => r.label.length + (r.symbol ? r.symbol.length + 1 : 0)));
  return [tr("Tabulka ozubení – {0} ({1})", name, def.label), ...rows.map((r) => `  ${(r.label + (r.symbol ? ` ${r.symbol}` : "")).padEnd(w)} = ${r.value}${r.unit ? ` ${r.unit}` : ""}`)];
}
/** jeden řádek pro `stav` („čelní m2 z24 x0 b20 · d 48 · dₐ 52 · W₃ 15,433 · díra 20 pero · kolo“); "" = prvek není kolo */
export function gearSummary(f: Feature): string {
  if (f.type !== "ext") return "";
  const def = kindOfExt(f.ext);
  if (!def) return "";
  try {
    const i = def.read(withDefaults(def, f.data ?? {}));
    return def.summary(i, def.compute(i));
  } catch {
    return def.short;
  }
}

export type GearTable = { featureId: string; name: string; ext: GearExt; title: string; rows: GearDataRow[] };
/** tabulky ozubení všech nepotlačených kol dílu, v pořadí historie */
export function gearTablesOf(doc: Pick<CadDoc, "features">): GearTable[] {
  const out: GearTable[] = [];
  for (const f of doc.features) {
    if (f.type !== "ext" || f.suppressed) continue;
    const def = kindOfExt(f.ext);
    if (!def) continue;
    try {
      out.push({ featureId: f.id, name: f.name, ext: def.ext, title: def.label, rows: gearDataRows(f.ext, f.data ?? {}) });
    } catch {
      /* neplatné zadání – kolo se nepostavilo, tabulka by byla nesmyslná */
    }
  }
  return out;
}
