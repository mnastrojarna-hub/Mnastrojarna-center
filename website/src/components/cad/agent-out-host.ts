/**
 * Provedení výstupních příkazů konzole (cad/agent-out.ts): uložit, export 3D, export výkresu, skica DXF, sdílet, odkaz.
 * Soubory se stahují vždy přímo (`writeSaved` bez dialogu „Uložit jako“) – agent, který ovládá prohlížeč, nikdy neuvízne
 * na systémovém okně. U STEP / BREP se soubor znovu načte jádrem a porovná s modelem, aby agent věděl, že soubor je
 * věrná kopie (bez sítě a bez úložiště importů – cad/export-verify.ts; opakovaný export nezměněného modelu kontrolu
 * nepočítá znovu). Sdílený odkaz se vypíše do protokolu (a zkopíruje do schránky, když to prohlížeč dovolí – nikdy se na
 * schránku nečeká).
 */
import { cad } from "@/cad/client";
import { cadLocale, tr } from "@/cad/i18n";
import { embedBlobs, missingBlobFiles } from "@/cad/blobs";
import { lostImportsText } from "@/cad/vault-blobs";
import { createShareLink, groupShareCode, SHARE_DEFAULT_DAYS, type ShareMode, type ShareView } from "@/cad/share";
import { sketchToDxf } from "@/cad/sketch";
import { checkFailed, exportCheck, fileLogLine, fmtBytes, formatLabel, FORMAT_EXT, outFileName, type ExportCheck, type Export3dFormat, type OutCmd, type OutFileInfo } from "@/cad/agent-out";
import type { DrawingExtras } from "@/cad/drawing-agent";
import type { CadDoc, Feature } from "@/cad/types";
import { copyText } from "@/lib/clipboard";
import { writeSaved } from "@/lib/save-file";

type SketchFeature = Extract<Feature, { type: "sketch" }>;

/** co výstupy potřebují od aplikace (podmnožina ApiHost) */
export type OutHost = {
  /** skica otevřená ve skicáři */
  sketch: () => { id: string } | null;
  /** hmotnost, kusovník, balónky pro razítko výkresu (jako ve výkresovém prostředí) */
  drawEnv?: () => DrawingExtras;
  /** dokument byl uložen (neuložené změny = žádné) */
  markSaved?: (d: CadDoc) => void;
};

const MIME: Record<Export3dFormat, string> = { step: "application/step", brep: "application/octet-stream", stl: "model/stl", "3mf": "model/3mf", obj: "model/obj", glb: "model/gltf-binary", wrl: "model/vrml", mncad: "application/json" };
/** výchozí název souboru jako u tlačítek (bez diakritiky) */
const safeName = (s: string) => (s || "model").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(0, 60);
const isEmpty = (d: CadDoc) => !d.features.length && !d.components?.length;

function fromBase64(s: string): Uint8Array {
  const b = atob(s);
  const u8 = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i);
  return u8;
}

/** stažení bez dialogu (i když Nastavení → Soubory říká „ptát se“) */
async function download(name: string, bytes: Uint8Array, mime: string) {
  await writeSaved({ name, handle: null }, bytes as BlobPart, mime);
}

/* ───────────────────────── uložit ───────────────────────── */
/** projekt .mncad do Stažených; kontrola: soubor jde zpět přečíst jako projekt */
export async function saveProjectFile(d: CadDoc, name: string | undefined, host?: OutHost, what = tr("uloženo")): Promise<OutFileInfo> {
  const file = outFileName(name, safeName(d.name), FORMAT_EXT.mncad);
  const lost = missingBlobFiles(d);
  const json = JSON.stringify(embedBlobs(d), null, 1);
  const bytes = new TextEncoder().encode(json);
  const back = JSON.parse(json) as CadDoc;
  const asm = back.kind === "assembly";
  const count = asm ? (back.components?.length ?? 0) : back.features.length;
  await download(file, bytes, MIME.mncad);
  host?.markSaved?.(d);
  const log = [fileLogLine(what, file, bytes.length, formatLabel("mncad")), tr("  ✓ kontrola: projekt jde znovu otevřít – „{0}“, {1} {2}", back.name, count, asm ? tr("komponent") : tr("prvků"))];
  const warning = lost.length ? lostImportsText(lost) : undefined;
  if (warning) log.push(`⚠ ${warning}`);
  return { name: file, mime: MIME.mncad, bytes: bytes.length, format: "mncad", log, ...(warning ? { warning } : {}) };
}

