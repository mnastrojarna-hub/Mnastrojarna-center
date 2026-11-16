/**
 * Rozbor pro balík B4 (strict-silent, CAD-HEADLESS-NAVRH.md kap. 5): řádek `přísně`, kódované chyby rozboru, třída
 * materiálu z označení a sledování nevyužitých slov voleb (`parse.unused`).
 *
 * Modul nezávisí na agent.ts (ten ho importuje); kódy jsou řetězce z registru `engine/codes.ts`.
 */
import { tr } from "./i18n";

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** chyba rozboru s kódem protokolu (např. `parse.axis`) – parseAgentText ji zapíše jako ✗ s tímto kódem */
export class CodedParseError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/* ───────────────────────── přísně [vyp] [kromě kód,…] ───────────────────────── */

const STRICT_WORDS = new Set(["prisne", "prisny", "strict", "streng"]);
const OFF_WORDS = new Set(["vyp", "vypnout", "ne", "off", "no", "aus", "nein"]);
const ON_WORDS = new Set(["zap", "zapnout", "ano", "on", "yes", "ein", "an", "ja"]);
const EXCEPT_WORDS = new Set(["krome", "except", "ausser", "außer"]);

/**
 * `přísně` / `přísně vyp` / `přísně kromě hole.depth-default,select.ambiguous` (EN `strict [off] [except …]`, DE
 * `streng [aus] [außer …]`). null = jiný příkaz. Kód výjimky smí být předpona (`hole.` = všechny `hole.*`).
 */
export function parseStrictLine(line: string): { on: boolean; except?: string[] } | null {
  const t = line.trim().split(/\s+/);
  if (!t.length || !STRICT_WORDS.has(fold(t[0]))) return null;
  let on = true;
  const except: string[] = [];
  for (let i = 1; i < t.length; i++) {
    const w = fold(t[i]);
    if (OFF_WORDS.has(w)) on = false;
    else if (ON_WORDS.has(w)) on = true;
    else if (EXCEPT_WORDS.has(w)) {
      for (const c of t.slice(i + 1).join(",").split(/[,;\s]+/)) {
        const code = c.trim().toLowerCase();
        if (!code) continue;
        if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.?$/.test(code)) throw new CodedParseError("parse.error", tr("přísně kromě: „{0}“ není kód protokolu (např. hole.depth-default, select.ambiguous, hole.)", c));
        except.push(code);
      }
      break;
    } else throw new CodedParseError("parse.error", tr("přísně: neznámé slovo „{0}“ – přísně [vyp] [kromě kód,kód]", t[i]));
  }
  if (!on && except.length) throw new CodedParseError("parse.error", tr("přísně vyp nemá výjimky – přísně kromě kód,kód zapne přísný režim s výjimkami"));
  return except.length ? { on, except } : { on };
}

/* ───────────────────────── třída materiálu z označení (5.2 č. 37) ───────────────────────── */

/**
 * Třída materiálu (id z `MATERIALS` – hustota) podle normalizovaného označení; null = neznámé (hustota zůstane, ⚠
 * `material.density-assumed`). EN AW-* / Al… → hliník; 1.4xxx, X…CrNi… → nerez; 1.0xxx–1.3xxx, 1.5xxx–1.8xxx, ČSN 1x xxx,
 * S235…, C45…, 42CrMo4… → ocel; CuZn…, 2.0[2-5]xx → mosaz; Cu-ETP, 2.00xx → měď; 3.7xxx, Ti… → titan.
 */
export function materialClass(designation: string): "ocel" | "nerez" | "hlinik" | "mosaz" | "med" | "titan" | null {
  const raw = designation.trim();
  const s = fold(raw).replace(/^(csn|čsn|din|en|iso)\s+(?=\d)/, "").replace(/\s+/g, " ");
  const c = s.replace(/[\s-]/g, "");
  if (/^(enaw|aw)\d{4}/.test(c) || /^enac\d/.test(c) || /^al(mg|si|cu|zn|mn)/.test(c) || /^3\.[0-4]\d{3}$/.test(c)) return "hlinik";
  if (/^1\.4\d{3}$/.test(c) || /^x\d+cr(ni|mo)?\w*ni/.test(c) || /^x\d+crni/.test(c)) return "nerez";
  if (/^cuzn/.test(c) || /^2\.0[2-5]\d{2}$/.test(c) || /^ms\d{2}$/.test(c)) return "mosaz";
  if (/^(cuetp|cuofe?|cuphc|secu|ecu)/.test(c) || /^2\.00\d{2}$/.test(c)) return "med";
  if (/^3\.7\d{3}$/.test(c) || /^ti(al|6al|gr|\d|$)/.test(c)) return "titan";
  if (/^1\.[0-35-8]\d{3}$/.test(c)) return "ocel";
  // ČSN 41 xxxx / 1x xxx (11 523, 12 050, 19 312, 14 220.3) – oceli třídy 10–19
  if (/^(41)?1\d \d{3}(\.\d+)?$/.test(s) || /^(41)?1\d{4}(\.\d+)?$/.test(c)) return "ocel";
  if (/^(s|e|p)\d{3}[a-z0-9+]*$/.test(c) || /^c\d{2}[a-z]?\w*$/.test(c) || /^\d{2}(cr|mn|ni|mo|si|v|crmo|nicr|mncr)\w*$/.test(c) || /^x\d+cr\w*$/.test(c) || /^(hs|hss)\d/.test(c) || /^(11ssmn|9smn)/.test(c)) return "ocel";
  return null;
}

