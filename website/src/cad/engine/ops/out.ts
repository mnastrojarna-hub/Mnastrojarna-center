/**
 * Výstupy textového skriptu (balík B3; dřív jen v aplikaci – agent-out-host.ts): `uložit`, `export`, `výkres export`,
 * `skica export dxf`, `sdílet`, `odkaz` – stejně v prohlížeči, v CLI i v `mncad serve`. Soubor jde vždy hostiteli
 * (`host.files`, FileSink: prohlížeč = stažení bez dialogu, CLI = `--out`, serve = paměť relace); STEP / BREP se po zápisu
 * znovu načte jádrem a porovná s modelem (řádek F `check=ok|fail`, ⚠/✗ `out.check-failed`); odkaz = řádek O
 * s `mode=self|store|link` podle skutečného výsledku (engine/share-out.ts). `… base64` = soubor se nezapíše, jeho obsah
 * jde do protokolu (konzole `BASE64 "<soubor>" <bajty>B <data>`, záznam `= … file` s daty v `detail`); `… odkaz` = soubor
 * zašifrovaný v úložišti odkazů, protokol vypíše odkaz na stránku ke stažení (`= … file … url=`, share-file.ts).
 *
 * Konzole prohlížeče dostane tytéž řádky jako dřív (w11, e2e cad-agent-out); stručný protokol záznamy s kódem.
 */
import { fileLogLine, fmtBytes, formatLabel, FORMAT_EXT, outFileName, type ExportCheck, type OutCmd, type OutDelivery } from "../../agent-out";
import { cadLocale, tr } from "../../i18n";
import { groupShareCode, SHARE_DEFAULT_DAYS } from "../../share";
import type { CadDoc } from "../../types";
import { drawExtras } from "../asm-status";
import type { Code, CodeEntryInit } from "../codes";
import { assertDrawable, bytesToBase64, drawingOutput, hasDrawings, isEmptyDoc, OUT_BASE64_MAX, OUT_MIME, plainName, projectFile, sheetScope, sketchDxf, type DrawEnv } from "../files";
import { sha256Hex } from "../host";
import { quote } from "../protocol";
import type { OutFile } from "../protocol-types";
import { docKeyOf, runOf } from "../run-doc";
import { exactBeforeExport } from "../validity-store";
import { isVolumeFormat, solidVerdict } from "../../solid-export";
import { modelSolids } from "../solid-check";
import { lastShareLink, rememberLink, shareInfo, shareWithPolicy, type LastLink } from "../share-out";
import { asmHooks, coded, type OpCtx, type OpHandler } from "./util";
import { runExportJob } from "../export-job";
import { outputsCmd, recordOutput, warnStaleExport } from "../outputs-ops";
import { shareContent, shareContentText, shareLinkKv, verifyKv, type ShareContent } from "../share-content";
import { modelId, sameModel } from "../../doc-outputs";
import { issueArgs, sameSheetFinding, sheetIssueText, sheetLabel, sheetWarningCode } from "../sheet-eval";

/* ───────────────────────── zápis do konzole a reportu ───────────────────────── */

type Emit = {
  /** řádky konzole prohlížeče beze změny (do reportu nic) */
  console(...lines: string[]): void;
  /** ✓ do reportu (počítá se) */
  ok(text: string): void;
  /** hláška s kódem do reportu a její řádek do konzole (`indent` + symbol + text) */
  code(code: Code, o?: CodeEntryInit & { indent?: string }): void;
};

function emitter(ctx: OpCtx): Emit {
  const doc = runOf(ctx).doc.name;
  const push = (text: string) => ctx.log?.body.push({ line: ctx.line, text });
  return {
    console: (...lines) => lines.forEach(push),
    ok: (text) => void ctx.report.ok(ctx.line, text, doc),
    code(code, o = {}) {
      const { indent = "", ...init } = o;
      const e = ctx.report.code(code, { line: ctx.line, doc, ...init });
      push(`${indent}${e.level === "error" ? "✗" : e.level === "warn" ? "⚠" : "ℹ"} ${e.text}`);
    },
  };
}

