/**
 * Vstup `mncad` (CAD-HEADLESS-NAVRH.md kap. 3.1): jeden soubor svazku `mncad.mjs` slouží hlavnímu vláknu (hlídač,
 * příkazová řádka, `serve`) i vláknu běhu (`worker_threads`, `workerData.mncad === "mncad-job"` → `job.ts`). Graf modulů
 * vlákna běhu (parser, engine, jádro) se v hlavním vlákně nevyhodnocuje – načítá se dynamickým importem jen ve vlákně.
 *
 * Kód ukončení nastavuje výhradně hlavní vlákno (`process.exitCode`), nikdy emscripten ve vlákně:
 * 0 bez ✗ · 1 ✗ · 2 přísný režim zastaven · 3 chyba použití nebo souboru · 4 pád vlákna/jádra · 5 časový limit ·
 * 6 limit paměti · 130 přerušeno (SIGINT/SIGTERM).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, workerData } from "node:worker_threads";
import { setLang, tr } from "../i18n";
import { finalizeReport, formatFull, OVERFLOW_FILE } from "../engine/protocol";
import type { RunReport } from "../engine/protocol-types";
import { parseArgs, usageText, UsageError, type CliArgs, type RunArgs, type SelftestArgs } from "./args";
import { CliFileSink, prepareOutDir } from "./file-sink";
import type { JobInit, JobRequest } from "./job";
import { exitCodeFor, INTERRUPTION_EXIT, JOB_TAG, JobThread, type Outcome, type ThreadEvent } from "./watchdog";

export const SESSION_FILE = "session.mncad-ws";

export type Io = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  readStdin: () => Promise<string>;
  cwd: string;
  env: Record<string, string | undefined>;
  /** soubor svazku – vlákno běhu spustí tentýž soubor */
  entry: string;
  /** registrace SIGINT/SIGTERM (vrací odhlášení) */
  onSignal?: (fn: (sig: string) => void) => () => void;
};

/** složka svazku */
export const entryDir = (entry: string) => path.dirname(entry.startsWith("file:") ? fileURLToPath(entry) : entry);

/** verze z `package.json` vedle svazku (distribuce), jinak `0.0.0-dev` */
export function cliVersion(entry: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(entryDir(entry), "package.json"), "utf8")) as { name?: string; version?: string };
    if (pkg.name === "mncad" && pkg.version) return pkg.version;
  } catch {
    /* mimo distribuci */
  }
  return "0.0.0-dev";
}

/** složka písem: `fonts/` vedle svazku, `MNCAD_FONTS`, jinak `public/fonts` repozitáře nad svazkem */
export function fontsDir(entry: string, env: Record<string, string | undefined>): string | null {
  const ok = (d: string) => fs.existsSync(path.join(d, "Roboto-Regular.ttf"));
  const cands = [path.join(entryDir(entry), "fonts"), env.MNCAD_FONTS ?? ""];
  for (let d = entryDir(entry), i = 0; i < 8; i++, d = path.dirname(d)) cands.push(path.join(d, "public", "fonts"));
  return cands.find((d) => d && ok(d)) ?? null;
}

/** společné `workerData` vlákna běhu */
export function jobInit(io: Io, lang: JobInit["lang"], shareStore?: string): Omit<JobInit, "mncad"> {
  const fault = io.env.MNCAD_TEST_FAULT;
  return {
    lang,
    version: cliVersion(io.entry),
    origin: io.env.MNCAD_ORIGIN || undefined,
    fontsDir: fontsDir(io.entry, io.env),
    ...(shareStore !== undefined ? { shareStore } : {}),
    ...(fault ? { fault } : {}),
  };
}

const fmtEvent = (e: ThreadEvent): string | null => {
  const loc = (l: number | null) => (l === null ? "L-" : `L${l}`);
  switch (e.t) {
    case "ready":
      return tr("jádro připraveno za {0} ms (WASM {1} MB, RSS {2} MB)", e.ms, e.mem.heapMB, e.mem.rssMB);
    case "op-start":
      return `${loc(e.line)} ${e.op} …`;
    case "op-end":
      return e.ms >= 1000 ? `${loc(e.line)} ${e.op} ${(e.ms / 1000).toFixed(1)} s (WASM ${e.mem.heapMB} MB, RSS ${e.mem.rssMB} MB)` : null;
    case "progress":
      return e.total ? `  ${e.op} ${(e.index ?? 0) + 1}/${e.total}${e.name ? ` ${e.name}` : ""}` : null;
    case "dead":
      return null;
  }
};

