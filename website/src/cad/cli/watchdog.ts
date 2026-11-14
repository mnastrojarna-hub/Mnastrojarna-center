/**
 * Hlídač vlákna běhu (CAD-HEADLESS-NAVRH.md kap. 2.2, 3.1, 3.2): hlavní vlákno nečeká na nic z vlákna běhu – časový
 * limit, limit paměti, Ctrl+C a pád řeší `worker.terminate()`, který přeruší i synchronní volání WASM (P8: 33–37 ms).
 *
 * Vlákno po každé operaci posílá průběžný stav (`op-end`: nové záznamy, nové soubory, paměť); hlídač si ho skládá.
 * Při zásahu složí `RunReport` z posledního známého stavu a doplní ✗ `run.timeout` / `run.memory` / `run.crash` /
 * `run.interrupted` na řádek rozpracované operace (`L-`, když rozpracovaná operace řádek skriptu nemá – otevření,
 * závěrečná stavba, výstupy). Kód ukončení nastavuje jen hlavní vlákno (`exitCodeFor` → `process.exitCode`).
 *
 * Paměť: vlákno hlásí po každé operaci haldu WASM (`HEAPU8`/`wasmMemory`), haldu JS vlákna a RSS procesu. Během
 * dlouhého volání jádra hlídač každých 200 ms čte velikost haldy WASM ze sdílené paměti (háček `grow` ve vlákně,
 * `node-shims.ts`) a v `mncad run` (jedno vlákno) i RSS procesu; nad `--max-mem` → `run.memory`. V `mncad serve` (víc
 * vláken v jednom procesu) se limit vztahuje na vlákno: halda WASM + halda JS vlákna; halda JS má navíc V8
 * `resourceLimits` (přetečení = `ERR_WORKER_OUT_OF_MEMORY` → `run.memory`).
 */
import { Worker } from "node:worker_threads";
import { setLang, type CadLang } from "../i18n";
import type { Code } from "../engine/codes";
import { ReportBuilder } from "../engine/protocol";
import type { Entry, OutFile, RunReport } from "../engine/protocol-types";
import type { StrictOpt } from "./args";
import type { DoneFile, FromJob, JobInit, JobRequest, Mem, SelftestResult, ToJob } from "./job";

/** počet řádků skriptu (koncový konec řádku netvoří další řádek) */
export const scriptLines = (text: string): number => (text ? text.replace(/\r?\n$/, "").split(/\r?\n/).length : 0);

/** značka vlákna běhu ve `workerData` (shodně s `JobInit["mncad"]`) */
export const JOB_TAG: JobInit["mncad"] = "mncad-job";

export type Interruption = "timeout" | "memory" | "crash" | "interrupted";
export type Outcome =
  | { kind: "done"; report: RunReport; files: DoneFile[]; session?: Uint8Array }
  | { kind: Interruption; report: RunReport; detail: string }
  /** vlákno požadavek odmítlo (neplatná relace, nepoužitelná výstupní složka) – chyba souboru, kód 3 */
  | { kind: "failed"; error: string };

export const INTERRUPTION_CODE: Record<Interruption, Code> = { timeout: "run.timeout", memory: "run.memory", crash: "run.crash", interrupted: "run.interrupted" };
/** kód ukončení zásahu hlídače (i `mncad selftest`) */
export const INTERRUPTION_EXIT: Record<Interruption, number> = { crash: 4, timeout: 5, memory: 6, interrupted: 130 };

/** první záznam, který v přísném režimu zastaví běh (⚠/✗ s kódem mimo výjimky; ℹ nikdy) */
export function strictStopper(entries: readonly Entry[], strict: StrictOpt): Entry | undefined {
  if (!strict) return undefined;
  const except = typeof strict === "object" ? new Set(strict.except) : new Set<string>();
  return entries.find((e) => (e.level === "error" || e.level === "warn") && !(e.code && except.has(e.code)));
}

/**
 * Kód ukončení (kap. 3.1): 0 OK (v přísném režimu i bez ⚠) · 1 ✗ · 2 přísný STOP · 3 použití/soubor · 4 pád · 5 limit
 * času · 6 limit paměti · 130 přerušeno. `strict` = volba běhu: ⚠/✗ mimo výjimky v přísném běhu je vždy 2, i kdyby ho
 * vlákno nezastavilo (pojistka).
 */
export function exitCodeFor(o: Outcome, strict: StrictOpt = false): number {
  switch (o.kind) {
    case "done":
      if (o.report.stopped || strictStopper(o.report.entries, strict)) return 2;
      return o.report.counts.errors > 0 ? 1 : 0;
    case "failed":
      return 3;
    default:
      return INTERRUPTION_EXIT[o.kind];
  }
}

