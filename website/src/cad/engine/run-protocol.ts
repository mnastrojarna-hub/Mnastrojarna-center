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
 * běhu, řádky D) a pojistka přísného režimu po závěru (⚠/✗ v přísném úseku = STOP), bez výstupů `--formats`. Soubory, které
 * skript zapsal (`export step`, `výkres export pdf`, `uložit` – v prohlížeči stažení), jsou řádky F a Σ `files=` jako v CLI
 * (i s `check=ok|fail` kontroly STEP; při ✗ v běhu `run=fail`).
 *
 * Volby (`checkRunOptions`) se kontrolují, nikdy tiše: neznámý klíč, protokol, `budget` mimo 1…1 048 576 (jako CLI
 * `--budget`) nebo `budget` / `notes` u protokolu, který je nepoužije → chyba s výčtem. Druhý argument smí být i jen název
 * protokolu (`run(text, "short")`).
 */
import { getLang, tr } from "../i18n";
import type { EngineHost, FileSink } from "./host";
import { finalizeReport, formatConsole, formatFull, ReportBuilder } from "./protocol";
import type { OutFile, RunReport } from "./protocol-types";
import { runInto, type EngineRunOptions } from "./run";
import { runSummaries } from "./run-summary";
import type { Workspace } from "./workspace";

export const RUN_PROTOCOLS = ["console", "short", "full", "json"] as const;
export type RunProtocol = (typeof RUN_PROTOCOLS)[number];
/** volby `window.mncad.run(text, opts)`: druh protokolu, rozpočet stručného protokolu v bajtech, ℹ ve stručném protokolu */
export type RunApiOptions = {
  protocol?: RunProtocol;
  budget?: number;
  notes?: boolean;
  /** zrušení běhu (vlna 22, bod 12): `AbortController().signal` – čekající běh se vyřadí, běžící skončí ✗ run.cancelled */
  signal?: AbortSignal;
};

/** počet řádků skriptu do hlavičky (`lines=`) – stejně jako CLI (`cli/watchdog.ts scriptLines`) */
export const scriptLineCount = (text: string): number => (text ? text.replace(/\r?\n$/, "").split(/\r?\n/).length : 0);

/** neznámý druh protokolu → chyba s výčtem (nikdy tiše jiný protokol) */
export function checkProtocol(p: unknown): RunProtocol {
  if (p === undefined || p === null) return "console";
  if (typeof p === "string" && (RUN_PROTOCOLS as readonly string[]).includes(p)) return p as RunProtocol;
  throw new Error(tr("run: neznámý protokol „{0}“ – console, short, full, json", String(p)));
}

/** rozpočet stručného protokolu – stejný rozsah jako CLI `--budget` (cli/args.ts) */
export const BUDGET_MIN = 1;
export const BUDGET_MAX = 1_048_576;
const OPTION_KEYS = ["protocol", "budget", "notes", "signal"] as const;

/**
 * Volby `window.mncad.run(text, opts)` (a konzole) → `RunApiOptions`, nebo chyba s výčtem – žádná volba se tiše
 * nezahodí: `opts` = objekt `{ protocol, budget, notes }` nebo jen název protokolu; neznámý klíč (překlep `protocoll`),
 * `budget` mimo celé číslo 1…1 048 576, `notes` jiné než true / false, `budget` mimo `short` a `notes` u `console`.
 */
