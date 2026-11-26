/**
 * Výstupy dokumentu v enginu (vlna 22, bod 20 – etapa D2; stejné v prohlížeči, v CLI i v `mncad serve`):
 *  * záznam exportu do dokumentu (`recordOutput`) – `export step…`, `výkres export …`, `skica export dxf` (engine/ops/out.ts);
 *  * ⚠ `drawing.stale` u vydaného listu ze starší revize modelu: při exportu listu (soubor by nesl staré písmeno revize
 *    s jiným obsahem – přísný režim ✗), ve `stav` a na konci běhu, který model změnil (`reportStaleSheets`);
 *  * příkazy `exporty [vymazat]`, `výstupy [zastaralé]`, `přepočítat vše` (`outputsCmd`).
 *
 * `přepočítat vše` přepočítá, co jde bez člověka – kopie dílů v sestavě (D1 `sestava obnovit vše`, list sestavy s kusovníkem
 * pak ukáže obnovené údaje), stav vazeb (`ensureMateStatus`), kontrolu kolizí (`kolize`), pohybovou studii (`pohyb spustit`)
 * a všechny listy dokumentu (výpočet listu s Chytrými kótami) – a vypíše, co musí udělat člověk: vydaný list ze starší revize
 * (`výkres vydat B` – vydání je rozhodnutí člověka), exporty ze starší revize (soubory se samy nepřepisují), měření a porovnání
 * (výsledek bez původního zadání zopakovat nejde).
 */
import type { OutputsCmd } from "../agent-outputs";
import { staleCopies, staleCopyText } from "../asm-refresh";
import { exportsText, modelId, recordExport, sameModel, type ModelId, sheetIssueLine, staleExportText, staleExports, staleOutputs, staleOutputsText, staleSheets, staleSheetText, type ExportInput, type StaleItem } from "../doc-outputs";
import { tr } from "../i18n";
import type { CadDoc } from "../types";
import { drawExtras, ensureMateStatus } from "./asm-status";
import { asmHooks, coded, sayKv, type OpCtx } from "./ops/util";
import { runEngineOp } from "./ops/registry";
import { staleResults } from "./result-key";
import { docKeyOf, runOf } from "./run-doc";
import { drawingMemo, sheetWarningCode } from "./sheet-eval";

/* ───────────────────────── záznamy exportů ───────────────────────── */

/** záznam exportu do pracovního dokumentu běhu (uloží se s dokumentem: revize modelu, čas, soubor) */
export function recordOutput(ctx: OpCtx, e: ExportInput): void {
  const r = runOf(ctx);
  if (r.doc.kind === "draft") return; // 2D výkres nemá revizi modelu 3D
  r.doc = recordExport(r.doc, e).doc;
  r.changed = true;
}

/**
 * Export listů `sheetIds`: vydaný list ze starší revize modelu → ⚠ drawing.stale (přísný režim ✗ – `escalates`): soubor
 * by nesl staré písmeno revize s jiným obsahem.
 */
export function warnStaleExport(ctx: OpCtx, doc: CadDoc, sheetIds: readonly string[]): void {
  const id = modelId(doc);
  for (const sid of sheetIds) {
    const s = doc.drawings?.find((x) => x.id === sid);
    if (!s?.issued || sameModel(s.issued, id)) continue;
    coded(ctx, "drawing.stale", { args: [staleExportText(s.name, s.issued, id)], data: staleData(s.id, id), ...(ctx.strict?.escalates("drawing.stale", ctx.line) ? { level: "error" as const } : {}) });
  }
}

/** strojová data ⚠ drawing.stale: id listu a otisk modelu, pro který hláška platí (jedna hláška za list a revizi v běhu) */
export const staleData = (sheet: string, id: ModelId): { sheet: string; sig: string; rev: string } => ({ sheet, sig: `${id.sig}|${id.data}`, rev: id.rev });
const reported = (ctx: OpCtx, sheet: string, id: ModelId) => ctx.report.entries.some((e) => e.code === "drawing.stale" && (e.data as { sheet?: string; sig?: string } | undefined)?.sheet === sheet && (e.data as { sig?: string }).sig === `${id.sig}|${id.data}`);

/** otisk modelu dokumentu na konci minulého běhu nad týmž prostorem (`ws.asm` – stejný objekt i za obalem prostoru) */
const lastSig = new WeakMap<object, Map<string, string>>();

/**
 * Vydané listy dokumentu ze starší revize modelu → ⚠ drawing.stale (jednou za běh pro tentýž list a revizi modelu). `end` =
 * konec běhu (záznam bez řádku) – jen když se model dokumentu od konce minulého běhu změnil (změna v běhu, úprava myší mezi
 * běhy, nový / načtený dokument); běh, který dokument jen exportoval, ho znovu nehlásí.
 */