/** popis výstupu do protokolu (bez „staženo“ – CLI zapisuje do složky, serve do paměti) */
const okText = (what: string, name: string, bytes: number, label: string) => `${what}: ${name} · ${fmtBytes(bytes)} · ${label}`;

type Out = { name: string; mime: string; data: Uint8Array; format: string };

/**
 * Doručí soubor: hostiteli (`host.files.write`, název může dostat „ (2)“), jako base64 do protokolu, nebo zašifrovaný do
 * úložiště odkazů s odkazem na stránku ke stažení (share-file.ts). Vrací zapsaný soubor (řádek F) – u base64 / odkazu jen
 * popis bez cesty; null = nedoručeno (✗ out.too-big, share.store-unavailable, share.rejected).
 */
async function deliver(ctx: OpCtx, e: Emit, f: Out, what: string, label: string, how: "file" | OutDelivery, weak: false | "note" | "check" = false): Promise<OutFile | null> {
  const doc = runOf(ctx).doc.name;
  // `weak` (22c, 22i kolo 6): zápis souboru, o jehož výsledku rozhodne až kontrola níže (STEP / BREP se zpětným načtením,
  // model bez tělesa, volné plochy) – soubor je zapsaný, ale zápis se nepočítá mezi ✓ (ℹ „zapsáno – kontrola níže“); ✓ nese
  // jen kontrola, ⚠ / ✗ kontroly pak nestojí pod zeleným řádkem
  // „check“ = výsledek nese kontrola zpětným načtením níže (věta „zapsáno, kontrola níže“); „note“ = jen ℹ (nález složení následuje)
  const done = (text: string) => (weak ? void ctx.report.code("msg.note", { line: ctx.line, doc, text: weak === "check" ? `${text} – ${tr("zapsáno, kontrola níže")}` : text }) : e.ok(text));
  const sym = (line: string) => (weak ? `${line.replace(/^✓/, "ℹ")}${weak === "check" ? ` · ${tr("kontrola níže")}` : ""}` : line);
  if (how === "link") {
    const { shareFile, FileStoreError } = await import("../../share-file");
    try {
      const hs = ctx.host.share;
      const r = await shareFile(f, hs ? { store: hs.store } : {});
      const exp = new Date(r.exp);
      e.console(sym(tr("✓ {0}: {1} · {2} · {3} – v úložišti, odkaz ke stažení platí do {4}", what, f.name, fmtBytes(f.data.length), label, exp.toLocaleDateString(cadLocale(), { day: "numeric", month: "numeric", year: "numeric" }))), `URL: ${r.url}`);
      done(okText(what, f.name, f.data.length, label));
      const sha256 = await sha256Hex(f.data);
      ctx.report.measure(ctx.line, "file", `name=${quote(f.name)} format=${f.format} bytes=${f.data.length} sha256=${sha256} url=${r.url} exp=${exp.toISOString().slice(0, 10)}`, { doc, data: { name: f.name, mime: f.mime, bytes: f.data.length, sha256, url: r.url, exp: r.exp } });
      return { name: f.name, format: f.format, bytes: f.data.length, sha256, doc, url: r.url };
    } catch (err) {
      if (!(err instanceof FileStoreError)) throw err;
      if (err.unavailable) e.code("share.store-unavailable", { text: err.message });
      else e.code("share.rejected", { args: [err.message] });
      return null;
    }
  }
  if (how === "base64") {
    if (f.data.length > OUT_BASE64_MAX) {
      e.code("out.too-big", { args: [f.name, f.data.length, OUT_BASE64_MAX] });
      return null;
    }
    const b64 = bytesToBase64(f.data);
    const sha256 = await sha256Hex(f.data);
    e.console(sym(tr("✓ {0}: {1} · {2} · {3} – jako base64 v protokolu ({4} znaků)", what, f.name, fmtBytes(f.data.length), label, b64.length)), `BASE64 ${quote(f.name)} ${f.data.length}B ${b64}`);
    done(okText(what, f.name, f.data.length, label));
    ctx.report.measure(ctx.line, "file", `name=${quote(f.name)} format=${f.format} bytes=${f.data.length} sha256=${sha256} base64=${b64.length}`, { doc, detail: b64, data: { name: f.name, mime: f.mime, bytes: f.data.length, sha256, base64: b64 } });
    return { name: f.name, format: f.format, bytes: f.data.length, sha256, doc, base64: b64 };
  }
  const file = await ctx.host.files.write({ name: f.name, mime: f.mime, data: f.data, doc, format: f.format });
  e.console(sym(fileLogLine(what, file.name, f.data.length, label)));
  done(okText(what, file.name, f.data.length, label));
  return file;
}

