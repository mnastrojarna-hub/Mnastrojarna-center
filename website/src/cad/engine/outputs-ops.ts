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
import { docSupply } from "../bom-model";
import { sourceKey } from "../assembly";
import { exportsText, modelId, recordExport, sameModel, type ModelId, sheetIssueLine, staleExportText, staleExports, staleOutputs, staleOutputsText, staleSheets, staleSheetText, type ExportInput, type StaleItem } from "../doc-outputs";
import { tr } from "../i18n";
import { MATE_LABEL, mateLost } from "../mates";
import type { CadDoc } from "../types";
import { drawExtras, ensureMateStatus } from "./asm-status";
import { asmHooks, coded, sayKv, type OpCtx } from "./ops/util";
import { runEngineOp } from "./ops/registry";
import { clashState, mateStatusState, staleResults } from "./result-key";
import { motionStateOf, motionStoreOf } from "../motion-cache";
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
  // pohybová studie: co se od výpočtu změnilo (stejný text jako ⚠ motion.stale u `pohyb stav`)
  const mo = analyses.includes("motion") ? motionStateOf(motionStoreOf(ctx.ws.asm), docKeyOf(ctx), d) : null;
  const why = mo?.state === "stale" ? { motion: tr("výsledek neplatí – od výpočtu se změnilo: {0}", mo.changed.join("; ")) } : undefined;
  return staleOutputs(d, { analyses, copies, why });
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

/** výsledek podpříkazu `přepočítat vše`: proběhl? a záznamy ⚠ / ✗, které při něm vznikly (kódy) */
type FixRun = { ran: boolean; problems: string[] };

/** podpříkaz (oprava zastaralé položky) jako operace enginu na řádku `přepočítat vše` */
async function runFix(ctx: OpCtx, text: string): Promise<FixRun> {
  const { parseAgentText } = await import("../agent");
  const prog = parseAgentText(text);
  if (prog.errors.length || !prog.ops.length) return { ran: false, problems: [] };
  const line = ctx.line;
  const kind = ctx.kind;
  const from = ctx.report.entries.length;
  let ran = true;
  try {
    for (const op of prog.ops) await runEngineOp({ ...op, line } as typeof op, ctx);
  } catch (e) {
    // podpříkaz selhal = nepřepočteno (dřív by výjimka shodila celý řádek bez rozlišení, co se stihlo)
    ran = false;
    coded(ctx, "op.failed", { args: [`${text}: ${e instanceof Error ? e.message : String(e)}`] });
  } finally {
    ctx.line = line;
    ctx.kind = kind;
  }
  // ⚠ a ✗, které podpříkaz zapsal (kolize, neplatné kroky studie, motor na mezi …) – výsledek pak není „✓ přepočteno“
  const problems = ctx.report.entries.slice(from).filter((e) => e.level === "warn" || e.level === "error").map((e) => e.code ?? e.level);
  return { ran, problems: [...new Set(problems)] };
}

/**
 * Řádek výsledku podpříkazu `přepočítat vše` (vlna 22, bod 20 – kolo 7): ✓ jen když podpříkaz proběhl, nezapsal ⚠ ani ✗
 * a uložený výsledek platí pro nynější stav (`state` = „ok“). Nalezená kolize, neplatné kroky studie nebo nedoběhlý výpočet
 * jsou ⚠ s důvodem – dřív „✓ kontrola kolizí znovu“ i s nalezenou kolizí (⚠ clash.real jen zvlášť nad výpisem).
 */
function fixLine(label: string, f: FixRun, state: "ok" | "found" | "stale" | "unchecked", found: string): { ok: boolean; text: string } {
  if (!f.ran || state === "unchecked" || state === "stale") return { ok: false, text: tr("{0} – nedoběhlo, výsledek nezkontrolován", label) };
  if (state === "found") return { ok: false, text: tr("{0} – {1}", label, found) };
  if (f.problems.length) return { ok: false, text: tr("{0} – s varováním: {1}", label, f.problems.join(", ")) };
  return { ok: true, text: label };
}