/* ───────────────────────── export 3D + kontrola ───────────────────────── */
/**
 * Poslední kontroly podle stavu dokumentu a formátu: opakovaný export nezměněného modelu (STEP má v hlavičce čas, bajty
 * se liší, těleso ne) kontrolu nepočítá znovu. Jen pár položek – nic dalšího se nedrží.
 */
const checks = new Map<string, ExportCheck>();
const CHECKS_MAX = 4;

/** exportovaný soubor znovu načte jádrem a porovná s modelem (tělesa, objem, obálka) */
export async function verifyExport(d: CadDoc, bytes: Uint8Array, format: "step" | "brep"): Promise<ExportCheck> {
  const label = format === "step" ? "STEP" : "BREP";
  const key = `${format}:${JSON.stringify({ ...d, name: "" })}`;
  const hit = checks.get(key);
  if (hit) return { ...hit, line: `${hit.line}${tr(" (model od minulé kontroly beze změny)")}` };
  try {
    const { model, file } = await cad.exportStats(d, bytes, format);
    if (!(file.volume > 0) && !file.solids) return checkFailed(label, tr("jádro v souboru nenašlo těleso"));
    const c = exportCheck(model, file, label);
    if (c.ok) {
      checks.delete(key);
      checks.set(key, c);
      while (checks.size > CHECKS_MAX) checks.delete(checks.keys().next().value!);
    }
    return c;
  } catch (err) {
    return checkFailed(label, (err as Error).message);
  }
}

export async function export3d(d: CadDoc, format: Export3dFormat, name: string | undefined, host?: OutHost, check = true): Promise<OutFileInfo> {
  if (format === "mncad") return saveProjectFile(d, name, host, tr("export MNCAD"));
  if (isEmpty(d)) throw new Error(tr("export: model je prázdný – nejdřív vymodelujte díl"));
  const bytes = new Uint8Array(await cad.exportFile(d, format));
  const file = outFileName(name, safeName(d.name), FORMAT_EXT[format]);
  await download(file, bytes, MIME[format]);
  const log = [fileLogLine(tr("export {0}", format.toUpperCase()), file, bytes.length, formatLabel(format))];
  let verified: ExportCheck | undefined;
  if (format === "step" || format === "brep") {
    if (check) {
      verified = await verifyExport(d, bytes, format);
      log.push(`  ${verified.line}`);
    } else log.push(tr("  – kontrola {0} vynechána („bez kontroly“)", format.toUpperCase()));
  }
  return { name: file, mime: MIME[format], bytes: bytes.length, format, log, ...(verified ? { check: verified } : {}) };
}

