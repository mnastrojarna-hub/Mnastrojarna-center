/**
 * Příkazy výkresu (volby listu, Chytré kóty, tolerance, razítko, listy, stav, export): výkres se počítá v jádře hostitele,
 * doplňky razítka (hmotnost, kusovník, pozice) z postavených dílů (`drawExtras`), soubor exportu jde do `host.files`.
 *
 * Nálezy příkazu (řádky „! …“ a hlášení výkresu `res.issues` – cad/drawing-issues.ts, 5.2 č. 32–33) mají kód podle druhu
 * (nezávisle na jazyce); řádky ✗ / ⚠, které k nim příkaz připsal, nahradí v konzoli řádek s kódem:
 * * `výkres stav` / `výkres export` = pozorování hotového stavu listu → hned na řádku (řez mimo těleso ✗);
 * * výpočet listu po ostatních příkazech (`computed`: řez mimo těleso, pohledy se nevejdou, tabulka děr přes pohled …)
 *   a mezistavy bloku (překryv / přesah rámečku nové nebo upravené poznámky, vynechané Chytré kóty) rozhodne konec bloku
 *   příkazů výkresu nebo běhu (engine/drawing-track.ts) – další `výkres …` je může opravit (kap. 5.3);
 * * starší zápis odsazení řezu (vlna 15, B5) = automatický výklad vstupu → hned ⚠ `drawing.section-legacy`, v přísném
 *   režimu ✗ (výjimka `přísně kromě drawing.section-legacy` zůstane ⚠); kontrola tolerancí → ⚠ `drawing.tolerance-missing` za každý rozměr; ostatní nálezy příkazu (razítko,
 *   funkční rozměr bez kóty, přeurčený řetěz) → ⚠ `drawing.warning`.
 */
import type { DrawingCompute } from "../../drawing-agent";
import { deferredIssue, issueLine } from "../../drawing-issues";
import { b64ToBytes } from "../../blobs";
import { drawExtras } from "../asm-status";
import { runOf } from "../run-doc";
import { drawingKv } from "../kv";
import { drawingMemo, sheetIssue, sheetIssueText, sheetLabel } from "../sheet-eval";
import { asmHooks, coded, sayKv, type OpHandler } from "./util";
import { reportStaleCopies } from "../bom-notes";
import { modelId } from "../../doc-outputs";
import { staleData } from "../outputs-ops";

export const drawingCmdOp: OpHandler<"drawingCmd"> = async (op, ctx) => {
  const r = runOf(ctx);
  const { applyDrawingCmd, activeSheetIndex } = await import("../../drawing-agent");
  const kernel = ctx.host.kernel;
  const extras = await drawExtras(ctx.ws, kernel, r.doc, { ...asmHooks(ctx), flat: ctx.host.ui?.bomFlat?.() ?? true });
  const compute: DrawingCompute = drawingMemo(kernel); // tentýž list se v bloku příkazů / při vyhodnocení bloku nepočítá znovu
  const res = await applyDrawingCmd(r.doc, op.cmd, compute, { extras: () => extras, tabs: () => ctx.ws.listDocs() });
  r.doc = res.doc;
  r.changed = r.changed || res.changed;
  r.openDrawingAfter = r.openDrawingAfter || res.open;
  // list sestavy s kusovníkem: kopie dílu starší než díl v záložce = ⚠ s příkazem obnovy (bod 22g, jednou za běh)
  if (r.doc.kind === "assembly") reportStaleCopies(ctx, r.doc);
  const issues = res.issues ?? [];
  // řádky hlášení (✗ / ⚠ výpočtu listu, ⚠ kontroly tolerancí po rozměrech) – v konzoli je nahradí řádek s kódem níže / na konci bloku
  const issueLines = new Set(issues.map(issueLine));
  sayKv(ctx, drawingKv(r.doc, activeSheetIndex(r.doc)), ...res.log.filter((l) => !l.startsWith("! ") && !issueLines.has(l.trimStart())));
  const observe = op.cmd.k === "status" || op.cmd.k === "export";
  for (const x of issues) {
    if (deferredIssue(x)) {
      (r.drawIssues ??= []).push({ line: ctx.line, issue: x });
      continue;
    }
    if (x.computed && !observe) continue; // výpočet listu po příkazu: vyhodnocení listu na konci bloku / běhu
    if (x.kind === "section-legacy") {
      coded(ctx, "drawing.section-legacy", { text: x.text, ...(x.data ? { data: x.data } : {}), ...(ctx.strict?.escalates("drawing.section-legacy", ctx.line) ? { level: "error" as const } : {}) });
      continue;
    }
    if (x.kind === "stale") {
      // vydaný list ze starší revize modelu (vlna 22, bod 20): ⚠; nové vydání se stejným písmenem po změně v přísném režimu ✗
      coded(ctx, "drawing.stale", { args: [x.text], data: staleData(x.sheetId ?? "", modelId(r.doc)), ...(op.cmd.k === "issue" && ctx.strict?.escalates("drawing.stale", ctx.line) ? { level: "error" as const } : {}) });
      continue;
    }
    if (x.kind === "tolerance-missing") {
      coded(ctx, "drawing.tolerance-missing", { text: x.text, ...(x.data ? { data: x.data } : {}) });
      continue;
    }
    const idx = x.sheetId ? (r.doc.drawings?.findIndex((s) => s.id === x.sheetId) ?? -1) : activeSheetIndex(r.doc);
    const si = sheetIssue(x, (x.data?.sheetName as string | undefined) || sheetLabel(r.doc, Math.max(0, idx)));
    coded(ctx, si.code, { text: sheetIssueText(si), ...(si.level ? { level: si.level } : {}), ...(si.data ? { data: si.data } : {}) }); // řez mimo těleso = ✗ (B5)
  }
  if (res.file) await ctx.host.files.write({ name: res.file.name, mime: res.file.mime, data: b64ToBytes(res.file.base64), doc: r.doc.name, format: res.file.name.split(".").pop()?.toLowerCase() ?? "bin" }); // výkres export …
};