/* ───────────────────────── uložit, export ───────────────────────── */

async function saveProject(ctx: OpCtx, e: Emit, cmd: { name?: string; deliver?: OutDelivery }, what: string): Promise<void> {
  const d = runOf(ctx).doc;
  const p = projectFile(d, outFileName(cmd.name, plainName(d.name), FORMAT_EXT.mncad));
  const f = await deliver(ctx, e, p, what, formatLabel("mncad"), cmd.deliver ?? "file");
  if (!f) return;
  f.modelRev = p.modelRev; // revize modelu v souboru i v řádku F (vlna 22, bod 12)
  if (!cmd.deliver) ctx.host.ui?.saved?.(d);
  const check = tr("  ✓ kontrola: projekt jde znovu otevřít – „{0}“, {1} {2}", p.docName, p.count, p.asm ? tr("komponent") : tr("prvků"));
  e.console(check);
  e.ok(check.trim().replace(/^✓\s*/, ""));
  if (p.lost.length) e.code("out.lost-imports", { args: [p.lost.join(", ")] });
}

async function export3d(ctx: OpCtx, e: Emit, cmd: Extract<OutCmd, { kind: "export" }>): Promise<void> {
  if (cmd.format === "mncad") return saveProject(ctx, e, cmd, tr("export MNCAD"));
  const d = runOf(ctx).doc;
  const fmt = cmd.format;
  const FMT = fmt.toUpperCase();
  // objemový formát (STEP, BREP, STL, 3MF – 22c): složení modelu – bez tělesa je export ✗ out.no-solid, ne ✓
  const ms = isVolumeFormat(fmt) ? await modelSolids(ctx.host.kernel, ctx.ws, d, asmHooks(ctx)) : null;
  const noSolid = ms?.solids === 0;
  // objemový formát: přesná kontrola platnosti před exportem (do 400 ploch sama, jinak řekne, že proběhla jen rychlá – 22a);
  // model bez tělesa ji nepotřebuje („těleso platné“ by u ploch klamalo)
  const pre = (fmt === "step" || fmt === "brep") && cmd.check !== false && !noSolid ? await exactBeforeExport(ctx.host.kernel, ctx.ws, docKeyOf(ctx), d) : null;
  const name = outFileName(cmd.name, plainName(d.name), FORMAT_EXT[fmt]);
  // zpětná kontrola souboru (STEP / BREP): o výsledku exportu rozhodne až ona → zápis je ℹ, ne ✓ (22i kolo 6); volné plochy
  // vedle tělesa jsou známé už před zápisem → také ℹ (⚠ out.free-surfaces následuje)
  const checked = (fmt === "step" || fmt === "brep") && cmd.check !== false;
  const weak = checked ? ("check" as const) : noSolid || (ms?.free ?? 0) > 0 ? ("note" as const) : false;
  // přísný režim (22c kolo 6): nález, který běh zastaví, nesmí nechat soubor na disku – nález známý před zápisem (složení
  // modelu, přesná kontrola modelu) soubor nezapíše vůbec; kontrola zpětným načtením proběhne PŘED zápisem nad daty
  // a při nálezu, který zastaví, se soubor nezapíše (dřív STOP exit 2 a soubor s check=fail zůstal ve složce)
  const stops = (code: string) => !!ctx.strict?.escalates(code, ctx.line);
  const unwritten = (text: string) => tr("soubor nezapsán (přísný režim zastaví běh) – {0}", text);
  const verdict0 = ms ? solidVerdict(ms, FMT, "model", ms.parts) : null;
  if (verdict0 && stops(verdict0.code)) {
    e.code(verdict0.code, { text: unwritten(verdict0.text), level: verdict0.level });
    return;
  }
  if (pre?.level === "warn" && stops("geom.exact-invalid")) {
    e.code("geom.exact-invalid", { args: [d.name, unwritten(pre.text)] });
    return;
  }
  const strictCheck = checked && !!ctx.strict?.at(ctx.line).on;
  const hold: { check?: ExportCheck } = {};
  // export jako úloha s fázemi (vlna 22, bod 22h – engine/export-job.ts): přestavba modelu, převod, zápis, kontrola
  // zpětným načtením; pořadí řádků protokolu jako dřív (soubor, pak kontrola); fáze hlásí hostitel (CLI --progress, běh v GUI)
  const job = await runExportJob(
    d,
    fmt,
    {
      kernel: ctx.host.kernel,
      phase: (p) => ctx.host.phase?.(`export:${fmt}`, p),
      write: async (data, check) => {
        if (check && !check.ok && stops(check.code ?? "out.check-failed")) {
          hold.check = check;
          return null;
        }
        return deliver(ctx, e, { name, mime: OUT_MIME[fmt], data, format: fmt }, tr("export {0}", fmt.toUpperCase()), formatLabel(fmt), cmd.deliver ?? "file", weak);
      },
    },
    { check: cmd.check !== false, verifyFirst: strictCheck, ...(ms?.parts ? { parts: ms.parts } : {}) },
  );
  const f = job.out;
  const prePrint = () => {
    if (!pre) return;
    if (pre.level === "ok") {
      e.console(`  ✓ ${pre.text}`);
      e.ok(pre.text);
    } else if (pre.level === "warn") e.code("geom.exact-invalid", { args: [d.name, pre.text], indent: "  " });
    else e.code("msg.note", { text: pre.text, indent: "  " });
  };
  if (hold.check) {
    const c = hold.check;
    prePrint();
    e.code(c.code ?? "out.check-failed", { text: unwritten(c.line.replace(/^[✓⚠✗]\s*/, "")), level: c.level === "error" || Number.isNaN(c.volumeDiffPct) ? "error" : "warn" });
    return;
  }
  if (!f) return;
  // záznam exportu s revizí modelu (bod 20) a záznamem úlohy (22h: stav, čas, fáze, kontrola – trvale v dokumentu); kontrola
  // zpětným načtením se doplní níže, až je známá (záznam téhož formátu a souboru se přepíše)
  const jobMs = job.phases.reduce((a, p) => a + p.ms, 0);
  const note = (check?: { ok: boolean; text: string }) => recordOutput(ctx, { what: "model", format: fmt, file: f.name, job: { state: "done", ms: jobMs, phases: job.phases, ...(check ? { check } : {}) } });
  note();
  f.modelRev = job.modelRev;
  f.phases = job.phases;
  prePrint();
  if ((fmt !== "step" && fmt !== "brep") || cmd.check === false) {
    if (fmt === "step" || fmt === "brep") e.console(tr("  – kontrola {0} vynechána („bez kontroly“)", FMT));
    // bez zpětného čtení (síť, „bez kontroly“): složení modelu – ✗ bez tělesa / ⚠ plochy mimo tělesa (22c)
    const v = ms ? solidVerdict(ms, FMT, "model", ms.parts) : null;
    if (v) {
      e.code(v.code, { text: v.text, indent: "  ", level: v.level });
      f.check = { ok: false, text: v.text };
      note(f.check);
    }
    return;
  }
  const c = job.check!;
  const text = c.line.replace(/^[✓⚠✗]\s*/, "");
  f.check = { ok: c.ok, text };
  note(f.check);
  if (c.ok) {
    e.console(`  ${c.line}`);
    e.ok(text);
  } else e.code(c.code ?? "out.check-failed", { text, indent: "  ", level: c.level === "error" || Number.isNaN(c.volumeDiffPct) ? "error" : "warn" });
}

