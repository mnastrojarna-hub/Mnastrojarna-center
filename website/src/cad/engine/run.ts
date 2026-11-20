/**
 * Běh textového skriptu bez Reactu (CAD-HEADLESS-NAVRH.md kap. 2.2–2.5, balík B2) – smyčka přesunutá z `runAgentText`
 * v cad-app.tsx. Aplikace (`components/cad/engine-port.ts`) i CLI / `mncad serve` (cli/job.ts) volají tutéž funkci se
 * svým pracovním prostorem (`Workspace`) a hostitelem (`EngineHost`); obsluhy operací jsou v `engine/ops/*` (registr).
 *
 * Pořadí jako dřív: chyby rozboru a výsledky operací podle řádků skriptu, ověřovací stavba PŘED zápisem do dokumentu
 * (zrušený výpočet dokument nezmění), zápis do záložky, výsledky přidaných prvků po stavbě, stav dokumentu.
 * Výsledek: `RunReport` se záznamy s kódem (stručný protokol CLI/HTTP) a `console` = dnešní text konzole prohlížeče.
 */
import { docStatusText, parseAgentText, type AgentOp } from "../agent";
import { stripLineComment } from "../agent-comment";
import { getLang, tr } from "../i18n";
import { CadCancelled, isCancelled } from "../kernel-client";
import type { CadDoc, Feature } from "../types";
import { fmtNum } from "@/lib/mesh-metrics";
import { asmStatus, asmStatusOf, staleNotes } from "./asm-status";
import { CodedError, codeDef, codeText, isCode, type Code } from "./codes";
import { lintOp } from "./lint";
import { DrawingTracker } from "./drawing-track";
import { reportStaleSheets } from "./outputs-ops";
import { StrictState, type StrictMark } from "./strict";
import { RunVerifier, verifyKey } from "./verify";
import { freshenRunDoc } from "./spring-fresh";
import { statusKv } from "./kv";
import { ConsoleLog } from "./console";
import { changedFrom, modelSig } from "./accept";
import { MissingInputError, OutPathError, type EngineHost } from "./host";
import "./ops";
import { runEngineOp, type OpCtx } from "./ops/registry";
import { ReportBuilder } from "./protocol";
import type { Entry, RunOptions, RunReport } from "./protocol-types";
import { docKeyOf, flush, runOf, type EngineRun } from "./run-doc";
import { withValidity } from "./validity-store";
import { MAX_DEPTH } from "../assembly";
import type { Workspace } from "./workspace";

/** háčky běhu pro hlídače CLI (průběh, rozpracovaná operace) a přísný režim */
export type RunHooks = {
  opStart?(line: number | null, op: string): void;
  opEnd?(line: number | null, op: string, ms: number): void;
  /** po každé operaci: záznamy, které operace přidala; true = zastavit běh (přísný režim – STOP zapíše volající) */
  stopAfter?(entries: readonly Entry[], line: number): boolean;
};

/**
 * `preloaded` = dokumenty, které volající otevřel před skriptem (CLI `--open`): klíč ověření (`<docKey>#part|asm`) a
 * dokument – ověří se stavbou jako JSON na řádku skriptu (✗/⚠ prvků bez řádku), i když běh přejde na jiný dokument.
 */
export type EngineRunOptions = RunOptions & {
  hooks?: RunHooks;
  preloaded?: { key: string; doc: CadDoc }[];
  /**
   * zrušení běhu (vlna 22, bod 12 – RunTracker: tlačítko Zrušit konzole, `window.mncad.cancelRun`, `run(text, { signal })`):
   * kontroluje se před každou operací a před závěrečnou stavbou; zrušený běh skončí jako po Zrušit u výpočtu (✗ run.cancelled)
   */
  signal?: AbortSignal;
};

/** popis operace pro hlášky a časy (`feature:box`, `asm:mate`, `drawingCmd:sheet`) */
export function opLabel(op: AgentOp): string {
  const o = op as { k: string; feature?: Feature; cmd?: { k?: string; kind?: string } };
  const sub = op.k === "feature" ? o.feature?.type : (o.cmd?.k ?? o.cmd?.kind);
  return sub ? `${op.k}:${sub}` : op.k;
}

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** kód chyby operace podle třídy výjimky */
function errorCode(e: unknown): Code {
  if (e instanceof CodedError) return e.code;
  if (e instanceof OutPathError) return "out.path";
  if (e instanceof MissingInputError) return "file.missing";
  return "op.failed";
}