export function reportStaleSheets(ctx: OpCtx, doc: CadDoc, o: { end?: boolean } = {}): void {
  if (doc.kind === "draft") return;
  const id = modelId(doc);
  if (o.end) {
    let m = lastSig.get(ctx.ws.asm);
    if (!m) lastSig.set(ctx.ws.asm, (m = new Map()));
    const key = docKeyOf(ctx);
    const prev = m.get(key);
    // otisk geometrie i údajů (číslo, materiál…): změna jen údajů vydaný list také zneplatní (bod 20, kolo 3)
    const now = `${id.sig}|${id.data}`;
    m.set(key, now);
    if (prev === now) return;
  }
  if (!doc.drawings?.some((s) => s.issued)) return;
  for (const x of staleSheets(doc, id)) {
    if (reported(ctx, x.sheet.id, id)) continue;
    const arg = staleSheetText(x.sheet.name, x.issued, id);
    const data = staleData(x.sheet.id, id);
    if (!o.end) coded(ctx, "drawing.stale", { args: [arg], data });
    else if (ctx.log) ctx.log.coded(null, "drawing.stale", { doc: doc.name, args: [arg], data });
    else ctx.report.code("drawing.stale", { line: null, doc: doc.name, args: [arg], data });
  }
}

/* ───────────────────────── zastaralé výstupy ───────────────────────── */