/* ───────────────────────── výkres, skica ───────────────────────── */

async function exportDrawingCmd(ctx: OpCtx, e: Emit, cmd: Extract<OutCmd, { kind: "drawing" }>): Promise<void> {
  const d = runOf(ctx).doc;
  assertDrawable(d); // 2D výkres / prázdný model → ✗ s důvodem
  // PNG je rastr přes canvas – jen v prohlížeči
  if (cmd.format === "png" && typeof document === "undefined") return coded(ctx, "host.app-only", { args: [tr("výkres export png")] });
  // „vše“ u sestavy s výkresy dílů v komponentách = všechny listy dokumentu (files.ts `sheetScope`)
  const scope = sheetScope(d, cmd.sheet);
  if (!d.drawings?.length && !(scope === "doc" && hasDrawings(d))) e.code("drawing.default-sheet");
  const env: DrawEnv = { kernel: ctx.host.kernel, ws: ctx.ws, flat: ctx.host.ui?.bomFlat?.() ?? true, hooks: asmHooks(ctx), ...(ctx.host.fonts ? { fonts: ctx.host.fonts } : {}) };
  const p = await drawingOutput(env, d, cmd.format, cmd.sheet, cmd.name);
  // vydaný list ze starší revize modelu: soubor by nesl staré písmeno revize s jiným obsahem → ⚠ drawing.stale, přísně ✗ bez zápisu (bod 20)
  const ids = await exportedSheetIds(d, scope);
  const before = ctx.report.entries.length;
  warnStaleExport(ctx, d, ids);
  if (ctx.report.entries.slice(before).some((x) => x.code === "drawing.stale" && x.level === "error")) return;
  const FMT = cmd.format.toUpperCase();
  const many = scope === "doc" || (scope === "all" && !!d.drawings?.length) || (p.sheets ?? 1) > 1;
  const one = typeof cmd.sheet === "number" || (typeof cmd.sheet === "string" && cmd.sheet !== "all" && cmd.sheet !== "doc");
  const what = many ? tr("výkres {0}, listů {1}", FMT, p.sheets ?? 1) : one ? tr("výkres {0}, list {1}", FMT, cmd.sheet as string | number) : tr("výkres {0}", FMT);
  const label = formatLabel(cmd.format) + (p.files ? ` · ZIP: ${p.files.join(", ")}` : "") + (p.width ? ` ${p.width} × ${p.height} px` : "");
  const f = await deliver(ctx, e, p, what, label, cmd.deliver ?? "file");
  if (f) f.sheets = p.sheets ?? 1;
  if (f) {
    const rev = ids.length === 1 ? ((d.drawings?.find((s) => s.id === ids[0])?.meta as { revision?: string } | undefined)?.revision ?? "") : "";
    // soubor zastaralého vydaného listu nese staré písmeno revize s jiným obsahem – záznam to nese (bod 20)
    const mid = modelId(d);
    const revStale = ids.some((sid) => { const s = d.drawings?.find((x) => x.id === sid); return !!s?.issued && !sameModel(s.issued, mid); });
    recordOutput(ctx, { what: "drawing", format: cmd.format, file: f.name, ...(ids.length ? { sheets: ids } : {}), ...(rev ? { rev } : {}), ...(revStale ? { revStale } : {}) });
  }
  // neúplné kóty listu (bod 18) = ⚠ drawing.dims-incomplete, ostatní varování listu ⚠ drawing.warning
  // řez mimo těleso (22i kolo 6): ✗ drawing.section-miss jako u příkazu výkresu – a když ho protokol pro týž list už má
  // (příkaz `výkres řez …`, konec bloku), podruhé se nehlásí (dřív navíc ⚠ drawing.warning s odznakem bez kódu řezu)
  const labels = ids.map((sid) => sheetLabel(d, d.drawings?.findIndex((x) => x.id === sid) ?? 0));
  let missOwned: boolean | null = null; // listy exportu, které běh měnil: nález řezu nese řádek příkazu výkresu
  for (const w of p.warnings) {
    const wc = sheetWarningCode(w.text);
    if (wc === "drawing.section-miss") {
      const cands = w.sheet ? [w.sheet] : labels.length ? labels : [sheetLabel(d, 0)];
      const known = () => cands.some((sheet) => ctx.report.entries.some((x) => sameSheetFinding(x, { code: wc, doc: d.name, text: sheetIssueText({ code: wc, sheet, text: w.text }) })));
      if (known()) continue;
      if (missOwned === null) {
        missOwned = false;
        for (const sid of ids) if (ctx.draw && (await ctx.draw.reportNow(sid, [wc]))) missOwned = true;
      }
      if (missOwned && known()) continue;
      e.code(wc, { args: issueArgs(wc, cands[0]!, w.text), level: "error", indent: "  " });
      continue;
    }
    e.code(wc === "drawing.dims-incomplete" ? "drawing.dims-incomplete" : "drawing.warning", { text: w.sheet ? `${w.sheet}: ${w.text}` : w.text, indent: "  " });
  }
}