/**
 * Provede skript nad `ws` a vrátí report (záznamy, časy operací) s textem konzole (`report.console`).
 * Volby: `inPlace` (JSON dokument nahradí aktivní záložku), `hooks` (průběh, přísný režim), `lang`, `strict`.
 */
export async function runScript(ws: Workspace, text: string, host: EngineHost, o: EngineRunOptions = {}): Promise<RunReport> {
  const rb = new ReportBuilder({ lang: o.lang ?? getLang(), lines: text.split(/\r?\n/).length, strict: !!o.strict, ...(host.now ? { now: host.now } : {}) });
  const console = await runInto(ws, text, host, rb, o);
  return { ...rb.finish(), console };
}

/**
 * Smyčka běhu do daného reportu (CLI k němu pak přidá závěrečné souhrny a výstupy – cli/job.ts). Vrací text konzole.
 * Výjimky obsluh se nepolykají tiše: každá je ✗ s kódem na řádku operace; zrušený výpočet (tlačítko Zrušit) ukončí běh.
 */
export async function runInto(ws: Workspace, text: string, host: EngineHost, rb: ReportBuilder, o: EngineRunOptions = {}): Promise<string> {
  ws.beginRun?.();
  const hooks = o.hooks ?? {};
  const now = host.now ?? (() => Date.now());
  const log = new ConsoleLog(rb);
  // prázdný skript za dokumenty otevřenými volajícím (CLI `--open` bez skriptu) není chyba – dokumenty se jen ověří
  const prog = !text.trim() && o.preloaded?.length ? { ops: [], errors: [], warnings: [] } : parseAgentText(text);
  const srcLines = text.split(/\r?\n/);
  // přísný režim podle řádků: volba běhu + řádky `přísně` (stav na řádku záznamu – engine/strict.ts); záznamy, které
  // report má už před skriptem (CLI `--open`), posoudil volající
  const marks: StrictMark[] = prog.ops.flatMap((x) => (x.k === "strict" ? [{ line: x.line, on: x.on, ...(x.except ? { except: x.except } : {}) }] : []));
  const strict = new StrictState(o.strict, marks);
  for (const e of rb.entries) strict.settled.add(e);
  rb.strictMode = strict;
  // protokol v pořadí řádků vstupu: chyby čtení (řádek 8) nepředbíhají výsledky dřívějších řádků
  for (const e of prog.errors) {
    log.body.push({ line: e.line, text: tr("✗ řádek {0}: {1}{2}", e.line, e.message, e.text ? ` ← „${e.text}“` : "") });
    const code: Code = e.code && isCode(e.code) ? e.code : "parse.error";
    if (code === "parse.error") rb.code(code, { line: e.line > 0 ? e.line : null, args: [e.text ? `${e.message} ← „${e.text.slice(0, 80)}“` : e.message] });
    else rb.code(code, { line: e.line > 0 ? e.line : null, text: e.message });
  }
  // tiché změny zápisu (5.2): varování rozboru (agent.ts) a kontroly hotových operací (lint.ts) – před během, na řádku
  for (const w of prog.warnings ?? []) {
    const code: Code = isCode(w.code) ? w.code : "msg.warn";
    // ℹ (neškodná normalizace) jen do protokolu, ⚠ i do konzole
    if (codeDef(code)?.level === "note") rb.code(code, { line: w.line, args: w.args ?? [] });
    else log.coded(w.line, code, { args: w.args ?? [] });
  }
  for (const op of prog.ops) for (const d of lintOp(op, stripLineComment(srcLines[op.line - 1] ?? ""))) log.coded(op.line, d.code, { args: d.args });
  const run: EngineRun = { doc: JSON.parse(JSON.stringify(ws.present())) as CadDoc, changed: false, openNew: false, tabbed: false, added: [], currentBody: null, openDrawingAfter: false, lastOp: prog.ops[prog.ops.length - 1], srcLines };
  const ctx: OpCtx = { ws, host, opts: o, report: rb, run, line: 0, log, strict };
  /** řádek, na kterém prvek vznikl (záznamy ze stavby nesou řádek prvku – kap. 4.1) */
  const featureLine = new Map<string, number>();
  const verify = new RunVerifier(ctx);
  for (const p of o.preloaded ?? []) verify.loaded(p.key, p.doc, null);
  verify.switched();
  /** bloky po sobě jdoucích příkazů `výkres …` a listy, které běh měnil (kap. 5.3) */
  const draw = new DrawingTracker(ctx);
  /** konec bloku příkazů výkresu: nálezy na řádky bloku; true = přísný režim zastavil */
  const closeBlock = async (): Promise<boolean> => {
    const line = draw.lastLine;
    const fresh = await draw.close(strict.at(line).on);
    return stopOn(fresh, line);
  };
  /**
   * přísný režim: první záznam ⚠/✗ mezi `fresh` na řádku s přísným režimem → STOP (hlavička, ■ v konzoli); `line` =
   * řádek operace pro záznamy bez řádku (`null` = po posledním řádku skriptu – stav přísného režimu na konci)
   */
  const stopOn: StopOn = (fresh, line) => {
    if (rb.stopped) return true;
    const hit = strict.hit(fresh, line);
    if (!hit) return false;
    rb.stop(hit.line ?? (line || null), hit.code ?? "msg.error");
    log.tailLine(line === null ? stopEndLine(hit) : stopLine(hit, line || undefined));
    return true;
  };
  /** přísný běh od začátku: dokumenty otevřené volajícím (`--open`) se ověří hned – chybný dokument = STOP před skriptem */
  const strictPreloaded = async (): Promise<boolean> => {
    if (!o.preloaded?.length || !strict.at(1).on) return false;
    const before = rb.entries.length;
    for (const p of o.preloaded) await verify.verifyDoc(p.key);
    return stopOn(rb.entries.slice(before), 0);
  };
  try {
    // přísný úsek: chyba nebo varování rozboru zastaví běh dřív, než se cokoli provede (vypíšou se všechny)
    const pre = [...rb.entries].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    if (stopOn(pre, 0) || (await strictPreloaded())) {
      /* STOP před během – nic se neprovede */
    } else if (!(prog.errors.length && hooks.stopAfter?.(rb.entries, 0))) {
      // dokumenty otevřené volajícím (--open): délka pružin z dosedacích ploch, rozpor ⚠ spring.stale (vlna 22, bod 7)
      const b0 = rb.entries.length;
      if (o.preloaded?.length) await freshenRunDoc(ctx, null);
      for (const op of stopOn(rb.entries.slice(b0), 0) ? [] : prog.ops) {
        if (o.signal?.aborted) throw new CadCancelled(); // zrušený běh: další řádky se neprovedou
        // konec bloku příkazů výkresu (jiný příkaz nebo přepnutí listu): nálezy bloku na jeho řádky
        if (draw.open && (op.k !== "drawingCmd" || op.cmd.k === "sheet") && (await closeBlock())) break;
        const label = opLabel(op);
        const before = rb.entries.length;
        const addedBefore = run.added.length;
        const docBefore = run.doc; // vlastnosti dílu před operací – změna čísla / materiálu / druhu vloženého dílu = ⚠ (bod 22g)
        const keyBefore = verifyKey(ctx);
        // otisk modelu před operací: pozná i změnu na místě (stavba ověřuje jen stav po POSLEDNÍ změně – engine/verify.ts)
        const sigBefore = GEOMETRY_OPS.has(op.k) ? modelSig(run.doc) : null;
        run.touched = [];
        hooks.opStart?.(op.line, label);
        const t0 = now();
        let failed = false;
        try {
          if (!(await runEngineOp(op, ctx))) {
            log.coded(op.line, "host.app-only", { args: [label], doc: run.doc.name });
            rb.op(op.line, label, now() - t0);
          }
        } catch (e) {
          if (isCancelled(e)) throw e;
          failed = true;
          log.error(op.line, errMessage(e), { code: errorCode(e), doc: runOf(ctx).doc.name });
        }
        const added = run.added.slice(addedBefore);
        for (const f of added) if (!featureLine.has(f.id)) featureLine.set(f.id, op.line);
        // 5.2 č. 19 / vlna 22 bod 22g: díl změněný po vložení do sestavy (prvek, číslo, materiál, druh) – komponenta je kopie,
        // změna se do sestavy sama nepromítne; rada = jedna funkce obnovy `sestava obnovit` (asm-refresh.ts)
        const ins = run.inserted?.get(run.doc.name.trim().toLowerCase());
        const metaChanged = docBefore === run.doc ? [] : partMetaChange(docBefore, run.doc);
        if ((added.length || metaChanged.length) && run.doc.kind !== "assembly" && run.doc.kind !== "draft" && !ws.asm.stack.length) {
          const what = [...(added.length ? [tr("geometrie")] : []), ...metaChanged].join(", ");
          // vložený tímto během (řádek vložení), jinak díl, jehož kopie je v otevřené sestavě (dřívější běh, konzole, --resume)
          const asmName = ins === undefined ? asmWithCopy(ws, run.doc.name) : undefined;
          const once = !rb.entries.some((e) => e.code === "asm.stale-copy" && e.doc === run.doc.name);
          if (once && ins !== undefined) log.coded(op.line, "asm.stale-copy", { doc: run.doc.name, text: tr("díl „{0}“ je v sestavě vložený na řádku {1} jako kopie – změna ({2}) se do sestavy sama nepromítne; v sestavě: sestava obnovit \"{0}\"", run.doc.name, ins, what) });
          else if (once && asmName) log.coded(op.line, "asm.stale-copy", { doc: run.doc.name, text: tr("díl „{0}“ je v sestavě „{1}“ jako kopie – změna ({2}) se do sestavy sama nepromítne; v sestavě: sestava obnovit \"{0}\"", run.doc.name, asmName, what) });
          if (ins !== undefined) run.inserted!.delete(run.doc.name.trim().toLowerCase());
        }
        // přímo upravené prvky (i ty, které běh sám přidal) a místo v historii, od kterého operace model změnila: výsledek
        // prvku pak jde na řádek poslední operace, která změnila jeho nebo cokoli před ním (22i)
        const touched = run.touched?.length ? run.doc.features.filter((f) => run.touched!.includes(f.id) && !added.some((x) => x.id === f.id)) : [];
        const sameDoc = verifyKey(ctx) === keyBefore;
        verify.note([...added, ...touched], op.line, sameDoc ? changedFrom(docBefore, run.doc, { names: false }) : null, sameDoc && sigBefore !== null && modelSig(run.doc) !== sigBefore);
        // dokument, ze kterého běh odešel (nový díl, záložka, normálie), se postaví hned – jeho prvky se neohlásí bez stavby
        // JSON dokument / otevřený soubor: ověří se jako celek (prvky bez ✓) a výsledek jde na řádek načtení
        if (op.k === "doc" || (op.k === "open" && !failed)) verify.loaded(verifyKey(ctx), run.doc, op.line);
        const left = verify.switched();
        if (left) await verify.verifyDoc(left);
        // prvky dílu upraveného v kontextu, které selhaly při `sestava hotovo`: ohlásilo je ověření dílu, jinak řádek operace
        for (const x of run.partFailures?.splice(0) ?? []) if (!verify.hasFailure(x.doc, x.name)) log.coded(op.line, "feature.failed", { doc: x.doc, args: [x.name, x.error] });
        // přísný režim: model se postaví po každé operaci, která ho změnila (bez sítě, přírůstkově) – stop na řádku prvku
        if (strict.on && GEOMETRY_OPS.has(op.k)) await verify.strictCheck(op.line).catch((e) => {
          if (isCancelled(e)) throw e;
          rb.code("build.failed", { line: op.line, doc: run.doc.name, args: [errMessage(e)] });
        });
        if (op.k === "drawingCmd") draw.add(op.line);
        hooks.opEnd?.(op.line, label, now() - t0);
        const fresh = rb.entries.slice(before);
        if (stopOn(fresh, op.line)) break;
        if (hooks.stopAfter?.(fresh, op.line)) break;
      }
      if (o.signal?.aborted) throw new CadCancelled();
      if (draw.open && !rb.stopped) await closeBlock();
      // listy, které běh měnil, v konečném stavu (normální režim jednou na konci, přísný doplní změny po bloku)
      if (!rb.stopped) stopOn(await draw.finish((k) => verify.docOf(k)), null);
    }
    return await finishRun(ctx, featureLine, now, verify, stopOn);
  } catch (e) {
    if (!isCancelled(e)) throw e;
    // zrušeno tlačítkem Zrušit: nic se nezapsalo; jádro se znovu připraví nad dosavadním dokumentem
    host.ui?.restoreKernel?.();
    rb.code("run.cancelled");
    const present = ws.present();
    log.tailLine(tr("✗ Výpočet zrušen – dokument zůstal beze změny."), "", docStatusText(present, null, present.kind === "assembly" ? asmStatusOf(ws, present, ws.docKey()) : undefined));
    return log.text();
  }
}

