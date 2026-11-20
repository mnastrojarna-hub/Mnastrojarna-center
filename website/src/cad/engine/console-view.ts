/**
 * Pohled konzole Textové příkazy na běhy (vlna 22, bod 15 – „konzole je příliš ukecaná a nemá vhodnou historii“).
 * Čistá logika (bez Reactu) nad `RunReport` běhu – stejná data jako `mncad run --json`:
 *
 *  * `summaryText` – výchozí stručný souhrn = stručný protokol MNCAD/1 (≤ 2 kB, jako CLI): hlavička, ✗ / ⚠, výpisy `=`,
 *    řádky D, F, O a Σ; detail (plný text konzole) jen na vyžádání;
 *  * `filterEntries` – filtr záznamů: úroveň (chyby, varování, chyby + varování, vše), dokument, text (díl, vazba, kód,
 *    id záznamu) – nad sloučenými záznamy se stabilními id (`engine/entry-ids.ts`);
 *  * `entryLine` – jeden záznam jako řádek s id (`r3:L36.motion`), rozbalitelný detail (`entryDetail`: data, detail);
 *  * `runHeadline` – řádek historie běhů: „r3 · 12:41:05 · ✓12 ⚠2 ✗1 · nový díl …“;
 *  * `reportJson` – stažitelný strukturovaný JSON (jako `--json` s plným protokolem, stabilní id záznamů a identitou běhu).
 */
import { tr } from "../i18n";
import { entryRef, withEntryIds } from "./entry-ids";
import { finalizeReport, formatFull } from "./protocol";
import type { Entry, Level, RunReport } from "./protocol-types";

export type LevelFilter = "all" | "problems" | "error" | "warn";
export type EntryFilter = { level?: LevelFilter; doc?: string; q?: string };

const SYM: Record<Level, string> = { ok: "✓", note: "ℹ", warn: "⚠", error: "✗", measure: "=" };

/** záznamy reportu sloučené a se stabilními id (report z `runReport` je už má – idempotentní) */
export const reportEntries = (r: RunReport): Entry[] => withEntryIds(finalizeReport(r).entries);

/** výchozí souhrn: stručný protokol MNCAD/1 (rozpočet 2 kB) */
export const summaryText = (r: RunReport): string => finalizeReport(r).protocol;

/** detail na vyžádání: text konzole (řádky operací, stav dokumentu), jinak plný protokol */
export const detailText = (r: RunReport): string => r.console ?? formatFull(finalizeReport(r));

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** dokumenty, ke kterým se záznamy vztahují (pro výběr filtru), v pořadí prvního výskytu */
export function reportDocs(r: RunReport): string[] {
  const out: string[] = [];
  for (const e of reportEntries(r)) if (e.doc && !out.includes(e.doc)) out.push(e.doc);
  for (const d of r.docs) if (!out.includes(d.name)) out.push(d.name);
  return out;
}

/** Záznamy po filtru (úroveň, dokument, text v textu / kódu / id / dokumentu). */
export function filterEntries(r: RunReport, f: EntryFilter = {}): Entry[] {
  const lv = f.level ?? "all";
  const q = fold((f.q ?? "").trim());
  return reportEntries(r).filter((e) => {
    if (lv === "error" && e.level !== "error") return false;
    if (lv === "warn" && e.level !== "warn") return false;
    if (lv === "problems" && e.level !== "error" && e.level !== "warn") return false;
    if (f.doc && e.doc !== f.doc) return false;
    if (q && !fold([e.text, e.code ?? "", e.id ?? "", e.doc ?? "", e.detail ?? ""].join(" ")).includes(q)) return false;
    return true;
  });
}

const locOf = (e: Entry) => {
  const ls = (e.lines?.length ? e.lines : [e.line]).filter((x): x is number => typeof x === "number");
  return ls.length ? ls.map((x) => `L${x}`).join(",") : "L-";
};

/** jeden záznam jako řádek: „✗ L5 ×2 code „Díl“: text“ (první řádek textu) */
export function entryLine(e: Entry): string {
  const first = String(e.text ?? "").split(/\r?\n/)[0];
  return [SYM[e.level], locOf(e), e.count && e.count > 1 ? `×${e.count}` : "", e.code ?? "", e.doc ? `„${e.doc}“` : "", first].filter(Boolean).join(" ");
}

/** rozbalený detail záznamu: úplná reference, celý text, detail a data (JSON, nejvýš `max` znaků) */
export function entryDetail(e: Entry, runId?: string, max = 4000): string {
  const out = [tr("id: {0}", entryRef(runId, e.id))];
  const rows = String(e.text ?? "").split(/\r?\n/);
  if (rows.length > 1) out.push(...rows.slice(1));
  if (e.detail) out.push(e.detail.length > max ? `${e.detail.slice(0, max)}… (${e.detail.length})` : e.detail);
  if (e.data !== undefined) {
    let j = "";
    try {
      j = JSON.stringify(e.data, null, 1);
    } catch {
      j = String(e.data);
    }
    out.push(j.length > max ? `${j.slice(0, max)}… (${j.length})` : j);
  }
  return out.join("\n");
}

/** počty běhu: ✓ / ⚠ / ✗ */
export const countsText = (r: Pick<RunReport, "counts">): string => `✓${r.counts.ok} ⚠${r.counts.warnings} ✗${r.counts.errors}`;

/** řádek historie: „r3 · 12:41:05 · ✓12 ⚠2 ✗1 · nový díl Příruba“ */
export function runHeadline(o: { id: string; at: number; label: string; report?: Pick<RunReport, "counts">; state?: string }): string {
  const t = new Date(o.at);
  const hh = [t.getHours(), t.getMinutes(), t.getSeconds()].map((x) => String(x).padStart(2, "0")).join(":");
  return [o.id, hh, o.report ? countsText(o.report) : (o.state ?? ""), o.label].filter(Boolean).join(" · ");
}

/** strukturovaný JSON ke stažení: jako `mncad run --json` s plným protokolem a stabilními id záznamů */
export function reportJson(r: RunReport): string {
  return JSON.stringify(finalizeReport(r, { full: true }), null, 1);
}

/** název staženého souboru: `mncad-run-r3.json` */
export const reportFileName = (runId: string | undefined, ext: "json" | "txt" = "json"): string => `mncad-run-${(runId ?? "run").replace(/[^A-Za-z0-9_-]+/g, "")}.${ext}`;