/** id listů dokumentu `d` v rozsahu exportu (bez uloženého výkresu žádné; „doc“ = listy dokumentu, výkresy dílů z komponent ne) */
async function exportedSheetIds(d: CadDoc, scope: number | string | "all" | "doc" | undefined): Promise<string[]> {
  const list = d.drawings ?? [];
  if (!list.length) return [];
  if (scope === "doc") return list.map((s) => s.id);
  try {
    const { exportSheets } = await import("../../drawing-export");
    return exportSheets(d, scope).map((i) => list[i]?.id).filter((x): x is string => !!x);
  } catch {
    return [];
  }
}

async function exportSketch(ctx: OpCtx, e: Emit, cmd: Extract<OutCmd, { kind: "sketch" }>): Promise<void> {
  const d = runOf(ctx).doc;
  const { sketch, data } = sketchDxf(d, cmd.sketch, ctx.host.ui?.openSketchId?.());
  const name = outFileName(cmd.name, plainName(sketch.name), ["dxf"]);
  const f = await deliver(ctx, e, { name, mime: OUT_MIME.dxf, data, format: "dxf" }, tr("skica „{0}“", sketch.name), tr("{0}, {1} entit", formatLabel("sketch-dxf"), sketch.entities.length), cmd.deliver ?? "file");
  if (f) recordOutput(ctx, { what: "sketch", format: "dxf", file: f.name });
}