/** položky seznamu zastaralých výstupů pracovního dokumentu: listy, exporty, analýzy (A1), kopie dílů (D1) */
export function staleItems(ctx: OpCtx, d: CadDoc): StaleItem[] {
  const analyses = d.kind === "draft" ? [] : staleResults(ctx.ws, docKeyOf(ctx), d);
  const copies =
    d.kind === "assembly"
      ? staleCopies(d, (n) => ctx.ws.findPart(n)).map((s) => ({ name: s.comp.alias ?? s.comp.name, why: staleCopyText(s), fix: `sestava obnovit ${s.comp.alias ? `"${s.comp.alias}"` : `#${s.index + 1}`}` }))
      : [];
  return staleOutputs(d, { analyses, copies });
}

const kvOf = (d: CadDoc, items: readonly StaleItem[]): string => {
  const n = (k: StaleItem["kind"]) => items.filter((x) => x.kind === k).length;
  return `stale=${items.length} rev=${modelId(d).rev} drawing=${n("sheet")} export=${n("export")} analysis=${n("analysis")} copy=${n("copy")}`;
};

/** přehled výstupů: vydání každého listu, záznamy exportů, zastaralé položky */
function overviewText(d: CadDoc, items: readonly StaleItem[]): string {
  const id = modelId(d);
  const L: string[] = [tr("Výstupy dokumentu „{0}“ · revize modelu {1}", d.name, id.rev)];
  const sheets = d.kind === "draft" ? [] : (d.drawings ?? []);
  L.push(sheets.length ? tr("Listy ({0}):", sheets.length) : tr("Listy: žádné"));
  for (const s of sheets) L.push(`  ${s.name}: ${sheetIssueLine(d, s, id)}`);
  L.push(exportsText(d, id));
  L.push(staleOutputsText(d, items));
  return L.join("\n");
}

/** podpříkaz (oprava zastaralé položky) jako operace enginu na řádku `přepočítat vše` */
async function runFix(ctx: OpCtx, text: string): Promise<boolean> {
  const { parseAgentText } = await import("../agent");
  const prog = parseAgentText(text);
  if (prog.errors.length || !prog.ops.length) return false;
  const line = ctx.line;
  const kind = ctx.kind;
  try {
    for (const op of prog.ops) await runEngineOp({ ...op, line } as typeof op, ctx);
  } finally {
    ctx.line = line;
    ctx.kind = kind;
  }
  return true;
}

/**
 * `přepočítat vše`: kopie dílů v sestavě, stav vazeb, kolize, pohyb, listy; pak seznam toho, co musí udělat člověk.
 * Výpis: co se přepočítalo, co zbývá (s příkazy) a strojová část `recomputed=N left=N stale=…`.
 */
async function recomputeAll(ctx: OpCtx): Promise<void> {
  const r = runOf(ctx);
  const done: string[] = [];
  const warned: string[] = [];
  const manual: string[] = [];
  const first = staleItems(ctx, r.doc);
  // 1) kopie dílů v sestavě – D1 (jedna funkce obnovy: `sestava obnovit vše`, přečíslování ploch vazeb a přepočet vazeb)
  if (first.some((x) => x.kind === "copy") && (await runFix(ctx, "sestava obnovit vše"))) done.push(tr("kopie dílů v sestavě obnoveny z dílů (sestava obnovit vše)"));
  // 2) uložené analýzy: stav vazeb, kolize, pohyb (měření a porovnání zopakovat nejde – chybí původní zadání) – až po obnově
  //    kopií: obnovená geometrie zneplatní i kontrolu kolizí, která předtím platila
  const kinds = new Set(staleItems(ctx, r.doc).filter((x) => x.kind === "analysis").map((x) => x.fix));
  if (r.doc.kind === "assembly" && kinds.has("sestava vazby")) {
    await ensureMateStatus(ctx.ws, ctx.host.kernel, r.doc, docKeyOf(ctx), asmHooks(ctx));
    done.push(tr("stav vazeb přepočítán"));
  }
  if (r.doc.kind === "assembly" && kinds.has("kolize") && (await runFix(ctx, "kolize"))) done.push(tr("kontrola kolizí znovu (kolize)"));
  if (r.doc.kind === "assembly" && kinds.has("pohyb spustit") && (await runFix(ctx, "pohyb spustit"))) done.push(tr("pohybová studie znovu (pohyb spustit)"));
  // 3) listy dokumentu: výpočet každého listu z nynějšího modelu (Chytré kóty se doplní, varování listů do výpisu)
  const d = r.doc;
  const sheets = d.kind === "draft" ? [] : (d.drawings ?? []);
  if (sheets.length) {
    const { renderSheet } = await import("../drawing-export");
    const compute = drawingMemo(ctx.host.kernel);
    const extras = await drawExtras(ctx.ws, ctx.host.kernel, d, { ...asmHooks(ctx), flat: ctx.host.ui?.bomFlat?.() ?? true });
    const id = modelId(d);
    for (let i = 0; i < sheets.length; i++) {
      const s = await renderSheet(d, i, compute, extras);
      const t = tr("list „{0}“ přepočten z modelu {1}{2}", s.name, id.rev, s.warnings.length ? tr(" – varování: {0}", s.warnings.join("; ")) : "");
      // list s varováním (ruční kóta bez geometrie, neúplné kóty …) není „✓ přepočten“ bez výhrad (vlna 22, bod 20 – kolo 3)
      if (s.warnings.length) warned.push(t);
      else done.push(t);
      // ruční kóty, které po přepočtu neodpovídají geometrii, musí opravit člověk (přepočet je nepřesune)
      for (const w of s.warnings) if (sheetWarningCode(w) === "drawing.dim-detached") manual.push(`  ⚠ ${tr("list „{0}“", s.name)} – ${w}`);
    }
  }
  // 4) co zbývá: vydané listy ze starší revize, exporty, měření / porovnání
  const left = staleItems(ctx, r.doc);
  const L: string[] = [tr("Přepočítat vše – dokument „{0}“, revize modelu {1}:", r.doc.name, modelId(r.doc).rev)];
  L.push(done.length + warned.length ? tr("Přepočteno ({0}):", done.length + warned.length) : tr("Přepočteno: nic – nebylo co přepočítat"));
  for (const x of done) L.push(`  ✓ ${x}`);
  for (const x of warned) L.push(`  ⚠ ${x}`);
  if (left.length || manual.length) {
    L.push(tr("Zbývá udělat ručně ({0}) – program to sám neudělá:", left.length + manual.length));
    for (const x of left) L.push(`  ⚠ ${x.label} – ${x.why} → ${x.fix}`);
    L.push(...manual);
  } else L.push(tr("Zbývá: nic – vydané listy, exporty a uložené analýzy odpovídají modelu {0}", modelId(r.doc).rev));
  sayKv(ctx, `recomputed=${done.length + warned.length} left=${left.length + manual.length} ${kvOf(r.doc, left)}`, L.join("\n"));
  // vydané listy ze starší revize zůstávají zastaralé, dokud člověk nevydá novou revizi – ⚠ (jednou za běh)
  reportStaleSheets(ctx, r.doc);
}

/** `exporty [vymazat]` · `výstupy [zastaralé]` · `přepočítat vše` */
export async function outputsCmd(ctx: OpCtx, cmd: OutputsCmd): Promise<void> {
  const r = runOf(ctx);
  const d = r.doc;
  if (cmd.kind === "exports") {
    const n = d.outputs?.length ?? 0;
    if (cmd.clear) {
      if (n) {
        const { outputs: _gone, ...rest } = d;
        void _gone;
        r.doc = rest as CadDoc;
        r.changed = true;
      }
      sayKv(ctx, `exports=0 cleared=${n}`, tr("✓ záznamy exportů vymazány ({0}) – soubory na disku zůstaly", n));
      return;
    }
    const id = modelId(d);
    sayKv(ctx, `exports=${n} stale=${staleExports(d, id).length} rev=${id.rev}`, exportsText(d, id));
    return;
  }
  if (cmd.kind === "recompute") return recomputeAll(ctx);
  const items = staleItems(ctx, d);
  sayKv(ctx, kvOf(d, items), cmd.stale ? staleOutputsText(d, items) : overviewText(d, items));
}
