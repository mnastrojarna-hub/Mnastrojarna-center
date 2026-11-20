/**
 * Běhy v aplikaci (vlna 22, body 12 a 22h) – prohlížečová strana RunTrackeru (engine/run-queue.ts):
 *
 *  * `appRuns` – jediná fronta běhů stránky: textové příkazy (konzole, `window.mncad.run`) i úlohy exportu (menu,
 *    `window.mncad.exportFile`) – nikdy dva běhy enginu najednou; `window.mncad.runs()` je vypíše, `cancelRun(id)` zruší;
 *  * `textRun` – běh skriptu ve frontě s identitou (`id`, `inputRev`) a zrušením (signál + Zrušit výpočtu v jádře);
 *    zrušený čekající běh vrátí protokol ✗ run.cancelled v požadovaném formátu (nic se neprovedlo);
 *  * `outputGate` – uložit / export / sdílet počkají na frontu a stavbu modelu (chip „Čekám na dokončení výpočtu…“
 *    se Zrušit, run-chip.tsx), nebo se zruší;
 *  * `motionHold` – pokyny pohybové studie z běhu (`pohyb přehrát`) se doručí až po zápisu dokumentu běhu, s razítkem
 *    běhu (`run`: id, klíč dokumentu, revize) – panel pohybu tak nikdy nespočítá starou studii ze starého dokumentu;
 *  * `consoleRuns` – výsledek běhu konzole podle id (přežije zavření konzole; znovu otevřená konzole ho ukáže).
 */
import { tr } from "@/cad/i18n";
import { ReportBuilder } from "@/cad/engine/protocol";
import { formatRun, scriptLineCount, type RunApiOptions } from "@/cad/engine/run-protocol";
import { inputRevOf, isRunCancelled, RunTracker, type RunEntry, type RunHandle, type RunSource, type RunStamp } from "@/cad/engine/run-queue";
import { modelRev } from "@/cad/engine/result-key";
import type { CadDoc } from "@/cad/types";
import type { MotionSignal } from "@/cad/asm-agent-kin";

/** fronta běhů stránky (prohlížeč: jedna na kartu) */
export const appRuns = new RunTracker({ prefix: "r", keep: 50 });

/** popis běhu: první neprázdný řádek skriptu (JSON dokument = „JSON“) */
export function runLabel(text: string): string {
  const t = text.trim();
  if (t.startsWith("{")) return tr("dokument JSON");
  return (t.split(/\r?\n/).find((l) => l.trim()) ?? "").trim().slice(0, 80);
}

/** protokol běhu zrušeného dřív, než začal (✗ run.cancelled; dokument beze změny) v požadovaném formátu */
export function cancelledText(id: string, text: string, o: RunApiOptions = {}, lang?: Parameters<typeof formatRun>[0]["lang"]): string {
  const rb = new ReportBuilder({ lang: lang ?? "cs", lines: scriptLineCount(text) });
  rb.code("run.cancelled", { line: null });
  rb.run = { id, inputRev: "-", state: "cancelled" };
  const r = { ...rb.finish({}), console: tr("✗ Běh {0} zrušen dřív, než začal – nic se neprovedlo, dokument zůstal beze změny.", id) };
  return formatRun(r, o);
}

export type TextRunDeps = {
  /** klíč a dokument aktivní záložky (revize vstupu se bere při startu běhu – po doběhnutí dřívějších) */
  docKey(): string;
  present(): CadDoc;
  /** zrušení výpočtu v jádře (tlačítko Zrušit) – běžící běh pak skončí ✗ run.cancelled */
  cancelKernel(): void;
  /** provedení skriptu (engine) se signálem zrušení a identitou běhu; vrací text a zda engine běh zrušil */
  exec(signal: AbortSignal, stamp: RunStamp): Promise<{ text: string; cancelled: boolean }>;
};