/* ───────────────────────── textový skript ───────────────────────── */

/**
 * `export skript [cs|en|de] ["název"]` (vlna 17, doc-script.ts): dokument jako textové příkazy `<název>.mncad.txt`; čísla
 * vybraných hran a ploch ověří jádro hostitele podle otisků (doc-script-fresh.ts) – stejně v aplikaci i v CLI.
 */
async function exportScript(ctx: OpCtx, e: Emit, cmd: Extract<OutCmd, { kind: "script" }>): Promise<void> {
  const d = runOf(ctx).doc;
  if (isEmptyDoc(d) && d.kind !== "draft") throw new Error(tr("export skript: dokument je prázdný – není co zapsat"));
  const [{ scriptOfDocWith }, { scriptCoverageText }] = await Promise.all([import("../../doc-script-fresh"), import("../../doc-script")]);
  const k = ctx.host.kernel;
  // doplňky razítka (kusovník a pozice sestavy) pro ověření upravených vygenerovaných pozic – jako příkazy výkresu (drawing-cmd.ts)
  const extras = (doc: CadDoc) => drawExtras(ctx.ws, k, doc, { ...asmHooks(ctx), flat: ctx.host.ui?.bomFlat?.() ?? true });
  const r = await scriptOfDocWith({ pickSigs: (before, f) => k.pickSigs(before, f), drawing: (doc, meta, o) => k.drawing(doc, meta, o), extras }, d, cmd.lang ? { lang: cmd.lang } : {});
  const name = outFileName(cmd.name, plainName(d.name), ["mncad.txt", "txt"]);
  const data = new TextEncoder().encode(r.text);
  const f = await deliver(ctx, e, { name, mime: "text/plain", data, format: "script" }, tr("textový skript"), tr("textové příkazy, {0} řádků", r.stats.lines), cmd.deliver ?? "file");
  if (!f) return;
  e.console(`  ${scriptCoverageText(r.stats)}`);
  if (r.fresh?.checked) e.console(`  ${tr("čísla vybraných hran a ploch ověřena jádrem podle otisků: {0} prvků, z toho {1} s jinými čísly než uloženými", r.fresh.checked, r.fresh.renumbered)}`);
  for (const note of r.notes) e.code("msg.note", { text: note, indent: "  " });
}

/* ───────────────────────── sdílení ───────────────────────── */

const withTimeout = <T>(p: Promise<T>, ms: number, dflt: T) => Promise.race([p.catch(() => dflt), new Promise<T>((r) => setTimeout(() => r(dflt), ms))]);

