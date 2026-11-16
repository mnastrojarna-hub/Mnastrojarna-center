/**
 * `otevřít "soubor"` (EN `open`, DE `öffnen`): dokument ze vstupních souborů hostitele (CLI `--files` / složka skriptu,
 * HTTP `body.files`, v prohlížeči přiložené soubory) – .mncad / .json, STEP (sestava se rozdělí přes jádro), BREP, STL,
 * DXF jako skica. Provedení: engine/ops/open.ts. Zde jen rozbor řádku (bez závislostí – načítá ho parser agent.ts).
 */
import { tr } from "./i18n";

export type OpenOp = { k: "open"; name: string; line: number };

const WORDS = new Set(["otevřít", "otevrit", "otevři", "otevri", "open", "öffnen", "oeffnen"]);

/** název souboru z řádku `otevřít "a.mncad"` / `open a.step`; null = jiný příkaz; samotné slovo bez souboru = chyba zápisu */
export function parseOpenLine(line: string): string | null {
  const m = /^(\S+)(?:\s+(.*))?$/.exec(line.trim());
  if (!m || !WORDS.has(m[1].toLowerCase())) return null;
  const rest = (m[2] ?? "").trim();
  const q = /^"([^"]*)"$|^„([^“”]*)[“”]$/.exec(rest);
  const name = (q ? (q[1] ?? q[2]) : rest).trim();
  if (!name) throw new Error(tr("otevřít: chybí název souboru – otevřít \"díl.mncad\""));
  return name;
}