/**
 * Běh skriptu ve frontě `tracker`. `signal` = zrušení zvenku (`window.mncad.run(text, { signal })`), `onQueued` = id běhu
 * hned po zařazení (konzole si ho pamatuje). Vrací text protokolu (zrušený čekající běh = protokol ✗ run.cancelled).
 */
export async function textRun(tracker: RunTracker, text: string, o: { source: RunSource; signal?: AbortSignal; onQueued?: (id: string) => void; format?: RunApiOptions; lang?: Parameters<typeof cancelledText>[3] }, deps: TextRunDeps): Promise<string> {
  const h: RunHandle<string> = tracker.enqueue({ kind: "script", source: o.source, label: runLabel(text), onCancel: () => deps.cancelKernel() }, async (ctl) => {
    const d = deps.present();
    const key = deps.docKey();
    const stamp: RunStamp = { id: ctl.id, inputRev: inputRevOf(key, d) };
    ctl.set({ doc: d.name, docKey: key, inputRev: stamp.inputRev });
    const r = await deps.exec(ctl.signal, stamp);
    ctl.finish(r.cancelled ? "cancelled" : "done");
    return r.text;
  });
  o.onQueued?.(h.id);
  const ext = o.signal;
  if (ext) {
    if (ext.aborted) tracker.cancel(h.id);
    else ext.addEventListener("abort", () => tracker.cancel(h.id), { once: true });
  }
  try {
    const out = await h.done;
    consoleRuns.set(h.id, out);
    return out;
  } catch (e) {
    if (!isRunCancelled(e)) throw e;
    const out = cancelledText(h.id, text, o.format, o.lang);
    consoleRuns.set(h.id, out);
    return out;
  }
}

/* ───────────────────────── výsledky běhů pro konzoli ───────────────────────── */

/** text výsledku běhu podle id (posledních 20) – konzole ho najde i po zavření a novém otevření */
class RunOutputs {
  private readonly m = new Map<string, string>();
  private readonly subs = new Set<() => void>();
  set(id: string, text: string) {
    this.m.set(id, text);
    while (this.m.size > 20) this.m.delete(this.m.keys().next().value!);
    this.subs.forEach((f) => f());
  }
  get(id: string | null | undefined): string | undefined {
    return id ? this.m.get(id) : undefined;
  }
  subscribe(f: () => void) {
    this.subs.add(f);
    return () => void this.subs.delete(f);
  }
}
export const consoleRuns = new RunOutputs();

/* ───────────────────────── uložit / export / sdílet čekají na dokončený stav ───────────────────────── */

export type GateState = { what: string; since: number } | null;

/**
 * Brána výstupů: akce (uložit, export, sdílet) počká, až doběhne fronta běhů a stavba modelu, a mezitím ukáže chip
 * „Čekám na dokončení výpočtu…“ se Zrušit. Zrušení = akce se neprovede (vrací false).
 */
export class OutputGate {
  state: GateState = null;
  private cancelFn: (() => void) | null = null;
  private readonly subs = new Set<() => void>();
  subscribe(f: () => void) {
    this.subs.add(f);
    return () => void this.subs.delete(f);
  }
  private emit() {
    this.subs.forEach((f) => f());
  }
  /** `busy()` = je na co čekat; `ready()` = slib dokončení (fronta + stavba) */
  async wait(what: string, busy: () => boolean, ready: () => Promise<void>): Promise<boolean> {
    if (!busy()) return true;
    if (this.state) this.cancelFn?.(); // novější akce nahradí čekající (dvojklik na Uložit)
    let cancel!: () => void;
    const cancelled = new Promise<false>((r) => (cancel = () => r(false)));
    this.cancelFn = cancel;
    this.state = { what, since: Date.now() };
    this.emit();
    try {
      return await Promise.race([ready().then(() => true as const), cancelled]);
    } finally {
      if (this.cancelFn === cancel) {
        this.state = null;
        this.cancelFn = null;
        this.emit();
      }
    }
  }
  cancel(): boolean {
    if (!this.cancelFn) return false;
    this.cancelFn();
    return true;
  }
}
export const outputGate = new OutputGate();