/** vazby sestavy, které po přepočtu musí opravit člověk: ztracená reference (vybrat plochu znovu), rozpor, chybějící plocha */
function mateTodo(ctx: OpCtx, doc: CadDoc): string[] {
  const st = mateStatusState(ctx.ws, docKeyOf(ctx), doc).status;
  const out: string[] = [];
  (doc.mates ?? []).forEach((m, i) => {
    if (m.suppressed) return;
    const name = `${i + 1} ${m.name ?? tr(MATE_LABEL[m.type])}`;
    if (mateLost(m)) out.push(`  ⚠ ${tr("vazba {0} – ztracená reference po úpravě dílu", name)} → ${tr("sestava vazba {0} plocha … / sestava vazba {0} smazat", i + 1)}`);
    else if (st?.[m.id] === "conflict" || st?.[m.id] === "missing") out.push(`  ⚠ ${tr("vazba {0} – nesplněna ({1})", name, st[m.id])} → sestava vazby`);
  });
  return out;
}

/**
 * `přepočítat vše`: kopie dílů v sestavě, stav vazeb, kolize, pohyb, listy; pak seznam toho, co musí udělat člověk.
 * Výpis: co se přepočítalo (✓ jen s platným výsledkem bez nálezu, jinak ⚠ s důvodem), co zbývá (s příkazy) a strojová část
 * `recomputed=N left=N stale=… warned=N`.
 */
async function recomputeAll(ctx: OpCtx): Promise<void> {
  const r = runOf(ctx);
  const done: string[] = [];
  const warned: string[] = [];
  const manual: string[] = [];
  const first = staleItems(ctx, r.doc);
  // 1) kopie dílů v sestavě – D1 (jedna funkce obnovy: `sestava obnovit vše`, přečíslování ploch vazeb a přepočet vazeb)
  if (first.some((x) => x.kind === "copy")) {
    const f = await runFix(ctx, "sestava obnovit vše");
    const left = staleItems(ctx, r.doc).filter((x) => x.kind === "copy").length;
    const x = fixLine(tr("kopie dílů v sestavě obnoveny z dílů (sestava obnovit vše)"), f, left ? "found" : "ok", tr("{0} kopií zůstává starších než díl", left));
    (x.ok ? done : warned).push(x.text);
  }
  // 2) uložené analýzy: stav vazeb, kolize, pohyb (měření a porovnání zopakovat nejde – chybí původní zadání) – až po obnově
  //    kopií: obnovená geometrie zneplatní i kontrolu kolizí, která předtím platila
  const kinds = new Set(staleItems(ctx, r.doc).filter((x) => x.kind === "analysis").map((x) => x.fix));
  if (r.doc.kind === "assembly" && kinds.has("sestava vazby")) {
    const st = await ensureMateStatus(ctx.ws, ctx.host.kernel, r.doc, docKeyOf(ctx), asmHooks(ctx));
    const { state } = mateStatusState(ctx.ws, docKeyOf(ctx), r.doc);
    // vazba v rozporu / ztracená / bez plochy = stav přepočten, ale vazby NEJSOU splněny (nikdy „✓“ bez výhrady)
    const bad = (r.doc.mates ?? []).filter((m) => !m.suppressed && st?.[m.id] !== undefined && st[m.id] !== "ok" && st[m.id] !== "suppressed").length;
    const x = fixLine(tr("stav vazeb přepočítán"), { ran: !!st, problems: [] }, !st ? "unchecked" : bad ? "found" : state === "ok" ? "ok" : "stale", tr("nesplněno vazeb: {0} (sestava vazby)", bad));
    (x.ok ? done : warned).push(x.text);
  }
  if (r.doc.kind === "assembly" && kinds.has("kolize")) {
    const f = await runFix(ctx, "kolize");
    const st = clashState(ctx.ws, docKeyOf(ctx), r.doc);
    const n = ctx.ws.asm.clash.get(docKeyOf(ctx))?.res.length ?? 0;
    const x = fixLine(tr("kontrola kolizí znovu (kolize)"), f, st === "clash" ? "found" : st, tr("nalezeno kolizí: {0} – viz ⚠ výše", n));
    (x.ok ? done : warned).push(x.text);
  }
  if (r.doc.kind === "assembly" && kinds.has("pohyb spustit")) {
    const f = await runFix(ctx, "pohyb spustit");
    // studie, jejíž uložený výsledek pro nynější stav dál neplatí (sonda balíku M), nedoběhla
    const still = staleResults(ctx.ws, docKeyOf(ctx), r.doc).includes("motion");
    const x = fixLine(tr("pohybová studie znovu (pohyb spustit)"), f, still ? "stale" : "ok", "");
    (x.ok ? done : warned).push(x.text);
  }
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
  // 4) co zbývá: vydané listy ze starší revize, exporty, měření / porovnání; vazby se ztracenou referencí / v rozporu
  //    (kolo 7: dřív „Zbývá: nic – … odpovídají modelu“ i s vazbou, kterou obnova kopie ztratila)
  const left = staleItems(ctx, r.doc);
  if (r.doc.kind === "assembly") manual.push(...mateTodo(ctx, r.doc));
  const L: string[] = [tr("Přepočítat vše – dokument „{0}“, revize modelu {1}:", r.doc.name, modelId(r.doc).rev)];
  L.push(done.length + warned.length ? tr("Přepočteno ({0}):", done.length + warned.length) : tr("Přepočteno: nic – nebylo co přepočítat"));
  for (const x of done) L.push(`  ✓ ${x}`);
  for (const x of warned) L.push(`  ⚠ ${x}`);
  if (left.length || manual.length) {
    L.push(tr("Zbývá udělat ručně ({0}) – program to sám neudělá:", left.length + manual.length));
    for (const x of left) L.push(`  ⚠ ${x.label} – ${x.why} → ${x.fix}`);
    L.push(...manual);
  } else L.push(tr("Zbývá: nic – vydané listy, exporty a uložené analýzy odpovídají modelu {0}", modelId(r.doc).rev));
  // `warned=` (kolo 7, pole na konci řádku): přepočtené položky s výhradou (kolize nalezena, vazby nesplněny, nedoběhlo)
  sayKv(ctx, `recomputed=${done.length + warned.length} left=${left.length + manual.length} ${kvOf(r.doc, left)} warned=${warned.length}`, L.join("\n"));
  // vydané listy ze starší revize zůstávají zastaralé, dokud člověk nevydá novou revizi – ⚠ (jednou za běh)
  reportStaleSheets(ctx, r.doc);
}

