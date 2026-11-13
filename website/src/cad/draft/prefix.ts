/**
 * Lehký modul (bez jádra 2D výkresu) pro hlavní parser textových příkazů: pozná řádek 2D výkresu podle předpony
 * a drží odkaz na textový stav 2D dokumentu (zaregistruje ho draft/agent.ts, až se jádro načte).
 *   cs: `2d …`   en: `2d …` / `draft …`   de: `2d …` / `zeichnen …`
 * „draft“ je anglicky i úkos (3D): `draft 3 faces side` – číslo nebo slovo úkosu za ním = 3D příkaz.
 */
import type { CadDoc } from "../types";

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
/** slova 3D úkosu (agent-shapes.ts), která za „draft“ znamenají úkos, ne 2D výkres */
const DRAFT_3D = new Set(["faces", "face", "plochy", "plocha", "parting", "stepped", "plane", "direction", "dir", "offset", "name", "neutral", "pull", "tangent"]);

/** Řádek s předponou 2D výkresu → zbytek řádku; null = jiný příkaz. */
export function draftLine(line: string): string | null {
  const m = /^\s*(2d|zeichnen|draft)(?=\s|:|$)[:\s]*(.*)$/i.exec(line);
  if (!m) return null;
  const rest = m[2].trim();
  if (m[1].toLowerCase() !== "draft") return rest;
  const first = fold(rest.split(/\s+/)[0] ?? "");
  if (!first || /^[-+.\d]/.test(first) || DRAFT_3D.has(first)) return null;
  return rest;
}

const UNDO = ["zpet", "undo", "u", "ruckgangig", "rueckgaengig", "zuruck"];
const REDO = ["znovu", "redo", "wiederholen"];
/** „2d zpět 2“ → „zpět 2“ (historie dokumentu); null = jiný příkaz */
export function draftUndoLine(rest: string): string | null {
  const t = rest.trim().split(/\s+/);
  const w = fold(t[0] ?? "");
  const n = t[1] && /^\d+$/.test(t[1]) ? ` ${t[1]}` : "";
  if (t.length > 2) return null;
  if (UNDO.includes(w)) return `zpět${n}`;
  if (REDO.includes(w)) return `znovu${n}`;
  return null;
}

let statusHook: ((d: CadDoc) => string) | null = null;
/** draft/agent.ts zaregistruje úplný stav 2D výkresu */
export const setDraftStatusHook = (fn: (d: CadDoc) => string) => void (statusHook = fn);
/** textový stav 2D dokumentu (před načtením jádra jen počet entit a hladin) */
export function draftDocStatusText(d: CadDoc): string {
  if (statusHook) return statusHook(d);
  return `2D: ${d.name} · ${d.draft?.entities.length ?? 0} entities · ${d.draft?.layers.length ?? 0} layers`;
}