/** HTTP stav odpovědi `POST /run` (kap. 3.2): 200 i při ✗; 504 limit času, 507 paměť, 500 pád */
export function httpStatusFor(o: Outcome): number {
  switch (o.kind) {
    case "done":
      return 200;
    case "failed":
      return 400;
    case "timeout":
      return 504;
    case "memory":
      return 507;
    case "crash":
    case "interrupted":
      return 500;
  }
}

export type ThreadEvent =
  | { t: "ready"; ms: number; mem: Mem }
  | { t: "op-start"; line: number | null; op: string; at: number }
  | { t: "op-end"; line: number | null; op: string; ms: number; mem: Mem }
  | { t: "progress"; op: string; index?: number; total?: number; name?: string }
  | { t: "dead"; reason: string };

export type ThreadOptions = {
  /** soubor svazku (`import.meta.url` v `mncad.mjs`) – vlákno spustí tentýž soubor */
  entry: string | URL;
  init: Omit<JobInit, "mncad">;
  /** limit paměti MB (0 = bez limitu) */
  maxMemMB: number;
  /** `mncad run`: hlídat i RSS celého procesu (jediné vlákno) */
  rssGuard?: boolean;
  onEvent?: (e: ThreadEvent) => void;
  /** interval čtení RSS (ms) */
  pollMs?: number;
  /**
   * výstup vlákna na konzoli (knihovny, emscripten): stdout CLI patří jen protokolu / JSON, proto se výpisy vlákna nikdy
   * nemíchají do stdout – bez obsluhy se zahodí, `mncad run --progress` je pošle na stderr
   */
  onConsole?: (text: string) => void;
};

export type RunCall = {
  /** absolutní čas vypršení (ms od epochy), null = bez limitu */
  deadline: number | null;
  /** limit v sekundách pro text hlášky */
  timeoutSec: number;
  /** jazyk hlášek hlídače */
  lang: CadLang;
};

type Current = {
  id: number;
  req: JobRequest;
  call: RunCall;
  entries: Entry[];
  files: OutFile[];
  ops: { line: number; op: string; ms: number }[];
  inFlight: { line: number | null; op: string; at: number } | null;
  peak: number;
  t0: number;
  settle: (o: Outcome) => void;
  timer?: ReturnType<typeof setTimeout>;
};

let seq = 0;

/**
 * Jedno vlákno běhu. `mncad run`: jedno vlákno, jeden běh, pak `close()`. `mncad serve`: vlákno připnuté k relaci, víc
 * běhů za sebou (MemoryWorkspace i mezipaměti jádra žijí ve vlákně), ukončí se po nečinnosti, limitu nebo pádu.
 */
export class JobThread {
  readonly worker: Worker;
  readonly startedAt = Date.now();
  readonly ready: Promise<{ ms: number; mem: Mem }>;
  lastMem: Mem = { heapMB: 0, jsMB: 0, rssMB: 0 };
  /** vlákno skončilo (pád, terminate, konec) – další běh v něm není možný */
  dead = false;
  deadReason = "";
  private cur: Current | null = null;
  private poll?: ReturnType<typeof setInterval>;
  private readyResolve!: (v: { ms: number; mem: Mem }) => void;
  private readyReject!: (e: Error) => void;
  private selftestWait = new Map<number, (r: SelftestResult | Error) => void>();
  private terminating: Interruption | null = null;
  /** sdílená paměť s vláknem: [0] = halda WASM v MB (háček `grow`, čte se i během dlouhého volání jádra) */
  private readonly memView = new Int32Array(new SharedArrayBuffer(8));

  constructor(private readonly o: ThreadOptions) {
    this.ready = new Promise((res, rej) => {
      this.readyResolve = res;
      this.readyReject = rej;
    });
    this.ready.catch(() => undefined);
    const init: JobInit = { mncad: JOB_TAG, ...o.init, memSab: this.memView.buffer as SharedArrayBuffer };
    this.worker = new Worker(o.entry instanceof URL ? o.entry : new URL(o.entry), {
      workerData: init,
      // halda JS vlákna – přetečení je ERR_WORKER_OUT_OF_MEMORY (→ run.memory); WASM V8 limity nepokrývají
      ...(o.maxMemMB > 0 ? { resourceLimits: { maxOldGenerationSizeMb: Math.max(256, o.maxMemMB) } } : {}),
      stdout: true,
      stderr: true,
    });
    for (const st of [this.worker.stdout, this.worker.stderr]) {
      if (o.onConsole) st.on("data", (d: Buffer) => o.onConsole!(d.toString("utf8")));
      else st.resume();
    }
    this.worker.on("message", (m: FromJob) => this.onMessage(m));
    this.worker.on("error", (e: Error & { code?: string }) => {
      const kind: Interruption = e.code === "ERR_WORKER_OUT_OF_MEMORY" ? "memory" : "crash";
      this.die(kind, `${e.name}: ${e.message}`);
    });
    this.worker.on("exit", (code) => this.die(this.terminating ?? "crash", `exit code ${code}`));
    // čtení paměti i během dlouhého volání jádra: halda WASM ze sdílené paměti (každé vlákno zvlášť), v `run` i RSS
    this.poll = setInterval(() => this.pollMem(), o.pollMs ?? 200);
    this.poll.unref?.();
  }