/* ───────────────────────── pokyny pohybové studie až po zápisu dokumentu ───────────────────────── */

/**
 * Razítko pokynu pohybové studie: z jakého běhu je a pro jaký dokument (klíč + revize modelu po zápisu běhu). Panel
 * pohybu (balík M) pokyn provede jen tehdy, když `signalMatches(stamp, klíč, dokument)` – jinak je „nahrazen“.
 */
export type SignalStamp = { id: string; docKey: string; rev: string };
export const signalMatches = (st: SignalStamp | undefined, docKey: string, doc: CadDoc): boolean => !st || (st.docKey === docKey && st.rev === modelRev(doc));

/** pokyny z běhu se drží, dokud běh nezapíše dokument (konec běhu), pak se doručí s razítkem */
export class SignalHold<S extends object> {
  private held: S[] = [];
  private depth = 0;
  begin(): void {
    this.depth++;
  }
  /** během běhu podrží, jinak hned doručí */
  push(sig: S, deliver: (s: S) => void): void {
    if (this.depth > 0) this.held.push(sig);
    else deliver(sig);
  }
  /** konec běhu: doručí podržené pokyny s razítkem (dokument běhu už je zapsaný) */
  end(deliver: (s: S) => void, stamp?: SignalStamp): void {
    if (this.depth > 0) this.depth--;
    if (this.depth > 0) return;
    const h = this.held;
    this.held = [];
    for (const s of h) deliver(stamp ? ({ ...s, run: stamp } as S) : s);
  }
  get pending(): number {
    return this.held.length;
  }
}

/* ───────────────────────── window.mncad: snímky ───────────────────────── */

/** běhy pro automatizaci (`window.mncad.runs()`; `kind` = jen jeden druh) */
export const runsSnapshot = (kind?: RunEntry["kind"]) => appRuns.list(kind).map((e) => appRuns.snapshot(e));

/** pokyny pohybové studie z textových běhů (`pohyb přehrát`, `pohyb krok`) – doručí se až po zápisu dokumentu běhu */
export const motionSignalHold = new SignalHold<MotionSignal>();

/* ───────────────────────── window.mncad: bariéra a čekání ───────────────────────── */

/** metody, které vytvářejí výstup z dokumentu – počkají na dokončený stav (fronta běhů + stavba), nebo skončí chybou */
export const API_WAIT = new Set(["save", "exportFile", "exportDrawing", "share", "script"]);
/** metody bez vztahu k dokumentu (stav, nápověda, ovládání běhů) – bez bariéry */
export const API_PLAIN = new Set(["version", "lang", "missing", "guide", "commands", "history", "progress", "cancel", "cancelRun", "runs", "exports", "pending", "idle", "perf", "hints", "settings", "attachments", "openConsole"]);

/**
 * Obalí `window.mncad`: každé volání nejdřív zapíše rozepsané změny (bariéra, 22e/22f); výstupy (uložit, export, sdílet,
 * skript) navíc počkají na dokončený stav (bod 12) – zrušené čekání (chip Zrušit) = chyba s důvodem, nic se nezapíše.
 */
export function guardApi<T extends object>(api: T, o: { flush: (why: string) => void; wait: (what: string) => Promise<boolean> }): T {
  const out: Record<string, unknown> = { ...(api as Record<string, unknown>) };
  for (const [k, v] of Object.entries(api as Record<string, unknown>)) {
    if (typeof v !== "function" || API_PLAIN.has(k)) continue;
    const fn = v as (...a: unknown[]) => unknown;
    out[k] = API_WAIT.has(k)
      ? async (...a: unknown[]) => {
          o.flush(`api:${k}`);
          if (!(await o.wait(k))) throw new Error(tr("{0}: neprovedeno – čekání na dokončení výpočtu bylo zrušeno", k));
          return fn(...a);
        }
      : (...a: unknown[]) => {
          o.flush(`api:${k}`);
          return fn(...a);
        };
  }
  return out as T;
}