/** hloubka vnoření podsestav (sestava bez podsestav = 1); hlubší než `MAX_DEPTH` se při stavbě vynechají (5.2 č. 29) */
function asmDepth(d: CadDoc, level = 1): number {
  if (level > MAX_DEPTH + 1) return level;
  let max = level;
  for (const c of d.components ?? []) if (c.source.kind === "asm") max = Math.max(max, asmDepth(c.source.doc, level + 1));
  return max;
}

/** operace, po kterých přísný režim model ověří stavbou (přidané / upravené prvky, skica, zpět) */
const GEOMETRY_OPS = new Set<AgentOp["k"]>(["feature", "features", "select", "sketchOn", "entities", "constraints", "dims", "edit", "pop", "surf", "body", "doc"]);

/** řádek konzole po zastavení přísným režimem */
const stopLine = (e: Entry, line?: number) => tr("■ přísný režim: zastaveno na řádku {0} ({1}) – další řádky se neprovedly", e.line ?? line ?? "-", e.code ?? "msg.error");
/** řádek konzole po zastavení přísným režimem až po posledním řádku (závěrečná stavba, listy výkresu v konečném stavu) */
const stopEndLine = (e: Entry) => tr("■ přísný režim: STOP – {0} na řádku {1} (všechny řádky skriptu se provedly)", e.code ?? "msg.error", e.line ?? "-");

