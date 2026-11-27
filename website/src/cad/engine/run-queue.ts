/**
 * Identita a fronta běhů (vlna 22, body 12, 15, 22h) – JEDEN model pro textové běhy, úlohy exportu a úlohy `mncad serve`.
 *
 * Každý výpočet má `id` běhu (rostoucí v rámci stránky / procesu: `r12`, serve `j3`) a `inputRev` = klíč dokumentu + revize
 * modelu (`<docKey>@r·a1b2c3`, revize z engine/result-key.ts – žádné druhé hashování). Stavy:
 *
 *   queued (čeká) → running (počítá) → done (dokončeno) | cancelled (zrušeno) | error (chyba) | superseded (nahrazeno)
 *
 * `RunTracker` běhy řadí do jedné fronty (nikdy dva běhy enginu najednou – druhý `window.mncad.run` čeká, dokud první
 * nedoběhne), drží jejich stav, fáze (export: model → převod → kontrola → zápis), čas a výsledek a umí běh zrušit:
 * čekající běh se vyřadí dřív, než začne (dokument beze změny), běžícímu se pošle `AbortSignal` a háček `onCancel`
 * (prohlížeč: ukončení výpočtu v jádře). Konec běhu (i zrušeného nebo s chybou) zůstává v seznamu (`list()`), dokud ho
 * nevytlačí novější (posledních `keep` hotových) – stav exportu tak po jeho konci nezmizí.
 *
 * `SeqGuard` je vzor „pozdní odpověď staršího výpočtu nepřepíše novější“ (drawing-workspace.tsx `seq`): každý start dostane
 * pořadí, výsledek se použije jen tehdy, je-li pořád poslední (`current()`), jinak je „nahrazen“.
 *
 * Modul nemá závislost na Reactu ani na jádře – stejný v prohlížeči, v CLI i v `mncad serve`.
 */
import { tr } from "../i18n";
import type { CadDoc } from "../types";
import { modelRev } from "./result-key";

export const RUN_STATES = ["queued", "running", "done", "cancelled", "error", "superseded"] as const;
export type RunState = (typeof RUN_STATES)[number];
/** běh skončil (už se nezmění) */
export const isFinal = (s: RunState): boolean => s !== "queued" && s !== "running";

/** text stavu pro člověka (konzole, seznam Exporty, chip) – čeká / počítá / dokončeno / zrušeno / chyba / nahrazeno */
export function runStateText(s: RunState): string {
  switch (s) {
    case "queued":
      return tr("čeká");
    case "running":
      return tr("počítá");
    case "done":
      return tr("dokončeno");
    case "cancelled":
      return tr("zrušeno");
    case "error":
      return tr("chyba");
    case "superseded":
      return tr("nahrazeno");
  }
}

/** `compute` = výpočet uvnitř aplikace (stavba modelu, vazby, kolize, měření – components/cad/compute-runs.ts) */
export type RunKind = "script" | "export" | "compute";
/** odkud běh přišel: konzole, `window.mncad`, menu aplikace, `mncad run`, `mncad serve` */
export type RunSource = "console" | "api" | "menu" | "cli" | "http" | "app";

/** identita běhu v protokolu (`RunReport.run`, JSON, HTTP, Σ `run=`) */
export type RunStamp = { id: string; inputRev: string; state?: RunState };

/** revize vstupu: klíč dokumentu + krátká revize modelu (`<docKey>@r·a1b2c3`; bez klíče `-@…`) */
export function inputRevOf(docKey: string | null | undefined, doc: CadDoc): string {
  return `${docKey || "-"}@${modelRev(doc)}`;
}

export type RunPhaseState = "running" | "done" | "cancelled" | "error";
export type RunPhaseRec = { phase: string; state: RunPhaseState; startedAt: number; ms?: number };