/* ───────────────────────── výkres, skica ───────────────────────── */
async function exportDrawingFiles(d: CadDoc, cmd: Extract<OutCmd, { kind: "drawing" }>, host: OutHost): Promise<string[]> {
  if (isEmpty(d)) throw new Error(tr("Výkres: model je prázdný – nejdřív vymodelujte díl"));
  const { exportDrawing } = await import("@/cad/drawing-export");
  const log: string[] = [];
  if (!d.drawings?.length) log.push(tr("⚠ dokument zatím nemá výkres – exportuje se výchozí list (pro vlastní list nejdřív „výkres A3 …“ a „kótovat“)"));
  // všechny listy aktivního výkresu jedním souborem jako v GUI (PDF vícestránkové, DXF / DWG / SVG / PNG v ZIPu) – drawing-export.ts
  if (cmd.sheet === "all" && d.drawings?.length) {
    const r = await exportDrawing(d, cmd.format, { sheet: "all" }, (doc, meta, o) => cad.drawing(doc, meta, o), host.drawEnv?.());
    const ext = r.files ? ["zip"] : FORMAT_EXT[cmd.format];
    const base = cmd.name ? cmd.name.replace(new RegExp(`\\.(${[...FORMAT_EXT[cmd.format], "zip"].join("|")})$`, "i"), "") : r.name.replace(/\.[^.]+$/, "");
    const file = outFileName(base, "vykres", ext);
    const bytes = fromBase64(r.base64);
    await download(file, bytes, r.mime);
    const n = r.sheets ?? r.files?.length ?? 1;
    log.push(fileLogLine(tr("výkres {0}, listů {1}", cmd.format.toUpperCase(), n), file, bytes.length, formatLabel(cmd.format) + (r.files ? ` · ZIP: ${r.files.join(", ")}` : "")));
    for (const w of r.warnings ?? []) log.push(`  ⚠ ${w}`);
    return log;
  }
  const sheets: (number | string | undefined)[] = cmd.sheet === "all" ? [undefined] : [cmd.sheet];
  for (const sheet of sheets) {
    const r = await exportDrawing(d, cmd.format, sheet === undefined ? {} : { sheet }, (doc, meta, o) => cad.drawing(doc, meta, o), host.drawEnv?.());
    const ext = FORMAT_EXT[cmd.format];
    const many = sheets.length > 1 && typeof sheet === "number";
    const base = (cmd.name ? cmd.name.replace(new RegExp(`\\.(${ext.join("|")})$`, "i"), "") : r.name.replace(/\.[^.]+$/, "")) + (many ? `_list${sheet}` : "");
    const file = outFileName(base, "vykres", ext);
    const bytes = fromBase64(r.base64);
    await download(file, bytes, r.mime);
    const sheetNo = typeof sheet === "number" ? sheet : sheet === undefined ? null : sheet;
    log.push(fileLogLine(sheetNo === null ? tr("výkres {0}", cmd.format.toUpperCase()) : tr("výkres {0}, list {1}", cmd.format.toUpperCase(), sheetNo), file, bytes.length, formatLabel(cmd.format) + (r.width ? ` ${r.width} × ${r.height} px` : "")));
    for (const w of r.warnings ?? []) log.push(`  ⚠ ${w}`);
  }
  return log;
}

function exportSketchDxf(d: CadDoc, cmd: Extract<OutCmd, { kind: "sketch" }>, host: OutHost): Promise<string[]> | string[] {
  const sketches = d.features.filter((f): f is SketchFeature => f.type === "sketch");
  let sk: SketchFeature | undefined;
  if (cmd.sketch) {
    const n = cmd.sketch.toLowerCase();
    sk = [...sketches].reverse().find((s) => s.id === cmd.sketch || s.name.toLowerCase() === n);
    if (!sk) throw new Error(tr("skica „{0}“ v dokumentu není – skici: {1}", cmd.sketch, sketches.map((s) => s.name).join(", ") || "—"));
  } else {
    const open = host.sketch();
    sk = (open && sketches.find((s) => s.id === open.id)) || sketches[sketches.length - 1];
    if (!sk) throw new Error(tr("dokument nemá žádnou skicu k exportu DXF"));
  }
  if (!sk.entities.length) throw new Error(tr("skica „{0}“ je prázdná", sk.name));
  const s = sk;
  const bytes = new TextEncoder().encode(sketchToDxf(s.entities));
  const file = outFileName(cmd.name, safeName(s.name), ["dxf"]);
  return download(file, bytes, "application/dxf").then(() => [fileLogLine(tr("skica „{0}“", s.name), file, bytes.length, tr("{0}, {1} entit", formatLabel("sketch-dxf"), s.entities.length))]);
}