  /** halda WASM vlákna (MB) podle háčku `grow` – aktuální i uprostřed operace */
  get wasmMB(): number {
    return Atomics.load(this.memView, 0);
  }
  /** zásah hlídače, který vlákno ukončil (null = běží nebo skončilo řádně) */
  get interruption(): Interruption | null {
    return this.terminating;
  }

  private pollMem() {
    if (this.dead) return;
    const wasm = this.wasmMB;
    const rss = this.o.rssGuard ? process.memoryUsage.rss() / 1048576 : 0;
    const used = this.o.rssGuard ? Math.max(rss, wasm) : wasm + this.lastMem.jsMB;
    if (this.cur) this.cur.peak = Math.max(this.cur.peak, used);
    if (this.o.maxMemMB > 0 && used > this.o.maxMemMB) void this.kill("memory", this.o.rssGuard && rss >= wasm ? `rss ${Math.round(rss)} MB` : `wasm ${wasm} MB + js ${this.lastMem.jsMB} MB`);
  }

  get busy(): boolean {
    return !!this.cur;
  }

  private onMessage(m: FromJob) {
    const c = this.cur;
    switch (m.t) {
      case "ready":
        this.lastMem = m.mem;
        this.readyResolve({ ms: m.ms, mem: m.mem });
        this.o.onEvent?.({ t: "ready", ms: m.ms, mem: m.mem });
        this.checkMem(m.mem);
        return;
      case "fatal":
        this.readyReject(new Error(m.error));
        void this.kill("crash", m.error);
        return;
      case "selftest": {
        const w = this.selftestWait.get(m.id);
        this.selftestWait.delete(m.id);
        w?.(m.result);
        return;
      }
    }
    if (!c || ("id" in m && m.id !== c.id)) {
      if (m.t === "failed") this.selftestWait.get(m.id)?.(new Error(m.error));
      return;
    }
    switch (m.t) {
      case "op-start":
        c.inFlight = { line: m.line, op: m.op, at: Date.now() };
        this.o.onEvent?.({ t: "op-start", line: m.line, op: m.op, at: c.inFlight.at });
        break;
      case "op-end":
        c.entries.push(...m.entries);
        c.files.push(...m.files);
        if (m.line !== null) c.ops.push({ line: m.line, op: m.op, ms: m.ms });
        c.inFlight = null;
        this.lastMem = m.mem;
        c.peak = Math.max(c.peak, m.mem.rssMB, m.mem.heapMB);
        this.o.onEvent?.({ t: "op-end", line: m.line, op: m.op, ms: m.ms, mem: m.mem });
        this.checkMem(m.mem);
        break;
      case "progress":
        this.o.onEvent?.({ t: "progress", op: m.op, index: m.index, total: m.total, name: m.name });
        break;
      case "done":
        this.lastMem = m.mem;
        this.finish({ kind: "done", report: m.report, files: m.files, ...(m.session ? { session: m.session } : {}) });
        break;
      case "failed":
        this.finish({ kind: "failed", error: m.error });
        break;
    }
  }

  /** paměť po operaci: `run` = max(RSS procesu, halda WASM); `serve` = halda WASM + halda JS vlákna */
  private checkMem(mem: Mem) {
    if (!(this.o.maxMemMB > 0)) return;
    const used = this.o.rssGuard ? Math.max(mem.rssMB, mem.heapMB) : mem.heapMB + mem.jsMB;
    if (used > this.o.maxMemMB) void this.kill("memory", `${used} MB`);
  }

  private finish(o: Outcome) {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    if (c.timer) clearTimeout(c.timer);
    c.settle(o);
  }

