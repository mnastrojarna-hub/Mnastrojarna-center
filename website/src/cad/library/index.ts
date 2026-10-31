/**
 * Knihovna normálií – registr rodin a textové vyhledávání („M8x30“, „IPE 200 L=1500“, „ložisko 6205 2RS“).
 *
 * TODO (navazující práce, nic z toho neblokuje použití):
 *  - šikmé ozubení (helical) – potřebuje twistExtrude v prvku extrude; kuželová a šneková kola
 *  - pružné podložky DIN 127/ISO 7092, zubové DIN 6797, pojistné matice DIN 985 (nylonová vložka), křídlové matice
 *  - skutečné UPN pásnice s úkosem 8 %, nerovnoramenné L v obou orientacích, profily HEM, IPN, T
 *  - ložiska: kuželíková 30xxx, válečková NU, axiální 51xxx, ložiskové domky UCP/UCF, pouzdra
 *  - řetězy: samotný řetěz jako sestava článků; řemenice: Poly-V, plochá; spojky, hřídelové spojky
 *  - normálie forem: vyhazovací trubky, ploché vyhazovače, šikmé čepy, tahače jader, datumovky, temperační spojky
 *  - lineární technika: kuličková pouzdra, vodicí tyče, kolejnice + vozíky (HIWIN), kuličkové šrouby
 *  - pneumatika/hydraulika: válce ISO 15552, šroubení; elektro: motory IEC (kostra B5/B14)
 *  - import vlastních tabulek (CSV/JSON) a oblíbené sestavy („šroub + podložka + matice“ jedním klikem)
 */
import type { CadDoc } from "../types";
import { BEARING_FAMILIES } from "./bearings";
import { FASTENERS } from "./fasteners";
import { GEARS } from "./gears";
import { MOLD_PARTS } from "./mold-parts";
import { norm } from "./parse-util";
import { PINS } from "./pins";
import { PROFILES } from "./profiles";
import { GROUPS, defaults, withDefaults, type Family, type Group, type SearchResult, type Values } from "./types";

export type { Family, Group, ParamSchema, SearchResult, Values } from "./types";
export { GROUPS, defaults, withDefaults } from "./types";
export { norm } from "./parse-util";

export const LIBRARY: Family[] = [...FASTENERS, ...PINS, ...BEARING_FAMILIES, ...GEARS, ...PROFILES, ...MOLD_PARTS];

export const familyById = (id: string) => LIBRARY.find((f) => f.id === id);

export const byGroup = (): { group: Group; families: Family[] }[] => GROUPS.map((group) => ({ group, families: LIBRARY.filter((f) => f.group === group) })).filter((g) => g.families.length);

/** Fuzzy skóre klíčových slov rodiny (0–0.6) – pro dotazy bez rozpoznaných parametrů. */
function keywordScore(q: string, f: Family): number {
  const hay = [f.name, ...f.standards, ...f.keywords].map((s) => norm(s));
  const words = q.split(" ").filter((w) => w.length >= 2 && !/^\d/.test(w));
  if (!words.length) return 0;
  let hits = 0;
  for (const w of words) if (hay.some((h) => h.includes(w))) hits++;
  return (0.6 * hits) / words.length;
}

/** Textové vyhledávání: vrací rodiny seřazené podle skóre s doplněnými hodnotami parametrů. */
export function search(query: string, limit = 12): SearchResult[] {
  const q = norm(query);
  if (!q) return LIBRARY.slice(0, limit).map((family) => ({ family, values: defaults(family), score: 0, designation: family.describe(defaults(family)) }));
  const out: SearchResult[] = [];
  for (const family of LIBRARY) {
    let score = 0;
    let values: Values = defaults(family);
    const hit = family.parse?.(q) ?? null;
    if (hit) {
      score = hit.score;
      values = withDefaults(family, hit.values);
    }
    const kw = keywordScore(q, family);
    score = Math.max(score, kw * 0.9);
    if (score <= 0.05) continue;
    let designation = family.describe(values);
    try {
      designation = family.describe(values);
    } catch {
      /* neúplné hodnoty */
    }
    out.push({ family, values, score, designation });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Nejlepší shoda → hotový díl (nebo null). */
export function makeFromText(query: string): { doc: CadDoc; result: SearchResult } | null {
  const r = search(query, 1)[0];
  if (!r || r.score < 0.3) return null;
  return { doc: r.family.make(r.values), result: r };
}

// ---------------- oblíbené a nedávné ----------------

export type LibRecent = { familyId: string; values: Values; designation: string; at: number };
const FAV = "mn-cad-lib-fav";
const REC = "mn-cad-lib-recent";

function read<T>(k: string, d: T): T {
  try {
    return (JSON.parse(localStorage.getItem(k) ?? "null") as T) ?? d;
  } catch {
    return d;
  }
}
export const loadFavorites = () => read<string[]>(FAV, []);
export function toggleFavorite(id: string): string[] {
  const f = loadFavorites();
  const next = f.includes(id) ? f.filter((x) => x !== id) : [...f, id];
  try {
    localStorage.setItem(FAV, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
export const loadLibRecent = () => read<LibRecent[]>(REC, []);
export function pushLibRecent(r: Omit<LibRecent, "at">) {
  const list = loadLibRecent().filter((x) => x.designation !== r.designation);
  list.unshift({ ...r, at: Date.now() });
  try {
    localStorage.setItem(REC, JSON.stringify(list.slice(0, 20)));
  } catch {
    /* ignore */
  }
}