/* ───────────────────────── sdílení ───────────────────────── */
export type LastLink = { url: string; mode: ShareMode; bytes: number; exp: number | null; name: string; view: ShareView; password: boolean; /** kód krátkého odkazu (část za #) */ code?: string };
let lastLink: LastLink | null = null;
/** poslední sdílený odkaz (příkaz „odkaz“); zapisuje i window.mncad.share() */
export const rememberLink = (l: LastLink) => void (lastLink = l);
export const lastShareLink = () => lastLink;

const withTimeout = <T,>(p: Promise<T>, ms: number, dflt: T) => Promise.race([p.catch(() => dflt), new Promise<T>((r) => setTimeout(() => r(dflt), ms))]);

/** řádky protokolu o odkazu; adresa na samostatném řádku „URL: …“ (stejný tvar ve všech jazycích) */
async function linkLines(l: LastLink, head: string): Promise<string[]> {
  const exp = l.exp ? new Date(l.exp).toLocaleDateString(cadLocale(), { day: "numeric", month: "numeric", year: "numeric" }) : tr("bez omezení");
  const copied = await withTimeout(copyText(l.url), 1500, false);
  return [
    tr("{0} – „{1}“ ({2}), platí do: {3}, {4}, {5} {6}", head, l.name, l.view === "drawing" ? tr("výkres") : tr("model"), exp, l.password ? tr("s heslem") : tr("bez hesla"), fmtBytes(l.bytes), l.mode === "link" ? tr("v odkazu") : tr("v úložišti")),
    `URL: ${l.url}`,
    ...(l.code ? [tr("  kód k přečtení nebo opsání: {0} ({1} znaků odkazu)", groupShareCode(l.code), l.url.length)] : []),
    copied ? tr("  (zkopírováno do schránky)") : tr("  (schránka není dostupná – adresu zkopírujte z protokolu)"),
  ];
}

async function shareDoc(d: CadDoc, cmd: Extract<OutCmd, { kind: "share" }>): Promise<string[]> {
  if (isEmpty(d)) throw new Error(tr("Prázdný dokument nelze sdílet – nejdřív vytvořte nebo otevřete díl."));
  const view: ShareView = cmd.view ?? "model";
  if (view === "drawing" && !d.drawings?.length) throw new Error(tr("sdílet výkres: dokument zatím nemá výkres – nejdřív „výkres A3 …“, nebo sdílejte model"));
  const r = await createShareLink(d, { days: cmd.days === undefined ? SHARE_DEFAULT_DAYS : cmd.days, password: cmd.password || undefined, from: cmd.from || undefined, view, mode: cmd.mode });
  const l: LastLink = { url: r.url, mode: r.mode, bytes: r.bytes, exp: r.exp, name: d.name, view, password: r.password, ...(r.code ? { code: r.code } : {}) };
  rememberLink(l);
  return linkLines(l, tr("✓ sdílený odkaz vytvořen"));
}

/* ───────────────────────── příkaz ───────────────────────── */
/** Provede výstupní příkaz nad dokumentem `d` (dokument běhu textových příkazů); vrátí řádky protokolu. */
export async function runOutCmd(cmd: OutCmd, d: CadDoc, host: OutHost): Promise<string[]> {
  switch (cmd.kind) {
    case "save":
      return (await saveProjectFile(d, cmd.name, host)).log;
    case "export":
      return (await export3d(d, cmd.format, cmd.name, host, cmd.check !== false)).log;
    case "drawing":
      return exportDrawingFiles(d, cmd, host);
    case "sketch":
      return exportSketchDxf(d, cmd, host);
    case "share":
      return shareDoc(d, cmd);
    case "link": {
      if (!lastLink) throw new Error(tr("zatím žádný sdílený odkaz – vytvořte ho příkazem „sdílet“"));
      return linkLines(lastLink, tr("✓ poslední sdílený odkaz"));
    }
  }
}