/** Dokončení výstupu běhu: stručný protokol, přebytek do `protocol-full.txt`, relace; vrací text pro stdout. */
export function finishOutput(o: Outcome & { report: RunReport }, a: Pick<RunArgs, "budget" | "notes" | "full" | "json">, sink: CliFileSink | null, io: Io, session?: Uint8Array): string {
  const fin = finalizeReport(o.report, { budget: a.budget, notes: a.notes, full: a.full });
  if (fin.overflow && sink) {
    try {
      const p = sink.writeFixed(OVERFLOW_FILE, formatFull(fin) + "\n");
      fin.overflow = { ...fin.overflow, file: p };
    } catch (e) {
      io.stderr(tr("mncad: {0} se nepodařilo zapsat: {1}", OVERFLOW_FILE, (e as Error).message));
    }
  }
  if (session && sink) {
    try {
      sink.writeFixed(SESSION_FILE, session);
    } catch (e) {
      io.stderr(tr("mncad: {0} se nepodařilo zapsat: {1}", SESSION_FILE, (e as Error).message));
    }
  }
  if (a.json) return JSON.stringify(fin);
  return a.full ? (fin.full ?? formatFull(fin)) : fin.protocol;
}

async function cmdRun(a: RunArgs, io: Io): Promise<number> {
  let script: string;
  let scriptDir: string | null = null;
  try {
    if (a.script === "-") script = await io.readStdin();
    else {
      const p = path.resolve(io.cwd, a.script);
      script = fs.readFileSync(p, "utf8");
      scriptDir = path.dirname(p);
    }
  } catch (e) {
    io.stderr(tr("mncad: skript „{0}“ nelze přečíst: {1}", a.script, (e as Error).message));
    return 3;
  }
  let outDir: string;
  let sink: CliFileSink;
  try {
    outDir = prepareOutDir(path.resolve(io.cwd, a.out));
    sink = CliFileSink.create(outDir);
  } catch (e) {
    io.stderr(tr("mncad: výstupní složku „{0}“ nelze použít: {1}", a.out, (e as Error).message));
    return 3;
  }
  const roots: string[] = [];
  if (a.files !== undefined) {
    const d = path.resolve(io.cwd, a.files);
    if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) {
      io.stderr(tr("mncad: složka vstupů „{0}“ neexistuje", a.files));
      return 3;
    }
    roots.push(d);
  }
  if (scriptDir) roots.push(scriptDir);
  let resume: Uint8Array | null = null;
  if (a.resume !== undefined) {
    try {
      resume = new Uint8Array(fs.readFileSync(path.resolve(io.cwd, a.resume)));
    } catch (e) {
      io.stderr(tr("mncad: relaci „{0}“ nelze přečíst: {1}", a.resume, (e as Error).message));
      return 3;
    }
  }
  const req: JobRequest = {
    script,
    lang: a.lang,
    strict: a.strict,
    open: a.open,
    formats: a.formats,
    ...(a.doc !== undefined ? { doc: a.doc } : {}),
    allDocs: a.allDocs,
    noOutputOnError: a.noOutputOnError,
    share: a.share ? { view: a.share, days: a.shareDays } : false,
    inputs: { kind: "dirs", roots, explicit: a.open.map((f) => path.resolve(io.cwd, f)) },
    out: { kind: "dir", dir: outDir },
    resume,
    saveSession: a.resume !== undefined || a.formats !== "none",
  };
  let ticker: ReturnType<typeof setInterval> | undefined;
  let inFlight: { line: number | null; op: string; at: number } | null = null;
  const onEvent = (e: ThreadEvent) => {
    if (e.t === "op-start") inFlight = { line: e.line, op: e.op, at: e.at };
    if (e.t === "op-end") inFlight = null;
    if (!a.progress) return;
    const s = fmtEvent(e);
    if (s) io.stderr(s);
  };
  const thread = new JobThread({ entry: io.entry, init: jobInit(io, a.lang, a.shareStore), maxMemMB: a.maxMem, rssGuard: true, onEvent, ...(a.progress ? { onConsole: (t: string) => io.stderr(t.replace(/\n$/, "")) } : {}) });
  if (a.progress)
    ticker = setInterval(() => {
      if (inFlight && Date.now() - inFlight.at >= 5000) io.stderr(`${inFlight.line === null ? "L-" : `L${inFlight.line}`} ${inFlight.op} … ${Math.round((Date.now() - inFlight.at) / 1000)} s`);
    }, 5000);
  const off = io.onSignal?.(() => void thread.interrupt());
  let outcome: Outcome;
  try {
    outcome = await thread.run(req, { deadline: a.timeout > 0 ? thread.startedAt + a.timeout * 1000 : null, timeoutSec: a.timeout, lang: a.lang });
  } finally {
    off?.();
    if (ticker) clearInterval(ticker);
  }
  await thread.close(); // vlákno po zásahu hlídače už neběží; jinak řádný konec (i po odmítnutém požadavku)
  setLang(a.lang);
  if (outcome.kind === "failed") {
    io.stderr(`mncad: ${outcome.error}`);
    return 3;
  }
  io.stdout(finishOutput(outcome, a, sink, io, outcome.kind === "done" ? outcome.session : undefined));
  return exitCodeFor(outcome, a.strict);
}