export function checkRunOptions(o: unknown): RunApiOptions {
  if (o === undefined || o === null) return {};
  if (typeof o === "string") return { protocol: checkProtocol(o) };
  if (typeof o !== "object" || Array.isArray(o)) throw new Error(tr("run: volby musí být objekt {0} nebo název protokolu – dostal jsem {1}", "{ protocol, budget, notes }", Array.isArray(o) ? "array" : typeof o));
  const rec = o as Record<string, unknown>;
  const unknown = Object.keys(rec).filter((k) => !(OPTION_KEYS as readonly string[]).includes(k));
  if (unknown.length) throw new Error(tr("run: neznámá volba „{0}“ – protocol, budget, notes, signal", unknown.join(", ")));
  const protocol = checkProtocol(rec.protocol);
  const out: RunApiOptions = rec.protocol !== undefined && rec.protocol !== null ? { protocol } : {};
  if (rec.budget !== undefined) {
    const b = rec.budget;
    if (typeof b !== "number" || !Number.isInteger(b) || b < BUDGET_MIN || b > BUDGET_MAX) throw new Error(tr("run: budget musí být celé číslo {0}–{1} (bajty) – dostal jsem {2}", BUDGET_MIN, BUDGET_MAX, JSON.stringify(b) ?? String(b)));
    if (protocol !== "short" && protocol !== "json") throw new Error(tr("run: budget platí jen pro protokol short (a json) – zvolený protokol: {0}", protocol));
    out.budget = b;
  }
  if (rec.notes !== undefined) {
    if (typeof rec.notes !== "boolean") throw new Error(tr("run: notes musí být true nebo false – dostal jsem {0}", JSON.stringify(rec.notes) ?? String(rec.notes)));
    if (protocol === "console") throw new Error(tr("run: notes platí jen pro protokol short, full a json – výchozí text konzole ℹ vypisuje vždy"));
    out.notes = rec.notes;
  }
  if (rec.signal !== undefined) {
    const sg = rec.signal as { aborted?: unknown; addEventListener?: unknown } | null;
    if (!sg || typeof sg !== "object" || typeof sg.aborted !== "boolean" || typeof sg.addEventListener !== "function") throw new Error(tr("run: signal musí být AbortSignal (new AbortController().signal)"));
    out.signal = rec.signal as AbortSignal;
  }
  return out;
}

/** FileSink, který si pamatuje zapsané soubory (řádky F) – vrací tytéž objekty, takže `check` doplněný po zápisu v nich je */
function recordingSink(inner: FileSink): { sink: FileSink; files: OutFile[] } {
  const files: OutFile[] = [];
  return {
    files,
    sink: {
      async write(f) {
        const out = await inner.write(f);
        files.push(out);
        return out;
      },
    },
  };
}

/**
 * Běh skriptu se závěrem jako v CLI (souhrny dokumentů – řádky D, přísný režim po závěru). Report nese i text konzole
 * (`console`), takže tentýž běh lze vypsat kterýmkoli protokolem (`formatRun`).
 */
export async function runReport(ws: Workspace, text: string, host: EngineHost, o: EngineRunOptions = {}): Promise<RunReport> {
  const rb = new ReportBuilder({ lang: o.lang ?? getLang(), lines: scriptLineCount(text), strict: !!o.strict, ...(host.now ? { now: host.now } : {}) });
  // soubory zapsané skriptem (`export step`, `výkres export pdf`…) → řádky F jako CLI (dřív `files=0` a bez F)
  const rec = recordingSink(host.files);
  const console = await runInto(ws, text, { ...host, files: rec.sink }, rb, o);
  let docs: RunReport["docs"] = [];
  // zrušený výpočet (tlačítko Zrušit): dokument zůstal beze změny, nic dalšího se nestaví
  if (!rb.entries.some((e) => e.code === "run.cancelled")) {
    docs = (await runSummaries(ws, host.kernel, rb)).docs;
    // pojistka přísného režimu jako CLI (`cli/job.ts strictStop`): ⚠/✗ souhrnů v přísném úseku = STOP
    const hit = rb.stopped ? undefined : rb.strictMode?.hit(rb.entries, null);
    if (hit) rb.stop(hit.line ?? null, hit.code ?? "msg.error");
  }
  // jako CLI (cli/job.ts): soubory běhu s ✗ jsou `run=fail`
  if (rb.count("error") > 0) for (const f of rec.files) f.run = "fail";
  return { ...rb.finish({ docs, files: rec.files }), console };
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