/* ───────────────────────── nevyužitá slova voleb (5.2 č. 1) ───────────────────────── */

type OptsShape = { flags: Set<string>; nums: Record<string, number[]>; words: Record<string, string[]>; free: number[]; strings: string[]; groups?: Record<string, number[][]> };

/**
 * Sledované volby příkazu: obsluha čte volby jako dřív, každé čtení hodnoty se zaznamená. `unused()` vrátí, co obsluha
 * nepřečetla: volná čísla a slova, příznaky, na které se nikdy nezeptala, a volby (klíč + hodnoty), které nečetla.
 * Čtení celého pole (find, map, join, spread) označí všechny jeho hodnoty – výsledkem jsou jen jistá nevyužitá slova.
 */
export function trackOpts<T extends OptsShape>(o: T, said: (canonical: string) => string): { opts: T; unused: () => string[] } {
  const freeSeen = new Set<number>();
  const strSeen = new Set<number>();
  const flagSeen = new Set<string>();
  const keySeen = new Set<string>();
  const valSeen = new Map<string, Set<number>>();
  const arr = <V>(a: V[], seen: Set<number>): V[] =>
    new Proxy(a, {
      get(t, p, r) {
        if (typeof p === "string" && /^\d+$/.test(p)) seen.add(Number(p));
        return Reflect.get(t, p, r);
      },
    });
  const rec = <V>(m: Record<string, V[]>): Record<string, V[]> =>
    new Proxy(m, {
      get(t, p, r) {
        if (typeof p !== "string") return Reflect.get(t, p, r);
        keySeen.add(p);
        const v = Reflect.get(t, p, r) as V[] | undefined;
        if (!Array.isArray(v)) return v;
        let s = valSeen.get(p);
        if (!s) valSeen.set(p, (s = new Set()));
        return arr(v, s);
      },
      has(t, p) {
        if (typeof p === "string") keySeen.add(p);
        return Reflect.has(t, p);
      },
      ownKeys(t) {
        for (const k of Object.keys(t)) keySeen.add(k);
        return Reflect.ownKeys(t);
      },
    });
  const flags = new Proxy(o.flags, {
    get(t, p) {
      if (p === "has") return (k: string) => (flagSeen.add(k), t.has(k));
      if (p === Symbol.iterator || p === "forEach" || p === "values" || p === "keys" || p === "entries") for (const k of t) flagSeen.add(k);
      const v = Reflect.get(t, p, t) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
  // čísla číselné volby po výskytech (`v 1 2 v 3 4 5` → groups.at, díra s více polohami – vlna 15): přečtení skupin = přečtená
  // všechna čísla volby (kontrolu počtu čísel ve skupině dělá obsluha – holePositions)
  const groups = o.groups
    ? new Proxy(o.groups, {
        get(t, p, r) {
          if (typeof p === "string") {
            keySeen.add(p);
            const v = o.nums[p];
            if (Array.isArray(v)) {
              let s = valSeen.get(p);
              if (!s) valSeen.set(p, (s = new Set()));
              for (let i = 0; i < v.length; i++) s.add(i);
            }
          }
          return Reflect.get(t, p, r);
        },
      })
    : undefined;
  const opts = { ...o, flags, nums: rec(o.nums), words: rec(o.words), free: arr(o.free, freeSeen), strings: arr(o.strings, strSeen), ...(groups ? { groups } : {}) } as T;
  const unused = (): string[] => {
    const out: string[] = [];
    o.free.forEach((n, i) => !freeSeen.has(i) && out.push(String(n)));
    o.strings.forEach((s, i) => !strSeen.has(i) && out.push(s));
    for (const f of o.flags) if (!flagSeen.has(f)) out.push(said(f));
    for (const [k, v] of Object.entries(o.nums)) {
      if (!keySeen.has(k)) out.push([said(k), ...v.map(String)].join(" "));
      else {
        const seen = valSeen.get(k);
        // čtení `length` a pak indexů: hodnoty za posledním přečteným indexem jsou čísla navíc
        if (seen && seen.size && v.length > Math.max(...seen) + 1) out.push(...v.slice(Math.max(...seen) + 1).map(String));
      }
    }
    for (const [k, v] of Object.entries(o.words)) if (!keySeen.has(k)) out.push([said(k), ...v].join(" "));
    return out;
  };
  return { opts, unused };
}