async function cmdSelftest(a: SelftestArgs, io: Io): Promise<number> {
  const thread = new JobThread({ entry: io.entry, init: jobInit(io, a.lang), maxMemMB: a.maxMem, rssGuard: true });
  const off = io.onSignal?.(() => void thread.interrupt());
  try {
    const ready = await thread.ready;
    const res = await thread.selftest(a.timeout * 1000);
    if (a.json) io.stdout(JSON.stringify({ version: cliVersion(io.entry), node: process.version, readyMs: ready.ms, ...res }));
    else {
      io.stdout(`mncad ${cliVersion(io.entry)} · node ${process.version} · ${tr("jádro připraveno za {0} ms", ready.ms)}`);
      for (const c of res.checks) io.stdout(`${c.ok ? "ok" : "FAIL"}: ${c.name} (${c.ms} ms) ${c.detail}`);
      io.stdout(`mem: WASM ${res.mem.heapMB} MB, RSS ${res.mem.rssMB} MB`);
    }
    return res.ok ? 0 : 1;
  } catch (e) {
    io.stderr(tr("mncad: selftest selhal: {0}", (e as Error).message));
    // zásah hlídače má stejné kódy jako `run`: 5 časový limit, 6 paměť, 130 Ctrl+C; jinak pád (4)
    const k = thread.interruption;
    return k ? INTERRUPTION_EXIT[k] : 4;
  } finally {
    off?.();
    await thread.close().catch(() => undefined);
  }
}

async function cmdHelp(topic: string[], io: Io): Promise<number> {
  const t = (topic[0] ?? "").toLowerCase();
  if (!t) {
    io.stdout(usageText());
    return 0;
  }
  if (["guide", "návod", "navod", "anleitung"].includes(t)) {
    const { AGENT_GUIDE } = await import("../agent-guide");
    io.stdout(AGENT_GUIDE);
    return 0;
  }
  if (["commands", "příkazy", "prikazy", "befehle"].includes(t)) {
    const { AGENT_COMMANDS } = await import("../agent");
    io.stdout(AGENT_COMMANDS.map((c) => `${c.cmd}\n    ${c.en} · ${c.de} – ${c.desc}`).join("\n"));
    return 0;
  }
  throw new UsageError(tr("neznámé téma nápovědy „{0}“ – guide, commands", topic.join(" ")));
}

/** Celý příkaz `mncad …`; vrací kód ukončení (volající ho nastaví do `process.exitCode`). */
export async function main(argv: string[], io: Io): Promise<number> {
  let args: CliArgs;
  setLang((io.env.MNCAD_LANG as JobInit["lang"]) ?? "cs");
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (e instanceof UsageError) {
      io.stderr(`mncad: ${e.message}`);
      return 3;
    }
    throw e;
  }
  setLang(args.lang);
  try {
    switch (args.cmd) {
      case "help":
        return await cmdHelp(args.topic, io);
      case "version":
        io.stdout(args.json ? JSON.stringify({ version: cliVersion(io.entry), node: process.version, platform: `${process.platform}-${process.arch}` }) : `mncad ${cliVersion(io.entry)} (node ${process.version}, ${process.platform}-${process.arch})`);
        return 0;
      case "selftest":
        return await cmdSelftest(args, io);
      case "run":
        return await cmdRun(args, io);
      case "serve": {
        const { serveMain } = await import("./serve");
        return await serveMain(args, io);
      }
    }
  } catch (e) {
    if (e instanceof UsageError) {
      io.stderr(`mncad: ${e.message}`);
      return 3;
    }
    io.stderr(tr("mncad: neočekávaná chyba: {0}", (e as Error).stack ?? String(e)));
    return 4;
  }
}

/**
 * Zápis na stdout/stderr procesu, který nespadne na zavřené rouře (`mncad help guide | head`): EPIPE (a jiné chyby
 * proudu) se zachytí, další výstup se zahodí a kód ukončení zůstane ten, který nastaví `main` (ne 1 a výpis zásobníku).
 */
export function streamWriter(stream: NodeJS.WritableStream & { on(ev: "error", fn: (e: NodeJS.ErrnoException) => void): unknown }): (s: string) => void {
  let closed = false;
  stream.on("error", () => {
    closed = true;
  });
  return (s: string) => {
    if (closed) return;
    try {
      stream.write(s.endsWith("\n") ? s : s + "\n");
    } catch {
      closed = true;
    }
  };
}

/**
 * Proces: hlavní vlákno spustí `main`, vlákno běhu `jobMain`. Volá ho jen vstup svazku (`scripts/cad-cli-build.mjs`
 * vytvoří virtuální vstup `import { boot } from "…/main"; boot()`), import modulu v testech nic nespouští.
 */
export async function boot(): Promise<void> {
  if (!isMainThread) {
    if ((workerData as { mncad?: string } | null)?.mncad === JOB_TAG) {
      const { jobMain } = await import("./job");
      await jobMain();
    }
    return;
  }
  const io: Io = {
    stdout: streamWriter(process.stdout),
    stderr: streamWriter(process.stderr),
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const c of process.stdin) chunks.push(c as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    },
    cwd: process.cwd(),
    env: process.env,
    entry: import.meta.url,
    onSignal: (fn) => {
      const h = (sig: string) => fn(sig);
      process.on("SIGINT", h);
      process.on("SIGTERM", h);
      return () => {
        process.off("SIGINT", h);
        process.off("SIGTERM", h);
      };
    },
  };
  const code = await main(process.argv.slice(2), io);
  process.exitCode = code;
}
