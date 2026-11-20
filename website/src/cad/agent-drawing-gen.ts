/**
 * Vygenerované objekty listu textem (vlna E – dřív jen myší, cad/drawing-boxsel.ts) – čistý parser bez jádra:
 * kóty celkových rozměrů pohledů (`dim:<pohled>:t` nahoře, `dim:<pohled>:l` vlevo) a pozice sestavy (`pos:<číslo>` – balónky):
 * - `výkres vygenerované` – přehled klíčů listu a úprav,
 * - `výkres vygenerované skrýt dim:front:t pos:3` · `výkres vygenerované zobrazit pos:3`,
 * - `výkres vygenerované posun pos:3 5 -3` (mm listu, y nahoru – jako `výkres upravit … posun`; kóta jen kolmo k sobě),
 * - `výkres vygenerované obnovit [klíč…]` (bez klíče = všechny).
 * Česky, anglicky (generated, hide, show, move, restore) i německy (generiert, ausblenden, einblenden, verschieben,
 * wiederherstellen). Provedení: cad/drawing-gen-agent.ts.
 */
import type { RawTok } from "./agent-drawing";
import { tr } from "./i18n";
import type { Vec2 } from "./types";

/** `at` (zamknout): absolutní střed pozice v mm listu od levého HORNÍHO rohu (y dolů – jako uložený zámek; `… odshora`) */
export type GenCmd = { op: "gen"; act: "list" | "hide" | "show" | "move" | "restore" | "lock" | "unlock"; keys: string[]; d?: Vec2; at?: Vec2 };

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const W = (...w: string[]) => new Set(w);
export const GEN_W = W("vygenerovane", "vygenerovana", "vygenerovany", "generovane", "generated", "generiert", "generierte", "generierten");
const HIDE_W = W("skryt", "schovat", "hide", "ausblenden", "verbergen");
const SHOW_W = W("zobrazit", "ukazat", "show", "einblenden", "anzeigen");
const MOVE_W = W("posun", "posunout", "move", "shift", "verschieben", "versatz");
const RESTORE_W = W("obnovit", "vratit", "restore", "reset", "wiederherstellen", "zurucksetzen", "zuruecksetzen");
/** zamčení pozice na místě (vlna 22, bod 17): absolutní poloha přežije přepočet; jen pozice pos:<n> */
const LOCK_W = W("zamknout", "zamkni", "lock", "pin", "sperren", "fixieren");
const UNLOCK_W = W("odemknout", "odemkni", "unlock", "unpin", "entsperren");
const TOP_W = W("odshora", "from-top", "fromtop", "von-oben", "vonoben");
const isNum = (t?: RawTok) => !!t && !t.q && /^[+\-−]?(\d+([.,]\d*)?|[.,]\d+)$/.test(t.s);
const num = (s: string) => Number(s.replace("−", "-").replace(",", "."));
/** klíč vygenerovaného objektu: dim:<pohled>:t|l (kóta celkového rozměru; pohled dalšího modelu dim:m:<id>:t), pos:<číslo> (pozice / balónek) */
export const GEN_KEY = /^(dim:(?:[a-z]+|m:[a-z0-9_-]+):[tl]|pos:\d+)$/;

export const GEN_USE = () => tr("výkres vygenerované · výkres vygenerované skrýt|zobrazit <klíč…> · výkres vygenerované posun <klíč> dx dy · výkres vygenerované zamknout|odemknout pos:<číslo>… · výkres vygenerované obnovit [<klíč…>] – klíče: dim:<pohled>:t|l (kóta celkového rozměru nahoře / vlevo), pos:<číslo> (pozice)");

/** `výkres vygenerované …` (tokeny za slovem výkres) → povel; null = jiný podpříkaz */
export function parseGenText(rt: RawTok[]): GenCmd | null {
  const h = rt[0];
  if (!h || h.q || h.key || !GEN_W.has(fold(h.s))) return null;
  const a = rt[1];
  if (!a) return { op: "gen", act: "list", keys: [] };
  const w = a.q ? "" : fold(a.s);
  const act = HIDE_W.has(w) ? "hide" : SHOW_W.has(w) ? "show" : MOVE_W.has(w) ? "move" : RESTORE_W.has(w) ? "restore" : LOCK_W.has(w) ? "lock" : UNLOCK_W.has(w) ? "unlock" : null;
  if (!act) throw new Error(tr("výkres vygenerované: neznámé „{0}“ – {1}", a.s, GEN_USE()));
  const rest = rt.slice(2);
  const keys: string[] = [];
  const nums: number[] = [];
  let top = false;
  for (const t of rest) {
    if ((act === "move" || act === "lock") && isNum(t)) nums.push(num(t.s));
    else if (act === "lock" && !t.q && !t.key && TOP_W.has(fold(t.s))) top = true;
    else if (!t.key && GEN_KEY.test(t.s.trim().toLowerCase())) keys.push(t.s.trim().toLowerCase());
    else throw new Error(tr("výkres vygenerované: „{0}“ není klíč vygenerovaného objektu – {1}", t.key ? `${t.key}=${t.s}` : t.s, GEN_USE()));
  }
  if (act === "move") {
    if (keys.length !== 1 || nums.length !== 2) throw new Error(tr("výkres vygenerované posun <klíč> dx dy – jeden klíč a posun v mm listu (y nahoru), např. výkres vygenerované posun pos:3 5 -3"));
    return { op: "gen", act, keys, d: [nums[0], nums[1]] };
  }
  if ((act === "hide" || act === "show") && !keys.length) throw new Error(GEN_USE());
  if (act === "lock" || act === "unlock") {
    if (!keys.length || keys.some((k) => !k.startsWith("pos:"))) throw new Error(tr("výkres vygenerované zamknout|odemknout pos:<číslo> … – zamknout jde jen pozice (balónky)"));
    // zámek na zadaném místě: jedna pozice a střed v mm listu od levého horního rohu (`odshora`) – zápis skriptu z dokumentu
    if (act === "lock" && (nums.length || top)) {
      if (keys.length !== 1 || nums.length !== 2 || !top) throw new Error(tr("výkres vygenerované zamknout pos:<číslo> x y odshora – jedna pozice a střed v mm listu od levého horního rohu"));
      return { op: "gen", act, keys, at: [nums[0], nums[1]] };
    }
  }
  return { op: "gen", act, keys };
}