/**
 * `výkresy dílů [A4|A3|A2|A1|A0]` v sestavě (vlna 22, bod 19 – kolo 7; GUI Kusovník → „Výrobní dokumentace“): každému
 * vyráběnému dílu (druh z kusovníku – normálie a nakupované díly výkres nedostanou), který je otevřený v záložce a výkres
 * nemá, se založí list výkresu (Chytré kóty) stejnými příkazy jako ručně: `záložka "díl"` + `výkres <formát>`; pak se vrátí
 * do sestavy. Díl, který výkres už má, se nemění; díl, který v záložce není (jen kopie v sestavě, import), se jen vypíše
 * – výkres mu založit nejde (✓ by lhalo). Založený list se vyhodnotí jako každý jiný list (⚠ / ✗ listu na řádku příkazu).
 * Kopie dílů v sestavě se sama NEobnoví – výkres do výstupů sestavy přibude po `sestava obnovit vše` (rada ve výpisu).
 */
async function partDrawings(ctx: OpCtx, format: string): Promise<void> {
  const r = runOf(ctx);
  const asm = r.doc;
  if (asm.kind !== "assembly") throw new Error(tr("výkresy dílů: jen v sestavě – výkres dílu: výkres {0} v jeho záložce", format));
  const asmName = asm.name;
  // podpříkazy `výkres A4` by na konci běhu otevřely výkresové prostředí (v prohlížeči i přepnutím záložky) – příkaz zakládá
  // listy jiných dokumentů, sestava zůstává aktivní a výkres se neotevírá
  const openBefore = r.openDrawingAfter;
  const s = docSupply(asm, (c) => sourceKey(c.source));
  const created: string[] = [];
  const had: string[] = [];
  const missing: string[] = [];
  const failed: string[] = [];
  for (const m of s.make) {
    const part = ctx.ws.findPart(m.name);
    if (!part || m.name.includes('"')) {
      missing.push(m.name);
      continue;
    }
    if (part.drawings?.length) {
      had.push(tr("{0} ({1} listů)", m.name, part.drawings.length));
      continue;
    }
    const f = await runFix(ctx, `záložka "${m.name}"\nvýkres ${format}`);
    // nový list se vyhodnotí hned v záložce dílu (blok příkazů výkresu běhu ho nevidí – příkazy běžely uvnitř tohoto řádku):
    // ✓ jen list bez nálezu, jinak ⚠ drawing.warning s textem listu; nálezy podpříkazu se nepřenesou do dalšího bloku
    const pd = runOf(ctx);
    pd.drawIssues?.splice(0);
    const warns: string[] = [];
    if (f.ran && pd.doc.name === m.name && pd.doc.drawings?.length) {
      const { renderSheet } = await import("../drawing-export");
      const extras = await drawExtras(ctx.ws, ctx.host.kernel, pd.doc, { ...asmHooks(ctx), flat: ctx.host.ui?.bomFlat?.() ?? true });
      const sh = await renderSheet(pd.doc, pd.doc.drawings.length - 1, drawingMemo(ctx.host.kernel), extras);
      for (const w of sh.warnings) {
        warns.push(w);
        coded(ctx, "drawing.warning", { args: [tr("„{0}“ dílu „{1}“", sh.name, m.name), w] });
      }
    }
    // zpět do sestavy i po chybě (další příkazy skriptu pracují se sestavou jako před příkazem)
    await runFix(ctx, `záložka "${asmName}"`);
    const now = ctx.ws.findPart(m.name);
    const sheet = now?.drawings?.[now.drawings.length - 1]?.name ?? "";
    if (f.ran && now?.drawings?.length) {
      const probs = [...f.problems, ...(warns.length ? ["drawing.warning"] : [])];
      created.push(probs.length ? tr("{0} – list „{1}“ s varováním: {2}", m.name, sheet, [...new Set(probs)].join(", ")) : tr("{0} – list „{1}“ vyhodnocen bez nálezů", m.name, sheet));
    } else failed.push(m.name);
  }
  runOf(ctx).openDrawingAfter = openBefore;
  const L: string[] = [tr("Výkresy dílů sestavy „{0}“ – vyráběných dílů {1} (normálie {2} a nakupované {3} výkres nedostanou):", asmName, s.make.length, s.standard, s.buy)];
  if (created.length) L.push(tr("Založeno ({0}, {1}, Chytré kóty):", created.length, format), ...created.map((x) => `  → ${x}`));
  if (had.length) L.push(tr("Výkres už mají ({0}) – beze změny:", had.length), ...had.map((x) => `  · ${x}`));
  if (missing.length) L.push(tr("Nezaloženo – díl není otevřený v záložce ({0}); otevřete díl a zadejte výkres {1}:", missing.length, format), ...missing.map((x) => `  ⚠ ${x}`));
  if (failed.length) L.push(tr("Nezaloženo – list se nevytvořil ({0}):", failed.length), ...failed.map((x) => `  ⚠ ${x}`));
  if (!s.make.length) L.push(tr("Sestava nemá vyráběné díly – není co založit"));
  if (created.length) L.push(tr("Kopie dílů v sestavě se samy neobnoví: výkresy přibudou do výstupů sestavy po sestava obnovit vše"));
  sayKv(ctx, `make=${s.make.length} created=${created.length} existing=${had.length} missing=${missing.length + failed.length}`, L.join("\n"));
  // co zůstalo bez výkresu = ⚠ (nikdy jen tichý výpis) – týž kód jako kusovník a export sestavy
  const left = [...missing, ...failed];
  if (left.length) coded(ctx, "bom.make-incomplete", { args: [left.map((x) => tr("{0} (bez výkresu)", x)).join(", ")] });
}

/** `exporty [vymazat]` · `výstupy [zastaralé]` · `přepočítat vše` · `výkresy dílů` */
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
  if (cmd.kind === "partDrawings") return partDrawings(ctx, cmd.format ?? "A4");
  const items = staleItems(ctx, d);
  sayKv(ctx, kvOf(d, items), cmd.stale ? staleOutputsText(d, items) : overviewText(d, items));
}
