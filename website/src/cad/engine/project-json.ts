/**
 * Projekt `.mncad` s revizí modelu (vlna 22, bod 12 – „uložení pracuje s jasně určeným dokončeným stavem“): soubor nese
 * `modelRev` = krátkou revizi modelu (`r·a1b2c3`, engine/result-key.ts), ze které vznikl – stejnou hodnotu ukazuje záznam
 * exportu, řádek F (`rev=`) a stav běhu (`inputRev`). Revize se počítá z dokumentu s vloženými daty importů (tak, jak se
 * zapíše), takže prohlížeč i CLI dají pro tentýž model totéž.
 *
 * Jediné místo, kde vzniká text projektu: příkaz `uložit` / `export mncad` (engine/files.ts `projectFile`), Soubor › Uložit
 * a `window.mncad.exportFile("mncad")` v aplikaci. Při otevření se `modelRev` z dokumentu odebere (`stripModelRev`) – revize
 * se při dalším uložení spočítá znovu; nesouhlas uložené a spočítané revize (`savedRevMismatch`) prozradí ručně upravený soubor.
 */
import { embedBlobs } from "../blobs";
import type { CadDoc } from "../types";
import { modelRev } from "./result-key";

/** text projektu `.mncad` (formát jako dřív – odsazení 1 – a navíc `modelRev` na konci objektu) */
export function projectJson(doc: CadDoc, space: number | undefined = 1): { json: string; modelRev: string } {
  const saved = embedBlobs(doc) as unknown as CadDoc & { modelRev?: string };
  const { modelRev: _old, ...rest } = saved;
  void _old;
  const rev = modelRev(rest as CadDoc);
  return { json: JSON.stringify({ ...rest, modelRev: rev }, null, space), modelRev: rev };
}

/** revize uložená v souboru projektu (null = soubor bez revize, starší verze) */
export function savedModelRev(raw: unknown): string | null {
  const v = raw && typeof raw === "object" ? (raw as { modelRev?: unknown }).modelRev : undefined;
  return typeof v === "string" && /^r·[0-9a-f]{6}$/.test(v) ? v : null;
}

/** dokument ze souboru bez údaje revize (patří souboru, ne dokumentu – po změně by lhal) */
export function stripModelRev<T extends object>(d: T): T {
  if (!d || typeof d !== "object" || !("modelRev" in d)) return d;
  const { modelRev: _r, ...rest } = d as T & { modelRev?: unknown };
  void _r;
  return rest as T;
}

/** uložená revize nesouhlasí s obsahem (soubor upravený mimo CAD) – null = souhlasí nebo revize chybí */
export function savedRevMismatch(raw: unknown): { saved: string; actual: string } | null {
  const saved = savedModelRev(raw);
  if (!saved) return null;
  const actual = modelRev(stripModelRev(raw as CadDoc));
  return actual === saved ? null : { saved, actual };
}
