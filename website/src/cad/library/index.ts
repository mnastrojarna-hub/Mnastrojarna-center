/**
 * Knihovna normálií – registr rodin a textové vyhledávání („M8x30“, „IPE 200 L=1500“, „ložisko 6205 2RS“,
 * „šikmé kolo m2 z30 β15“, „kuželíkové ložisko 30206“, „HGR20 L500“, „příruba PN16 DN80“, „vodicí sloupek Z00 24x150“).
 *
 * Rodiny jsou rozděleny do souborů podle oblasti; každá má tabulku rozměrů, citované normy a parser (česky i anglicky,
 * bez diakritiky). Nové rodiny stačí přidat do pole LIBRARY – dialog si skupiny i tabulky sestaví sám.
 *
 * Známá zjednodušení geometrie (všechny díly se staví < ~2 s):
 *  - šikmé / šneková kola: loft natočených evolventních profilů (bez twistExtrude), šnekové kolo bez globoidního hrdla
 *  - šnek: závit jako kruhový profil (prvek spring), ne lichoběžník ZA/ZN; kuželové kolo: přímé zuby, loft hlava→pata
 *  - kuželíková a axiální ložiska: skutečné rozměry d/D/T, valivá tělesa zjednodušená; UPN bez úkosu pásnic
 *  - hliníkové profily: T-drážky jako lomená čára (bez zaoblení a vnitřních žeber), středová díra pro závit čela
 *  - pneumatické válce: profil těla jako válec + čtvercová víka s táhly; příruby bez těsnicí lišty typu C
 *
 * TODO (navazující práce, nic z toho neblokuje použití):
 *  - válečková ložiska NU/N, dvouřadá naklápěcí 22xx, ložiskové domky UCF/UCFL, samomazná pouzdra s límcem
 *  - řetěz jako sestava článků; řemenice Poly-V a plochá; hřídelové spojky (pružné, vlnovcové), svěrné pouzdra
 *  - normálie forem: tahače jader, zámky desek, horké trysky; Meusburger E 1300 šikmé vedení
 *  - lineární technika: vozíky MGN (miniaturní), lineární moduly, podpěrné lišty SK/SBR
 *  - pneumatika/hydraulika: kompaktní válce ISO 21287, ventily, hydraulické válce ISO 6020; elektro: motory IEC (B5/B14)
 *  - profily HEM, IPN, T; nerovnoramenné L v obou orientacích
 *  - import vlastních tabulek (CSV/JSON) a oblíbené sestavy („šroub + podložka + matice“ jedním klikem)
 */
import type { CadDoc } from "../types";
import { ALU_PROFILES } from "./alu-profiles";
import { BEARING_FAMILIES } from "./bearings";
import { BEARINGS2 } from "./bearings2";
import { FASTENERS } from "./fasteners";
import { FASTENERS2 } from "./fasteners2";
import { GEARS } from "./gears";
import { GEARS2 } from "./gears2";
import { LINEAR } from "./linear";
import { MOLD_PARTS } from "./mold-parts";
import { MOLD2 } from "./mold2";
import { norm } from "./parse-util";
import { PINS } from "./pins";
import { PINS2 } from "./pins2";
import { PIPING } from "./piping";
import { PNEUMATICS } from "./pneumatics";
import { PROFILES } from "./profiles";
import { SPRINGS2 } from "./springs2";
import { GROUPS, defaults, withDefaults, type Family, type Group, type SearchResult, type Values } from "./types";

export type { Family, Group, ParamSchema, SearchResult, Values } from "./types";
export { GROUPS, defaults, withDefaults } from "./types";
export { norm } from "./parse-util";

export const LIBRARY: Family[] = [...FASTENERS, ...FASTENERS2, ...PINS, ...PINS2, ...SPRINGS2, ...BEARING_FAMILIES, ...BEARINGS2, ...GEARS, ...GEARS2, ...PROFILES, ...ALU_PROFILES, ...LINEAR, ...PNEUMATICS, ...PIPING, ...MOLD_PARTS, ...MOLD2];

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