/** řádky konzole o odkazu; adresa na samostatném řádku „URL: …“ (stejný tvar ve všech jazycích) */
async function linkLines(ctx: OpCtx, l: LastLink, head: string, content?: ShareContent): Promise<string[]> {
  const exp = l.exp ? new Date(l.exp).toLocaleDateString(cadLocale(), { day: "numeric", month: "numeric", year: "numeric" }) : tr("bez omezení");
  const clip = ctx.host.ui?.clipboard;
  const copied = clip ? await withTimeout(clip(l.url), 1500, false) : false;
  return [
    // mode=self je také úložiště (oprava w11: „v odkazu“ jen u dokumentu celého v adrese)
    tr("{0} – „{1}“ ({2}), platí do: {3}, {4}, {5} {6}", head, l.name, l.view === "drawing" ? tr("výkres") : tr("model"), exp, l.password ? tr("s heslem") : tr("bez hesla"), fmtBytes(l.bytes), l.mode === "link" ? tr("v odkazu") : tr("v úložišti")),
    `URL: ${l.url}`,
    // krátký odkaz (vlna 16): kód za # po čtveřicích k přečtení nebo opsání
    ...(l.code ? [tr("  kód k přečtení nebo opsání: {0} ({1} znaků odkazu)", groupShareCode(l.code), l.url.length)] : []),
    // co odkaz obsahuje (vlna 22, bod 16) – stejný popis jako výpis `= … link … content=…`
    ...(content ? [tr("  obsah odkazu: {0}", shareContentText(content))] : []),
    ...(clip ? [copied ? tr("  (zkopírováno do schránky)") : tr("  (schránka není dostupná – adresu zkopírujte z protokolu)")] : []),
  ];
}

async function shareCmd(ctx: OpCtx, e: Emit, cmd: Extract<OutCmd, { kind: "share" }>): Promise<void> {
  const d = runOf(ctx).doc;
  if (isEmptyDoc(d)) throw new Error(tr("Prázdný dokument nelze sdílet – nejdřív vytvořte nebo otevřete díl."));
  const view = cmd.view ?? "model";
  if (view === "drawing" && !d.drawings?.length) throw new Error(tr("sdílet výkres: dokument zatím nemá výkres – nejdřív „výkres A3 …“, nebo sdílejte model"));
  const hs = ctx.host.share;
  const r = await shareWithPolicy(
    d,
    {
      days: cmd.days === undefined ? SHARE_DEFAULT_DAYS : cmd.days,
      view,
      want: cmd.mode ?? "auto",
      ...(cmd.password ? { password: cmd.password } : {}),
      ...(cmd.from ? { from: cmd.from } : {}),
      ...(cmd.orLink ? { orLink: true } : {}),
      ...(hs ? { base: hs.base, store: hs.store } : {}),
    },
    (n) => {
      // ℹ vypnutého úložiště jednou za běh (vlna 22, bod 16) – délka každého odkazu je v jeho výpisu `= … chars=`
      if (n.code === "share.store-off" && ctx.report.entries.some((x) => x.code === "share.store-off")) return;
      e.code(n.code, { ...(n.args ? { args: n.args } : {}), ...(n.text ? { text: n.text } : {}) });
    },
  );
  if (!r) return;
  const content = shareContent(d);
  const l: LastLink = { url: r.url, mode: r.mode, bytes: r.bytes, exp: r.exp, name: d.name, view, password: r.password, content, ...(r.code ? { code: r.code } : {}), ...(r.note ? { note: r.note } : {}) };
  rememberLink(l);
  reportLink(ctx, l);
  const lines = await linkLines(ctx, l, tr("✓ sdílený odkaz vytvořen"), content);
  e.console(...lines);
  e.ok(lines[0].replace(/^✓\s*/, ""));
}

/**
 * Odkaz do reportu (vlna 22, bod 16): `shares[]` (každý odkaz běhu, `share` = poslední → řádek O) a výpis
 * `= L<n> link "<dokument>" url=… mode=… exp=… view=… pw=… bytes=… chars=… content=… comp=… parts=… sheets=… files=…`
 * – adresa každého `sdílet` zůstane v plném i stručném protokolu a v JSON, i když skript sdílí víckrát.
 */
