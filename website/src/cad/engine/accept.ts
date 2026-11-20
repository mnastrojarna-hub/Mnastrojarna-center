/**
 * Přijetí příkazu ≠ výsledek (vlna 22, bod 22i zprávy majitele: „přijetí příkazu musí mít jiný stav než geometrický úspěch“).
 *
 * Příkaz, který změní model nebo list výkresu, dostane při provedení jen ℹ `op.accepted` („→ … – výsledek po výpočtu níže“).
 * ✓ / ⚠ / ✗ přijde až po stavbě modelu (engine/verify.ts) nebo po vyhodnocení listu (engine/drawing-track.ts). Žádný řádek
 * tak nemůže dostat ✓ a později ✗.
 */
import { tr } from "../i18n";
import type { CadDoc } from "../types";
import type { Entry } from "./protocol-types";

/** konec řádku přijetí změny modelu / listu výkresu */
export const modelTail = (): string => tr("výsledek po výpočtu níže");
export const sheetTail = (): string => tr("výsledek po vyhodnocení listu níže");
/** starší anglické znění téhož konce (texty forem v aplikaci) */
const EXTRA_TAILS = ["result after the computation below"];

/** řádek konzole „→ … – výsledek po výpočtu níže“ = přijetí příkazu (kód `op.accepted`), ne obyčejná poznámka */
export function isAcceptance(text: string): boolean {
  const t = text.trim();
  return t.startsWith("→") && [modelTail(), sheetTail(), ...EXTRA_TAILS].some((x) => t.endsWith(x));
}

/** „✓ X“ → „→ X – výsledek po výpočtu níže“ (ostatní řádky beze změny) */
export function acceptLine(line: string, tail: string = modelTail()): string {
  const m = /^(\s*)✓\s*(.*)$/.exec(line);
  return m ? `${m[1]}→ ${m[2]} – ${tail}` : line;
}

/** „✓ X“ → „→ X“ – poznámka místo ✓ (výsledek příkazu má na témže řádku výhradu ✗ / ⚠) */
export function noteLine(line: string): string {
  const m = /^(\s*)✓\s*(.*)$/.exec(line);
  return m ? `${m[1]}→ ${m[2]}` : line;
}

/** načtený dokument s prvky dílu se teprve postaví – řádek načtení je přijetí, výsledek dá ověřovací stavba (engine/verify.ts) */
export const loadsModel = (d: CadDoc): boolean => d.kind !== "assembly" && d.kind !== "draft" && d.features.length > 0;

const sameJson = (a: unknown, b: unknown) => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** vstupy na úrovni dokumentu, které mění geometrii všech prvků */
const docInputs = (d: CadDoc) => [d.variables, d.bindings, d.configs, d.activeConfig];

/**
 * Od kterého prvku historie se dokument změnil (index v `after`): změna proměnných / konfigurací = 0, jinak první prvek,
 * který se liší (přidaný prvek na konci = jeho index); `null` = beze změny prvků. `names: false` = přejmenování prvku se
 * za změnu nepočítá (výsledek stavby změnit nemůže).
 */
export function changedFrom(before: CadDoc, after: CadDoc, o: { names?: boolean } = {}): number | null {
  if (before === after) return null;
  if (!docInputs(before).every((x, i) => sameJson(x, docInputs(after)[i]))) return 0;
  const a = before.features;
  const b = after.features;
  const strip = (f: unknown) => (o.names === false && f && typeof f === "object" ? { ...(f as object), name: "" } : f);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i] && !sameJson(strip(a[i]), strip(b[i]))) return i;
  return a.length === b.length ? null : n;
}

/**
 * Otisk všeho, co určuje geometrii dokumentu (prvky bez názvů, proměnné, vazby parametrů, konfigurace) – pozná i změnu
 * provedenou na místě (operace, které prvek do `doc.features` jen připíší), kterou `changedFrom` podle identity nevidí.
 */
export const modelSig = (d: CadDoc): string => JSON.stringify([d.features.map((f) => ({ ...f, name: "" })), ...docInputs(d).map((x) => x ?? null)]);

/**
 * Vyvolá změna dokumentu přepočet některého prvku? Ne, když se nezměnilo nic, co stavbu ovlivní (přejmenování), nebo když
 * za místem změny žádný prvek není (smazání posledního prvku, proměnná v dílu bez prvků) – takový příkaz je hotový hned (✓),
 * jinak je jen přijatý (ℹ) a výsledek přijde po stavbě.
 */
export function needsRebuild(before: CadDoc, after: CadDoc): boolean {
  const from = changedFrom(before, after, { names: false });
  return from !== null && from < after.features.length;
}

/** řádky záznamu (sloučené i jednotlivé) */
const linesOf = (e: Entry): number[] => [...new Set([...(e.lines ?? []), ...(e.line !== null ? [e.line] : [])])];

/**
 * Pravidlo vlny 22 (bod 22i): žádný řádek skriptu nesmí dostat ✓ a zároveň (dřív nebo později) ✗ – přijetí příkazu je ℹ.
 * Vrací čísla řádků, které pravidlo porušují (testy: w22/*, parita korpusu).
 */
export function greenThenRed(entries: readonly Entry[]): number[] {
  const ok = new Set(entries.filter((e) => e.level === "ok").flatMap(linesOf));
  return [...new Set(entries.filter((e) => e.level === "error").flatMap(linesOf))].filter((l) => ok.has(l)).sort((a, b) => a - b);
}
