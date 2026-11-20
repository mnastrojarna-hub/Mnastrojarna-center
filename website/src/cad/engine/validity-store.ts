/**
 * Paměť přesné kontroly platnosti (vlna 22, bod 22a): výsledek `kontrola přesně` / automatické kontroly před exportem platí jen
 * pro geometrii, pro kterou vznikl – klíč dokumentu + otisk geometrie (`geometrySig` z result-key.ts, žádné druhé hashování).
 * Po změně modelu se zapomene (jiný otisk) a řádek Geometrie / D / JSON se vrátí k rychlé kontrole po stavbě.
 */
import { tr } from "../i18n";
import type { BuildResult, CadDoc } from "../types";
import { EXACT_AUTO_FACES, validityText, type ValidityResult } from "../validity";
import type { KernelApi } from "./kernel";
import { geometrySig } from "./result-key";
import type { Workspace } from "./workspace";

type Entry = { sig: string; v: ValidityResult };
/** výsledky visí na mezipamětech sestavy pracovního prostoru (`ws.asm` – stejný objekt i za obalem prostoru v CLI / serve) */
const stores = new WeakMap<object, Map<string, Entry>>();

/** zapamatuje výsledek přesné kontroly dokumentu `doc` pod klíčem `key` (jen proběhlá přesná kontrola) */
export function noteValidity(ws: Workspace, key: string, doc: CadDoc, v: ValidityResult): void {
  if (v.method !== "exact" || v.valid === null) return;
  let m = stores.get(ws.asm);
  if (!m) stores.set(ws.asm, (m = new Map()));
  m.set(key, { sig: geometrySig(doc), v });
}

/** přesná kontrola pro NYNĚJŠÍ geometrii dokumentu, nebo undefined (žádná / z jiné revize modelu) */
export function validityOf(ws: Workspace, key: string, doc: CadDoc): ValidityResult | undefined {
  const e = stores.get(ws.asm)?.get(key);
  return e && e.sig === geometrySig(doc) ? e.v : undefined;
}

/**
 * Výsledek stavby s platností podle přesné kontroly, když pro tuto geometrii proběhla (`metrics.valid` + `validCheck: "exact"`);
 * jinak beze změny (platnost z rychlé kontroly po stavbě).
 */
export function withValidity(ws: Workspace, key: string, doc: CadDoc, res: BuildResult | null): BuildResult | null {
  if (!res?.metrics || doc.kind === "assembly" || doc.kind === "draft") return res;
  const v = validityOf(ws, key, doc);
  if (!v || v.valid === null) return res;
  return { ...res, metrics: { ...res.metrics, valid: v.valid, validCheck: "exact" } };
}

/**
 * Přesná kontrola před exportem objemového formátu (STEP, BREP – vlna 22, bod 22a): do `EXACT_AUTO_FACES` ploch proběhne
 * sama, větší model řekne, že proběhla jen rychlá kontrola (a jak spustit přesnou). Výsledek: úroveň řádku (✓ / ⚠ / ℹ) a text.
 * Model se nemění (žádné SameParameter / opravy tolerancí – export = model; vlna 22, kritik „SameParameter před STEP“).
 */
export async function exactBeforeExport(kernel: Pick<KernelApi, "validity" | "build">, ws: Workspace | null, key: string | undefined, d: CadDoc): Promise<{ level: "ok" | "warn" | "note"; text: string; v: ValidityResult }> {
  const v = await kernel.validity(d, EXACT_AUTO_FACES);
  if (v.method === "exact") {
    if (ws && key !== undefined) noteValidity(ws, key, d, v);
    return { level: v.valid ? "ok" : "warn", text: tr("těleso: {0}", validityText(v)), v };
  }
  let fast: boolean | null = null;
  if (v.why !== "empty" && d.kind !== "assembly" && d.kind !== "draft") {
    try {
      fast = (await kernel.build(d)).metrics?.valid ?? null;
    } catch {
      fast = null;
    }
  }
  return { level: "note", text: tr("těleso: {0} – přesně: „kontrola přesně“", validityText(v, fast, EXACT_AUTO_FACES)), v };
}