/** výsledek běhu (export: soubor, velikost, kontrola zpětným načtením, revize modelu exportu) */
export type RunResult = {
  ok?: boolean;
  file?: string;
  format?: string;
  bytes?: number;
  /** `note` = soubor odpovídá modelu, platnost souboru ale nezkontrolována (ℹ, ne ✓ – 22c kolo 7) */
  check?: { ok: boolean; text: string; note?: boolean };
  modelRev?: string;
  /** soubor nebyl zapsán (zrušeno / chyba) – a jestli se prázdný cíl dialogu „Uložit jako“ smazal */
  written?: boolean;
  removed?: boolean;
  note?: string;
};

export type RunEntry = {
  id: string;
  /** pořadí v trackeru (1, 2, …) */
  seq: number;
  kind: RunKind;
  source: RunSource;
  /** krátký popis (první řádek skriptu, „STEP · Deska A.step“) */
  label: string;
  /** druh výpočtu aplikace (`build`, `mates`, `clash`, `measure`) */
  what?: string;
  doc?: string;
  docKey?: string;
  inputRev?: string;
  state: RunState;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  /** čas běhu (od startu) – u běžícího průběžně `now - startedAt` (`elapsed`) */
  ms?: number;
  /** právě běžící fáze */
  phase?: string;
  phases: RunPhaseRec[];
  progress?: { index: number; total: number; name?: string };
  result?: RunResult;
  error?: string;
};

export type RunSpec = {
  kind: RunKind;
  source: RunSource;
  label: string;
  what?: string;
  doc?: string;
  docKey?: string;
  inputRev?: string;
  /** zrušení běžícího běhu (prohlížeč: `cad.cancel()` – ukončí výpočet v jádře) */
  onCancel?: () => void;
};

/** běh byl zrušen (dřív, než začal, nebo během) – `done` běhu skončí touto chybou */
export class RunCancelled extends Error {
  constructor(readonly id: string) {
    super(tr("běh {0} zrušen", id));
    this.name = "RunCancelled";
  }
}
export const isRunCancelled = (e: unknown): e is RunCancelled => e instanceof RunCancelled;

/** ovládání běžícího běhu pro jeho práci */
export type RunControl = {
  readonly id: string;
  readonly signal: AbortSignal;
  readonly entry: RunEntry;
  /** začátek fáze (předchozí fáze se ukončí jako hotová) */
  phase(name: string): void;
  /** průběh uvnitř fáze (prvek k z n) */
  progress(index: number, total: number, name?: string): void;
  /** doplnění údajů běhu (dokument, revize, výsledek) */
  set(patch: Partial<Pick<RunEntry, "doc" | "docKey" | "inputRev" | "label">> & { result?: RunResult }): void;
  /** konečný stav určený prací (např. engine zrušení ohlásil textem, ne výjimkou) */
  finish(state: Extract<RunState, "done" | "cancelled" | "error">, error?: string): void;
  /** zrušeno? → výjimka `RunCancelled` (mezi kroky práce) */
  check(): void;
};

export type RunHandle<T> = { id: string; entry: RunEntry; done: Promise<T> };

type Item = {
  entry: RunEntry;
  spec: RunSpec;
  ctrl: AbortController;
  work: (c: RunControl) => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  final?: { state: Extract<RunState, "done" | "cancelled" | "error">; error?: string };
};

export type TrackerOptions = { prefix?: string; keep?: number; now?: () => number };

/**
 * Fronta a stav běhů. `enqueue` = běh ve frontě (jeden po druhém); `begin`/`start`/`end` = běh, jehož pořadí řídí volající
 * (`mncad serve`: relace a vlákna), tracker drží jen identitu a stav.
 */
export class RunTracker {
  private seq = 0;
  private readonly items = new Map<string, Item>();
  private readonly queue: Item[] = [];
  private running: Item | null = null;
  private readonly entries: RunEntry[] = [];
  private readonly listeners = new Set<() => void>();
  private idleWaiters: (() => void)[] = [];
  private readonly prefix: string;
  private readonly keep: number;
  private readonly now: () => number;
  /** počítadlo změn (snímky pro React `useSyncExternalStore`) */
  version = 0;