/** rozhodnutí přísného režimu nad novými záznamy (true = STOP) */
type StopOn = (fresh: readonly Entry[], line: number | null) => boolean;

/** ověřovací stavba, zápis dokumentu, výsledky přidaných prvků a stav dokumentu (konec smyčky) */
async function finishRun(ctx: OpCtx, featureLine: Map<string, number>, now: () => number, verify: RunVerifier, stopOn: StopOn): Promise<string> {
  const { ws, host, report: rb } = ctx;
  const log = ctx.log!;
  const r = runOf(ctx);
  void featureLine;
  /** skript doběhl (přísný režim nezastavil) – „stav“ na konci se provedl */
  const ranAll = !rb.stopped;
  const beforeFinal = rb.entries.length;
  // dokumenty, ze kterých běh odešel a které se od té doby změnily (prvky bez výsledku), i načtené dokumenty (JSON,
  // --open), které ještě ověřené nejsou – postavit a ohlásit dřív
  const curKey = verifyKey(ctx);
  // závěrečné stavby jsou operace „build“ bez řádku (CLI: hlídač zná operaci, na které vypršel --timeout – ✗ L- run.timeout)
  const hooks = (ctx.opts as EngineRunOptions).hooks ?? {};
  if ((ctx.opts as EngineRunOptions).signal?.aborted) throw new CadCancelled(); // zrušeno před závěrečnou stavbou
  const tFinal = now();
  hooks.opStart?.(null, "build");
  for (const k of verify.pendingKeys()) if (k !== curKey) await verify.verifyDoc(k);
  // Ověřovací stavba PŘED zápisem do dokumentu: zrušený výpočet tak dokument vůbec nezmění. Aplikace pak tentýž dokument
  // staví znovu už z mezipaměti jádra (bez výpočtu).
  const tBuild = now();
  const d = r.doc;
  const res =
    d.kind === "draft"
      ? null
      : await host.kernel.build(d).catch((e) => {
          // 2D výkres se v jádře nestaví
          if (isCancelled(e)) throw e;
          return null;
        });
  hooks.opEnd?.(null, "build", now() - tFinal);
  if (r.changed) {
    try {
      await flush(ctx);
      await ws.settle?.(); // aplikace: další volání API hned za sebou musí vidět tento dokument (vlna 15)
    } catch (e) {
      // výjimka s kódem z hostitele (✗ tab.settle-timeout aplikace) – zápis se nepovedl, nikdy tiše
      if (!(e instanceof CodedError)) throw e;
      log.coded(null, e.code, { doc: r.doc.name, args: e.args });
    }
    host.ui?.afterRun?.();
  }
  if (r.openDrawingAfter) host.ui?.openDrawing?.();
  if (res) {
    // výsledek až po výpočtu: ✓ = platné těleso a operace se projevila, ⚠ = zpracováno s výhradou, ✗ = selhalo; u delších prvků
    // čas výpočtu; prvek bez výsledku stavby = ⚠ feature.unverified (nikdy ✓); prvky jiných dokumentů běhu ohlásil `verify` výš
    // (prvky, které běh nepřidal – načtený JSON / --open, relace – hlásí jen ⚠/✗: na řádku poslední úpravy, jinak načtení)
    verify.report(curKey, d, res.status, { final: true, took: true });
    if (res.metrics?.approx) log.coded(null, "geom.approx", { doc: d.name });
    if (d.kind === "assembly" && asmDepth(d) > MAX_DEPTH) log.coded(null, "asm.depth", { doc: d.name, args: [MAX_DEPTH] });
    if (res.metrics?.volumeFailed) log.coded(null, "geom.volume-failed", { doc: d.name });
    const total = now() - tBuild;
    if (total >= 2000) log.tailLine(tr("Výpočet modelu: {0} s", fmtNum(total / 1000, 1)));
  } else if (verify.pending(curKey).length) {
    const names = verify.pending(curKey).map((x) => x.f.name).join(", ");
    verify.drop(curKey);
    log.tailLine(tr("✗ stavba selhala – prvky {0} nebyly ověřeny", names));
    rb.code("build.failed", { doc: d.name, args: [names] });
  }
  reportStaleSheets(ctx, d, { end: true }); // vydaný list, který změna modelu v běhu zneplatnila – ⚠ drawing.stale (bod 20)
  // přísný režim i po posledním řádku: ✗/⚠ závěrečné stavby (bez řádku = stav na konci skriptu) zastaví – v konzoli
  // prohlížeče stejně jako v CLI (pojistka cli/job.ts se ptá téže funkce)
  if (ranAll) stopOn(rb.entries.slice(beforeFinal), null);
  // stav i u sestavy vytvořené tímto během: díly se postaví (ensureLeaves), stav vazeb a kolize pod klíčem dokumentu
  // restart jádra zjištěný až závěrečným stavem: na řádku „stav“, je-li posledním příkazem, jinak bez řádku (L-)
  const restarted = () => {
    const line = r.lastOp?.k === "status" ? r.lastOp.line : null;
    rb.code("asm.kernel-restarted", { line, doc: d.name });
    const text = codeText("asm.kernel-restarted");
    log.tailLine(`ℹ ${line ? tr("řádek {0}: {1}", line, text) : text}`);
  };
  // obálka sestavy přesně (engine/asm-box.ts) – stejně jako `stav` uprostřed skriptu a řádek D v CLI
  const asm = await asmStatus(ws, host.kernel, d, { key: docKeyOf(ctx), onRestart: restarted, onParts: () => host.ui?.partsLoaded?.() });
  const stale = staleNotes(ws, d, docKeyOf(ctx)); // měření / porovnání z dřívější revize dokumentu (engine/result-key.ts)
  const shown = withValidity(ws, docKeyOf(ctx), d, res); // přesná kontrola téže geometrie (kontrola přesně / export – 22a)
  const status = docStatusText(d, shown, asm, stale);
  log.tailLine("", status);
  // „stav“ jako poslední příkaz: vyžádaný výpis = závěrečný stav (strojová část stejná v cs/en/de, text v `detail`);
  // po STOP přísného režimu se poslední řádek neprovedl – výpis „=“ se nepíše (konzole stav dokumentu ukáže dál)
  if (r.lastOp?.k === "status" && ranAll) rb.measure(r.lastOp.line, "status", statusKv(d, shown, asm, stale), { doc: d.name, detail: status });
  return log.text();
}

