/**
 * Protokol běhu v prohlížeči stejný jako v CLI (vlna E, balík runs): `window.mncad.run(text, { protocol })` a přepínač
 * „Stručný protokol“ konzole Textové příkazy.
 *
 * * `console` (výchozí, beze změny) = dnešní text konzole: řádky ✓ / ✗ podle řádků skriptu a textový stav dokumentu;
 * * `short` = stručný protokol MNCAD/1 jako `mncad run` (≤ 2 048 B, gramatika `protocol.ts GRAMMAR`, řádky D všech dokumentů
 *   běhu, Σ) – stejný text jako CLI s `--formats none` kromě `t=`, `slow=` a `mem=` (čas a paměť); přebytek nad rozpočet
 *   označí řádek `… in protocol-full.txt` – v prohlížeči je celý protokol v `protocol: "full"` / `json` (`full`);
 * * `full` = plný protokol (`mncad run --full`);
 * * `json` = `RunReport` jako `mncad run --json` (jeden JSON objekt; v prohlížeči vždy s `full`).
 *
 * Závěr běhu je stejný jako v CLI: engine (`runInto`), pak souhrny dokumentů (`runSummaries` – hlavní dokument, dokumenty
 * běhu, řádky D) a pojistka přísného režimu po závěru (⚠/✗ v přísném úseku = STOP), bez výstupů `--formats`.
 */
import { getLang, tr } from "../i18n";
import type { EngineHost } from "./host";
import { finalizeReport, formatConsole, formatFull, ReportBuilder } from "./protocol";
import type { RunReport } from "./protocol-types";
import { runInto, type EngineRunOptions } from "./run";
import { runSummaries } from "./run-summary";
import type { Workspace } from "./workspace";

export const RUN_PROTOCOLS = ["console", "short", "full", "json"] as const;
export type RunProtocol = (typeof RUN_PROTOCOLS)[number];
/** volby `window.mncad.run(text, opts)`: druh protokolu, rozpočet stručného protokolu v bajtech, ℹ ve stručném protokolu */
export type RunApiOptions = { protocol?: RunProtocol; budget?: number; notes?: boolean };

/** počet řádků skriptu do hlavičky (`lines=`) – stejně jako CLI (`cli/watchdog.ts scriptLines`) */
export const scriptLineCount = (text: string): number => (text ? text.replace(/\r?\n$/, "").split(/\r?\n/).length : 0);

/** neznámý druh protokolu → chyba s výčtem (nikdy tiše jiný protokol) */
export function checkProtocol(p: unknown): RunProtocol {
  if (p === undefined || p === null) return "console";
  if (typeof p === "string" && (RUN_PROTOCOLS as readonly string[]).includes(p)) return p as RunProtocol;
  throw new Error(tr("run: neznámý protokol „{0}“ – console, short, full, json", String(p)));
}

/**
 * Běh skriptu se závěrem jako v CLI (souhrny dokumentů – řádky D, přísný režim po závěru). Report nese i text konzole
 * (`console`), takže tentýž běh lze vypsat kterýmkoli protokolem (`formatRun`).
 */
export async function runReport(ws: Workspace, text: string, host: EngineHost, o: EngineRunOptions = {}): Promise<RunReport> {
  const rb = new ReportBuilder({ lang: o.lang ?? getLang(), lines: scriptLineCount(text), strict: !!o.strict, ...(host.now ? { now: host.now } : {}) });
  const console = await runInto(ws, text, host, rb, o);
  let docs: RunReport["docs"] = [];
  // zrušený výpočet (tlačítko Zrušit): dokument zůstal beze změny, nic dalšího se nestaví
  if (!rb.entries.some((e) => e.code === "run.cancelled")) {
    docs = (await runSummaries(ws, host.kernel, rb)).docs;
    // pojistka přísného režimu jako CLI (`cli/job.ts strictStop`): ⚠/✗ souhrnů v přísném úseku = STOP
    const hit = rb.stopped ? undefined : rb.strictMode?.hit(rb.entries, null);
    if (hit) rb.stop(hit.line ?? null, hit.code ?? "msg.error");
  }
  return { ...rb.finish({ docs }), console };
}

/** Text protokolu běhu podle `o.protocol` (viz hlavička modulu). */
export function formatRun(r: RunReport, o: RunApiOptions = {}): string {
  const protocol = checkProtocol(o.protocol);
  if (protocol === "console") return formatConsole(r);
  const short = { ...(o.budget !== undefined ? { budget: o.budget } : {}), ...(o.notes ? { notes: true } : {}) };
  if (protocol === "json") return JSON.stringify(finalizeReport(r, { ...short, full: true }));
  const fin = finalizeReport(r, short);
  return protocol === "full" ? formatFull(fin) : fin.protocol;
}
