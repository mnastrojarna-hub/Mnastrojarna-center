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
import { fileLogLine, fmtBytes, formatLabel, FORMAT_EXT, outFileName, type OutCmd, type OutDelivery } from "../../agent-out";
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
import { lastShareLink, rememberLink, shareInfo, shareWithPolicy, type LastLink } from "../share-out";
import { asmHooks, coded, type OpCtx, type OpHandler } from "./util";
import { runExportJob } from "../export-job";
import { outputsCmd, recordOutput, warnStaleExport } from "../outputs-ops";

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
async function deliver(ctx: OpCtx, e: Emit, f: Out, what: string, label: string, how: "file" | OutDelivery): Promise<OutFile | null> {
  const doc = runOf(ctx).doc.name;
  if (how === "link") {
    const { shareFile, FileStoreError } = await import("../../share-file");
    try {
      const hs = ctx.host.share;
      const r = await shareFile(f, hs ? { store: hs.store } : {});
      const exp = new Date(r.exp);
      e.console(tr("✓ {0}: {1} · {2} · {3} – v úložišti, odkaz ke stažení platí do {4}", what, f.name, fmtBytes(f.data.length), label, exp.toLocaleDateString(cadLocale(), { day: "numeric", month: "numeric", year: "numeric" })), `URL: ${r.url}`);
      e.ok(okText(what, f.name, f.data.length, label));
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
    e.console(tr("✓ {0}: {1} · {2} · {3} – jako base64 v protokolu ({4} znaků)", what, f.name, fmtBytes(f.data.length), label, b64.length), `BASE64 ${quote(f.name)} ${f.data.length}B ${b64}`);
    e.ok(okText(what, f.name, f.data.length, label));
    ctx.report.measure(ctx.line, "file", `name=${quote(f.name)} format=${f.format} bytes=${f.data.length} sha256=${sha256} base64=${b64.length}`, { doc, detail: b64, data: { name: f.name, mime: f.mime, bytes: f.data.length, sha256, base64: b64 } });
    return { name: f.name, format: f.format, bytes: f.data.length, sha256, doc, base64: b64 };
  }
  const file = await ctx.host.files.write({ name: f.name, mime: f.mime, data: f.data, doc, format: f.format });
  e.console(fileLogLine(what, file.name, f.data.length, label));
  e.ok(okText(what, file.name, f.data.length, label));
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
  // objemový formát: přesná kontrola platnosti před exportem (do 400 ploch sama, jinak řekne, že proběhla jen rychlá – 22a)
  const pre = (fmt === "step" || fmt === "brep") && cmd.check !== false ? await exactBeforeExport(ctx.host.kernel, ctx.ws, docKeyOf(ctx), d) : null;
  const name = outFileName(cmd.name, plainName(d.name), FORMAT_EXT[fmt]);
  // export jako úloha s fázemi (vlna 22, bod 22h – engine/export-job.ts): přestavba modelu, převod, zápis, kontrola
  // zpětným načtením; pořadí řádků protokolu jako dřív (soubor, pak kontrola); fáze hlásí hostitel (CLI --progress, běh v GUI)
  const job = await runExportJob(
    d,
    fmt,
    {
      kernel: ctx.host.kernel,
      phase: (p) => ctx.host.phase?.(`export:${fmt}`, p),
      write: (data) => deliver(ctx, e, { name, mime: OUT_MIME[fmt], data, format: fmt }, tr("export {0}", fmt.toUpperCase()), formatLabel(fmt), cmd.deliver ?? "file"),
    },
    { check: cmd.check !== false, verifyFirst: false },
  );
  const f = job.out;
  if (!f) return;
  recordOutput(ctx, { what: "model", format: fmt, file: f.name }); // záznam exportu s revizí modelu (bod 20)
  f.modelRev = job.modelRev;
  f.phases = job.phases;
  if (pre) {
    if (pre.level === "ok") {
      e.console(`  ✓ ${pre.text}`);
      e.ok(pre.text);
    } else if (pre.level === "warn") e.code("geom.exact-invalid", { args: [d.name, pre.text], indent: "  " });
    else e.code("msg.note", { text: pre.text, indent: "  " });
  }
  if (fmt !== "step" && fmt !== "brep") return;
  if (cmd.check === false) {
    e.console(tr("  – kontrola {0} vynechána („bez kontroly“)", fmt.toUpperCase()));
    return;
  }
  const c = job.check!;
  const text = c.line.replace(/^[✓⚠✗]\s*/, "");
  f.check = { ok: c.ok, text };
  if (c.ok) {
    e.console(`  ${c.line}`);
    e.ok(text);
  } else e.code("out.check-failed", { text, indent: "  ", level: Number.isNaN(c.volumeDiffPct) ? "error" : "warn" });
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
    recordOutput(ctx, { what: "drawing", format: cmd.format, file: f.name, ...(ids.length ? { sheets: ids } : {}), ...(rev ? { rev } : {}) });
  }
  for (const w of p.warnings) e.code("drawing.warning", { text: w.sheet ? `${w.sheet}: ${w.text}` : w.text, indent: "  " });
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
async function linkLines(ctx: OpCtx, l: LastLink, head: string): Promise<string[]> {
  const exp = l.exp ? new Date(l.exp).toLocaleDateString(cadLocale(), { day: "numeric", month: "numeric", year: "numeric" }) : tr("bez omezení");
  const clip = ctx.host.ui?.clipboard;
  const copied = clip ? await withTimeout(clip(l.url), 1500, false) : false;
  return [
    // mode=self je také úložiště (oprava w11: „v odkazu“ jen u dokumentu celého v adrese)
    tr("{0} – „{1}“ ({2}), platí do: {3}, {4}, {5} {6}", head, l.name, l.view === "drawing" ? tr("výkres") : tr("model"), exp, l.password ? tr("s heslem") : tr("bez hesla"), fmtBytes(l.bytes), l.mode === "link" ? tr("v odkazu") : tr("v úložišti")),
    `URL: ${l.url}`,
    // krátký odkaz (vlna 16): kód za # po čtveřicích k přečtení nebo opsání
    ...(l.code ? [tr("  kód k přečtení nebo opsání: {0} ({1} znaků odkazu)", groupShareCode(l.code), l.url.length)] : []),
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
    (n) => e.code(n.code, { ...(n.args ? { args: n.args } : {}), ...(n.text ? { text: n.text } : {}) }),
  );
  if (!r) return;
  const l: LastLink = { url: r.url, mode: r.mode, bytes: r.bytes, exp: r.exp, name: d.name, view, password: r.password, ...(r.code ? { code: r.code } : {}), ...(r.note ? { note: r.note } : {}) };
  rememberLink(l);
  ctx.report.setShare(shareInfo(l));
  const lines = await linkLines(ctx, l, tr("✓ sdílený odkaz vytvořen"));
  e.console(...lines);
  e.ok(lines[0].replace(/^✓\s*/, ""));
}

async function linkCmd(ctx: OpCtx, e: Emit): Promise<void> {
  const l = lastShareLink();
  if (!l) throw new Error(tr("zatím žádný sdílený odkaz – vytvořte ho příkazem „sdílet“"));
  ctx.report.setShare(shareInfo(l));
  const lines = await linkLines(ctx, l, tr("✓ poslední sdílený odkaz"));
  e.console(...lines);
  e.ok(lines[0].replace(/^✓\s*/, ""));
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
      return linkCmd(ctx, e);
  }
};