/**
 * Změněné vlastnosti dílu do kusovníku mezi dvěma stavy téhož dílu (číslo, třída a označení materiálu, druh) – jen pro
 * ⚠ asm.stale-copy u dílu vloženého tímto během (vlna 22, bod 22g). Jiný dokument (přepnutí záložky) = žádná změna.
 */
function partMetaChange(a: import("../types").CadDoc, b: import("../types").CadDoc): string[] {
  if (a.name !== b.name || a.kind !== b.kind) return [];
  const out: string[] = [];
  if ((a.props?.number ?? "").trim() !== (b.props?.number ?? "").trim()) out.push(tr("číslo"));
  if (a.material !== b.material || (a.materialName ?? "").trim() !== (b.materialName ?? "").trim()) out.push(tr("materiál"));
  if ((a.supply?.kind ?? "") !== (b.supply?.kind ?? "")) out.push(tr("druh"));
  return out;
}

/** otevřená sestava, ve které je kopie dílu `name` (komponenta s otiskem / zdrojem téhož názvu) – ⚠ asm.stale-copy (bod 22g) */
function asmWithCopy(ws: Workspace, name: string): string | undefined {
  const key = name.trim().toLowerCase();
  for (const t of ws.tabs()) {
    if (t.kind !== "assembly") continue;
    const d = ws.docOf?.(t.id);
    if (d?.components?.some((c) => c.source.kind === "part" && (c.origin?.part ?? c.source.doc.name).trim().toLowerCase() === key)) return d.name;
  }
  return undefined;
}