function reportLink(ctx: OpCtx, l: LastLink): void {
  const info = { ...shareInfo(l), line: ctx.line, view: l.view, password: l.password, ...(l.content ? { content: l.content } : {}) };
  ctx.report.setShare(info);
  ctx.report.measure(ctx.line, "link", shareLinkKv(info, l.content), { doc: l.name, data: info });
}

async function linkCmd(ctx: OpCtx, e: Emit, cmd: Extract<OutCmd, { kind: "link" }>): Promise<void> {
  if (cmd.verify) return verifyLinkCmd(ctx, e, cmd.verify);
  const l = lastShareLink();
  if (!l) throw new Error(tr("zatím žádný sdílený odkaz – vytvořte ho příkazem „sdílet“"));
  reportLink(ctx, l);
  const lines = await linkLines(ctx, l, tr("✓ poslední sdílený odkaz"), l.content);
  e.console(...lines);
  e.ok(lines[0].replace(/^✓\s*/, ""));
}

/**
 * `odkaz ověřit [<odkaz|kód>] [heslo X]` (vlna 22, bod 16 – share-verify.ts): odkaz se otevře jako u příjemce (úložiště
 * webu odkazu, dešifrování, rozbalení, kontrola dokumentu a platnosti) – nic se neotevře ani nezmění. Funkční odkaz = ✓
 * s režimem, platností a obsahem; nefunkční = ✗ share.link-broken s důvodem (useknutý / poškozený / heslo / platnost /
 * nenalezen / síť). Vždy výpis `= L<n> link url=… ok=1|0 …`. Bez adresy = poslední odkaz („sdílet“ v tomtéž běhu).
 */
async function verifyLinkCmd(ctx: OpCtx, e: Emit, v: { url?: string; password?: string }): Promise<void> {
  const url = v.url ?? lastShareLink()?.url;
  if (!url) throw new Error(tr("odkaz ověřit: chybí odkaz – zadejte odkaz nebo kód (odkaz ověřit https://…/s#KÓD), nebo nejdřív „sdílet“"));
  const { verifyShareLink } = await import("../../share-verify");
  const r = await verifyShareLink(url, v.password ? { password: v.password } : {});
  const doc = r.ok ? r.content.doc : undefined;
  if (r.ok) {
    const exp = r.exp ? new Date(`${r.exp}T00:00:00Z`).toLocaleDateString(cadLocale(), { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }) : tr("bez omezení");
    const where = r.mode === "link" ? tr("dokument v odkazu") : tr("v úložišti");
    const text = tr("odkaz se otevře ({0} znaků, {1}, platí do: {2}, {3}): {4}", r.chars, where, exp, r.view === "drawing" ? tr("výkres") : tr("model"), shareContentText(r.content));
    e.console(`✓ ${text}`);
    e.ok(text);
  } else e.code("share.link-broken", { args: [r.reason, r.text] });
  ctx.report.measure(ctx.line, "link", verifyKv(r.ok ? { ok: true, url: r.url, mode: r.mode, exp: r.exp, content: r.content, chars: r.chars } : { ok: false, url: r.url, reason: r.reason, chars: r.chars }), { ...(doc ? { doc } : {}), data: r });
}

/* ───────────────────────── příkaz ───────────────────────── */

export const outOp: OpHandler<"out"> = async (op, ctx) => {
  const e = emitter(ctx);
  const cmd = op.cmd;
  switch (cmd.kind) {
    // exporty · výstupy [zastaralé] · přepočítat vše (vlna 22, bod 20 – engine/outputs-ops.ts)
    case "exports":
    case "outputs":
    case "recompute":
      return outputsCmd(ctx, cmd);
    case "save":
      return saveProject(ctx, e, cmd, tr("uloženo"));
    case "export":
      return export3d(ctx, e, cmd);
    case "drawing":
      return exportDrawingCmd(ctx, e, cmd);
    case "sketch":
      return exportSketch(ctx, e, cmd);
    case "share":
      return shareCmd(ctx, e, cmd);
    case "script":
      return exportScript(ctx, e, cmd);
    case "link":
      return linkCmd(ctx, e, cmd);
  }
};