  constructor(o: TrackerOptions = {}) {
    this.prefix = o.prefix ?? "r";
    this.keep = o.keep ?? 50;
    this.now = o.now ?? (() => Date.now());
  }

  /** odběr změn (stav, fáze, průběh); vrací odhlášení */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private changed() {
    this.version++;
    for (const f of [...this.listeners]) {
      try {
        f();
      } catch {
        /* posluchač nesmí shodit frontu */
      }
    }
  }

  /** nový záznam ve stavu „čeká“; `id` = vlastní id od volajícího (HTTP `id`) – obsazené id běžícího běhu se nepoužije */
  begin(spec: Omit<RunSpec, "onCancel"> & { id?: string }): RunEntry {
    const seq = ++this.seq;
    const own = spec.id && !this.entries.some((e) => e.id === spec.id && !isFinal(e.state)) ? spec.id : null;
    if (own) this.entries.splice(0, this.entries.length, ...this.entries.filter((e) => e.id !== own)); // dřívější hotový běh téhož id
    const entry: RunEntry = {
      id: own ?? `${this.prefix}${seq}`,
      seq,
      kind: spec.kind,
      source: spec.source,
      label: spec.label,
      ...(spec.what !== undefined ? { what: spec.what } : {}),
      ...(spec.doc !== undefined ? { doc: spec.doc } : {}),
      ...(spec.docKey !== undefined ? { docKey: spec.docKey } : {}),
      ...(spec.inputRev !== undefined ? { inputRev: spec.inputRev } : {}),
      state: "queued",
      queuedAt: this.now(),
      phases: [],
    };
    this.entries.push(entry);
    this.trim();
    this.changed();
    return entry;
  }
  /** běh začal počítat */
  start(id: string): void {
    const e = this.get(id);
    if (!e || e.state !== "queued") return;
    e.state = "running";
    e.startedAt = this.now();
    this.changed();
  }
  /** konec běhu (stav se už nezmění; běžící fáze skončí stejným stavem) */
  end(id: string, state: Exclude<RunState, "queued" | "running">, error?: string): void {
    const e = this.get(id);
    if (!e || isFinal(e.state)) return;
    const t = this.now();
    const last = e.phases[e.phases.length - 1];
    if (last && last.state === "running") {
      last.state = state === "done" ? "done" : state === "error" ? "error" : "cancelled";
      last.ms = t - last.startedAt;
    }
    delete e.phase;
    e.state = state;
    e.endedAt = t;
    if (e.startedAt !== undefined) e.ms = t - e.startedAt;
    if (error) e.error = error;
    this.trim();
    this.changed();
    if (!this.busy()) this.flushIdle();
  }
  /** fáze běhu (předchozí běžící fáze se ukončí jako hotová) */
  phase(id: string, name: string): void {
    const e = this.get(id);
    if (!e || isFinal(e.state)) return;
    const t = this.now();
    const last = e.phases[e.phases.length - 1];
    if (last && last.state === "running") {
      last.state = "done";
      last.ms = t - last.startedAt;
    }
    e.phases.push({ phase: name, state: "running", startedAt: t });
    e.phase = name;
    delete e.progress;
    this.changed();
  }
  progress(id: string, index: number, total: number, name?: string): void {
    const e = this.get(id);
    if (!e || isFinal(e.state)) return;
    e.progress = { index, total, ...(name ? { name } : {}) };
    this.changed();
  }
  update(id: string, patch: Partial<Pick<RunEntry, "doc" | "docKey" | "inputRev" | "label">> & { result?: RunResult }): void {
    const e = this.get(id);
    if (!e) return;
    const { result, ...rest } = patch;
    Object.assign(e, rest);
    if (result) e.result = { ...(e.result ?? {}), ...result };
    this.changed();
  }