  /** složí protokol z posledního stavu, který vlákno poslalo, a doplní ✗ zásahu hlídače */
  compose(kind: Interruption, detail: string): RunReport | null {
    const c = this.cur;
    if (!c) return null;
    setLang(c.call.lang);
    const rb = new ReportBuilder({ lang: c.call.lang, lines: scriptLines(c.req.script), strict: !!c.req.strict });
    for (const e of c.entries) rb.add(e);
    for (const op of c.ops) rb.op(op.line, op.op, op.ms);
    const line = c.inFlight?.line ?? null;
    const args = kind === "timeout" ? [c.call.timeoutSec] : kind === "memory" ? [this.o.maxMemMB] : kind === "crash" ? [detail] : [];
    rb.code(INTERRUPTION_CODE[kind], { line, args, data: { op: c.inFlight?.op ?? null, detail } });
    rb.memory(c.peak);
    const files = c.files.map((f) => ({ ...f, run: "fail" as const }));
    return rb.finish({ files, ms: Date.now() - c.t0 });
  }

  /** zásah hlídače: ukončí vlákno (přeruší i běžící volání WASM) a uzavře běžící požadavek */
  async kill(kind: Interruption, detail: string): Promise<void> {
    if (this.dead || this.terminating) return;
    this.terminating = kind;
    const report = this.compose(kind, detail);
    if (report) this.finish({ kind, report, detail });
    this.readyReject(new Error(`${INTERRUPTION_CODE[kind]}: ${detail}`));
    // čekající selftest se dozví důvod zásahu (ne „exit code 1“ z terminate)
    for (const w of this.selftestWait.values()) w(new Error(`${INTERRUPTION_CODE[kind]}: ${detail}`));
    this.selftestWait.clear();
    await this.worker.terminate().catch(() => undefined);
  }

  private die(kind: Interruption, detail: string) {
    if (this.dead) return;
    this.dead = true;
    this.deadReason = detail;
    if (this.poll) clearInterval(this.poll);
    const report = this.compose(kind, detail);
    if (report) this.finish({ kind, report, detail });
    this.readyReject(new Error(detail));
    for (const w of this.selftestWait.values()) w(new Error(detail));
    this.selftestWait.clear();
    this.o.onEvent?.({ t: "dead", reason: detail });
  }

  /** Běh skriptu ve vlákně; vlákno musí být volné. Limit času běží od `call.deadline` (CLI: od startu vlákna). */
  run(req: JobRequest, call: RunCall): Promise<Outcome> {
    if (this.cur) throw new Error("JobThread: busy");
    return new Promise<Outcome>((settle) => {
      const c: Current = { id: ++seq, req, call, entries: [], files: [], ops: [], inFlight: { line: null, op: "init", at: Date.now() }, peak: this.lastMem.rssMB, t0: Date.now(), settle };
      this.cur = c;
      if (this.dead) {
        const report = this.compose(this.terminating ?? "crash", this.deadReason || "dead");
        this.finish({ kind: this.terminating ?? "crash", report: report!, detail: this.deadReason });
        return;
      }
      if (call.deadline !== null) c.timer = setTimeout(() => void this.kill("timeout", `${call.timeoutSec} s`), Math.max(0, call.deadline - Date.now()));
      this.ready.then(
        () => {
          if (this.cur !== c) return;
          c.inFlight = null;
          const msg: ToJob = { t: "run", id: c.id, req };
          this.worker.postMessage(msg);
        },
        () => undefined,
      );
    });
  }

  /** `mncad selftest` ve vlákně (jádro, písma, odkaz, smoke test příkladů); limit času = zásah hlídače (kód 5) */
  async selftest(timeoutMs: number): Promise<SelftestResult> {
    await this.ready;
    const id = ++seq;
    return new Promise<SelftestResult>((resolve, reject) => {
      const timer = timeoutMs > 0 ? setTimeout(() => void this.kill("timeout", `${Math.round(timeoutMs / 1000)} s`), timeoutMs) : null;
      this.selftestWait.set(id, (r) => {
        if (timer) clearTimeout(timer);
        if (r instanceof Error) reject(r);
        else resolve(r);
      });
      const msg: ToJob = { t: "selftest", id };
      this.worker.postMessage(msg);
    });
  }

  /** Ctrl+C / SIGTERM */
  interrupt(): Promise<void> {
    return this.kill("interrupted", "SIGINT");
  }

  /** řádné ukončení volného vlákna */
  async close(): Promise<void> {
    if (this.dead) return;
    this.terminating = this.terminating ?? "interrupted";
    if (this.poll) clearInterval(this.poll);
    const done = new Promise<void>((res) => this.worker.once("exit", () => res()));
    try {
      const msg: ToJob = { t: "close" };
      this.worker.postMessage(msg);
    } catch {
      /* vlákno už neběží */
    }
    const t = setTimeout(() => void this.worker.terminate(), 2000);
    await done;
    clearTimeout(t);
  }
}