  /**
   * Běh ve frontě: začne, až doběhnou všechny dřívější. `done` = výsledek práce; zrušený běh (před startem i během) skončí
   * `RunCancelled` (práce, která zrušení ohlásí sama – engine zapíše ✗ run.cancelled a vrátí protokol –, zavolá
   * `ctl.finish("cancelled")` a vrátí výsledek).
   */
  enqueue<T>(spec: RunSpec, work: (c: RunControl) => Promise<T>): RunHandle<T> {
    const entry = this.begin(spec);
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const done = new Promise<T>((res, rej) => {
      resolve = res as (v: unknown) => void;
      reject = rej;
    });
    const item: Item = { entry, spec, ctrl: new AbortController(), work, resolve, reject };
    this.items.set(entry.id, item);
    this.queue.push(item);
    queueMicrotask(() => this.pump());
    return { id: entry.id, entry, done };
  }

  private pump(): void {
    if (this.running) return;
    const item = this.queue.shift();
    if (!item) {
      if (!this.busy()) this.flushIdle();
      return;
    }
    if (isFinal(item.entry.state)) return this.pump(); // zrušen ve frontě
    this.running = item;
    this.start(item.entry.id);
    const id = item.entry.id;
    const ctl: RunControl = {
      id,
      signal: item.ctrl.signal,
      entry: item.entry,
      phase: (n) => this.phase(id, n),
      progress: (i, t, n) => this.progress(id, i, t, n),
      set: (p) => this.update(id, p),
      finish: (state, error) => void (item.final = { state, ...(error ? { error } : {}) }),
      check: () => {
        if (item.ctrl.signal.aborted) throw new RunCancelled(id);
      },
    };
    let p: Promise<unknown>;
    try {
      p = Promise.resolve(item.work(ctl));
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      (v) => {
        const st = item.final?.state ?? (item.ctrl.signal.aborted ? "cancelled" : "done");
        this.end(id, st, item.final?.error);
        item.resolve(v);
      },
      (e) => {
        const cancelled = isRunCancelled(e) || item.ctrl.signal.aborted || item.final?.state === "cancelled" || (e as Error)?.name === "CadCancelled";
        this.end(id, cancelled ? "cancelled" : "error", cancelled ? undefined : errText(e));
        item.reject(cancelled && !isRunCancelled(e) ? new RunCancelled(id) : e);
      },
    ).finally(() => {
      this.items.delete(id);
      this.running = null;
      this.pump();
    });
  }

  /**
   * Zrušení běhu `id` (bez id: běžící běh, jinak nejstarší čekající). Čekající = hned „zrušeno“ (nikdy nezačne), běžící =
   * `AbortSignal` + `onCancel`. Vrací true, když bylo co rušit.
   */
  cancel(id?: string): boolean {
    const item = id ? this.items.get(id) : (this.running ?? this.queue.find((q) => !isFinal(q.entry.state)));
    if (!item || isFinal(item.entry.state)) return false;
    if (item.entry.state === "queued") {
      const i = this.queue.indexOf(item);
      if (i >= 0) this.queue.splice(i, 1);
      this.items.delete(item.entry.id);
      this.end(item.entry.id, "cancelled");
      item.reject(new RunCancelled(item.entry.id));
      return true;
    }
    item.ctrl.abort();
    try {
      item.spec.onCancel?.();
    } catch {
      /* zrušení výpočtu v jádře je jen pokus */
    }
    return true;
  }

  /** záznam běhu */
  get(id: string): RunEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }
  /** běhy (nejstarší první); `kind` = jen jeden druh */
  list(kind?: RunKind): RunEntry[] {
    return kind ? this.entries.filter((e) => e.kind === kind) : [...this.entries];
  }
  /** právě běžící běh */
  active(): RunEntry | null {
    return this.entries.find((e) => e.state === "running") ?? null;
  }
  /** běhy, které čekají nebo počítají */
  pending(): RunEntry[] {
    return this.entries.filter((e) => !isFinal(e.state));
  }
  busy(): boolean {
    return this.entries.some((e) => !isFinal(e.state));
  }
  /** počká, až žádný běh nečeká ani nepočítá */
  idle(): Promise<void> {
    if (!this.busy()) return Promise.resolve();
    return new Promise<void>((res) => this.idleWaiters.push(res));
  }
  private flushIdle() {
    const w = this.idleWaiters;
    this.idleWaiters = [];
    for (const f of w) f();
  }
  /** hotových záznamů nejvýš `keep` (běžící a čekající se nikdy nevyřazují) */
  private trim() {
    let over = this.entries.filter((e) => isFinal(e.state)).length - this.keep;
    for (let i = 0; i < this.entries.length && over > 0; ) {
      if (isFinal(this.entries[i].state)) {
        this.entries.splice(i, 1);
        over--;
      } else i++;
    }
  }
  /** čas běhu: hotový = `ms`, běžící = od startu do teď */
  elapsed(e: RunEntry): number {
    if (e.ms !== undefined) return e.ms;
    return e.startedAt !== undefined ? this.now() - e.startedAt : 0;
  }
  /** veřejný snímek záznamu (window.mncad.runs(), HTTP `GET /runs`) */
  snapshot(e: RunEntry): RunSnapshot {
    return {
      id: e.id,
      kind: e.kind,
      source: e.source,
      state: e.state,
      label: e.label,
      ...(e.what !== undefined ? { what: e.what } : {}),
      ...(e.doc !== undefined ? { doc: e.doc } : {}),
      ...(e.inputRev !== undefined ? { inputRev: e.inputRev } : {}),
      queuedAt: new Date(e.queuedAt).toISOString(),
      ...(e.startedAt !== undefined ? { startedAt: new Date(e.startedAt).toISOString() } : {}),
      ms: Math.round(this.elapsed(e)),
      ...(e.phase ? { phase: e.phase } : {}),
      phases: e.phases.map((p) => ({ phase: p.phase, state: p.state, ms: Math.round(p.ms ?? this.now() - p.startedAt) })),
      ...(e.progress ? { progress: { ...e.progress } } : {}),
      ...(e.result ? { result: { ...e.result } } : {}),
      ...(e.error ? { error: e.error } : {}),
    };
  }
}

/** snímek běhu pro automatizaci (JSON) */
export type RunSnapshot = {
  id: string;
  kind: RunKind;
  source: RunSource;
  state: RunState;
  label: string;
  what?: string;
  doc?: string;
  inputRev?: string;
  queuedAt: string;
  startedAt?: string;
  ms: number;
  phase?: string;
  phases: { phase: string; state: RunPhaseState; ms: number }[];
  progress?: { index: number; total: number; name?: string };
  result?: RunResult;
  error?: string;
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ───────────────────────── pozdní odpovědi: vzor seq ───────────────────────── */

export type SeqTicket = {
  readonly n: number;
  /** je tento start pořád poslední? (jinak výsledek nepoužít – „nahrazeno“) */
  current(): boolean;
  /** konec: „done“, nebo „superseded“, když mezitím začal novější výpočet */
  settle(): Extract<RunState, "done" | "superseded">;
};

/**
 * Pozdní odpověď staršího výpočtu nikdy nepřepíše novější (vzor `seq` z drawing-workspace.tsx): `begin()` při každém startu,
 * po `await` výsledek použít jen při `ticket.current()`. `superseded` = počet zahozených pozdních odpovědí (diagnostika).
 */
export class SeqGuard {
  private n = 0;
  superseded = 0;
  begin(): SeqTicket {
    const n = ++this.n;
    return {
      n,
      current: () => n === this.n,
      settle: () => {
        if (n === this.n) return "done";
        this.superseded++;
        return "superseded";
      },
    };
  }
  /** zneplatní všechny rozběhnuté výpočty (např. změna dokumentu) */
  invalidate(): void {
    this.n++;
  }
}
