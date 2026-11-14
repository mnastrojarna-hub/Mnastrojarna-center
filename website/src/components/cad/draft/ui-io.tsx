"use client";

/**
 * GUI rozšíření 2D výkresu – DWG / DXF (balík 4). Soubor patří balíku; jádro ho jen zařadí do UI_EXTS (ui-exts.ts).
 * Smlouva: website/CAD-2D-NAVRH.md.
 *
 * - karta Výstup, skupina „DWG / DXF“: Otevřít (nová záložka), Vložit výkres (obsah do otevřeného výkresu), Export
 *   (rychlá volba verze) a panel „DWG / DXF“ (formát, verze R12–R2018, binární DXF, název souboru, jednotky INSUNITS,
 *   protokol posledního importu);
 * - průběh čtení velkých souborů s tlačítkem Zrušit (plovoucí okénko – funguje i při otevření z 3D části aplikace);
 * - `openDraftFile` – směrování Otevřít / Ctrl+O / přetažení .dxf a .dwg do 2D výkresu (cad-app.tsx), s volbou
 *   „Otevřít jako 3D skicu“ v hlášce po otevření; `dwgAsDxf` – DWG pro 3D skicu; `importDraftForAgent` –
 *   window.mncad.importFile(…, { as: "draft" }) (agent-api-host.ts).
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { cadLocale, tr } from "@/cad/i18n";
import type { CadDoc } from "@/cad/types";
import { draftDocStatus } from "@/cad/draft/agent";
import { emptyDraftDoc, isDraftDoc, normalizeDraftDoc } from "@/cad/draft/doc";
import { DRAFT_IMPORT_ACCEPT, DXF_VERSIONS, draftExport, draftImport, DraftImportCancelled, ioUiBridge, mergeNoteText, type DraftExportFormat, type DraftExportVersion, type DraftImportResult } from "@/cad/draft/io";
import type { ImportNote } from "@/cad/draft/io/from-cad";
import { mergeDraftInto } from "@/cad/draft/io/merge";
import type { DraftUnits } from "@/cad/draft/model";
import { DraftTx } from "@/cad/draft/tx";
import { UNITS } from "@/cad/draft/units";
import { cn } from "@/lib/cn";
import { CadIcon, type CadIconName } from "../cad-icons";
import type { DraftUiApi, DraftUiExt, RMenuEntry } from "./ui-ext";

// ---------------------------------------------------------------- stav (průběh, poslední import)

type Stage = "read" | "build" | "convert" | "show";
type Job = { name: string; bytes: number; stage: Stage; f: number; t0: number; abort: () => void; mode: "open" | "merge" };
type Done = { text: string; toSketch?: () => void; t: number };
type LastImport = { name: string; format: string; version: string; report: ImportNote; note: string; mode: "open" | "merge"; merge?: string; ms: number };
type IoState = { job: Job | null; done: Done | null; last: LastImport | null };

let state: IoState = { job: null, done: null, last: null };
const subs = new Set<() => void>();
const setIo = (p: Partial<IoState>) => {
  state = { ...state, ...p };
  for (const f of subs) f();
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};
const useIo = () => useSyncExternalStore(subscribe, () => state, () => state);

const STAGE: Record<Stage, () => string> = {
  read: () => tr("čtení souboru"),
  build: () => tr("sestavení výkresu"),
  convert: () => tr("převod entit"),
  show: () => tr("zobrazení výkresu – velký výkres může chvíli trvat"),
};
const mb = (n: number) => (n / 1048576).toLocaleString(cadLocale(), { maximumFractionDigits: 1 });
const sizeText = (n: number) => (n >= 1048576 ? `${mb(n)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);

// ---------------------------------------------------------------- plovoucí okénko průběhu (mimo strom React aplikace)

let root: Root | null = null;
function ensureOverlay() {
  if (root || typeof document === "undefined") return;
  const el = document.createElement("div");
  el.setAttribute("data-io-overlay-root", "");
  document.body.appendChild(el);
  root = createRoot(el);
  root.render(<IoOverlay />);
}

function IoOverlay() {
  const s = useIo();
  const [, tick] = useState(0);
  const [visible, setVisible] = useState(false);
  const t0 = s.job?.t0;
  // průběh až po 250 ms (malé soubory bez probliknutí); čas běží po sekundách
  useEffect(() => {
    setVisible(false);
    if (!t0) return;
    const a = setTimeout(() => setVisible(true), 250);
    const b = setInterval(() => tick((x) => x + 1), 1000);
    return () => {
      clearTimeout(a);
      clearInterval(b);
    };
  }, [t0]);
  const doneT = s.done?.t;
  useEffect(() => {
    if (!doneT) return;
    const a = setTimeout(() => setIo({ done: null }), 15000);
    return () => clearTimeout(a);
  }, [doneT]);
  const box = "fixed top-[118px] left-1/2 z-[95] w-[min(440px,94vw)] -translate-x-1/2 rounded-md border border-[#cfd6de] bg-white p-3 text-[12.5px] text-[#1f2933] shadow-2xl";
  if (s.job && visible) {
    const j = s.job;
    const pct = j.stage === "show" ? 100 : Math.round((j.stage === "convert" ? 0.85 + j.f * 0.15 : j.f * 0.85) * 100);
    return (
      <div className={box} role="status" data-io-progress data-io-stage={j.stage} data-io-pct={pct}>
        <div className="flex items-center gap-2">
          <CadIcon name="open" className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-semibold">{j.mode === "merge" ? tr("Vkládám {0}", j.name) : tr("Otevírám {0}", j.name)}</span>
          <span className="shrink-0 text-[#6b7785]">{sizeText(j.bytes)}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded bg-[#e3e9f0]">
          <div className="h-full bg-brand transition-[width] duration-200" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-[#6b7785]">
          <span className="flex-1">
            {STAGE[j.stage]()} · {pct} % · {tr("{0} s", Math.round((Date.now() - j.t0) / 1000))}
          </span>
          {j.stage !== "show" && (
            <button type="button" data-io-cancel onClick={j.abort} className="rounded border border-[#cfd6de] px-2.5 py-0.5 font-medium text-[#1f2933] hover:bg-[#eef2f6]">
              {tr("Zrušit")}
            </button>
          )}
        </div>
      </div>
    );
  }
  if (s.done && !s.job) {
    const d = s.done;
    return (
      <div className={box} role="status" data-io-done>
        <p className="max-h-32 overflow-auto leading-snug">{d.text}</p>
        <div className="mt-2 flex justify-end gap-2">
          {d.toSketch && (
            <button type="button" data-io-to-sketch onClick={d.toSketch} className="rounded border border-[#cfd6de] px-2.5 py-1 font-medium hover:bg-[#eef2f6]">
              {tr("Otevřít jako 3D skicu")}
            </button>
          )}
          <button type="button" data-io-done-close onClick={() => setIo({ done: null })} className="rounded bg-brand px-3 py-1 font-semibold text-white">
            {tr("OK")}
          </button>
        </div>
      </div>
    );
  }
  return null;
}

// ---------------------------------------------------------------- čtení s průběhem a Zrušit

/** jeden snímek prohlížeče (okénko průběhu se překreslí) */
const frame = () => new Promise<void>((res) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => setTimeout(res, 0)) : setTimeout(res, 0)));
/** konec úlohy (idempotentní) */
const endJob = () => void (state.job && setIo({ job: null }));
/**
 * Po dočtení souboru: okénko průběhu zůstane („zobrazení výkresu“, bez Zrušit), dokud se nová záložka / vložené entity
 * nevykreslí – vykreslení velkého výkresu blokuje hlavní vlákno a bez okénka by aplikace vypadala zamrzlá.
 */
async function showing<T>(fn: () => T): Promise<T> {
  if (state.job) setIo({ job: { ...state.job, stage: "show", f: 1 } });
  await frame(); // okénko se překreslí dřív, než vykreslení zablokuje hlavní vlákno
  try {
    return fn();
  } finally {
    await frame();
    await frame();
    endJob();
  }
}

/** přečte DXF / DWG s průběhem (plovoucí okénko, Zrušit); zrušení = DraftImportCancelled. Úlohu ukončí volající (showing / endJob). */
async function runImport(file: File, mode: "open" | "merge"): Promise<DraftImportResult> {
  if (state.job) throw new Error(tr("Už se načítá jiný soubor ({0}) – počkejte nebo ho zrušte.", state.job.name));
  ensureOverlay();
  const ctrl = new AbortController();
  const t0 = Date.now();
  setIo({ done: null, job: { name: file.name, bytes: file.size, stage: "read", f: 0, t0, abort: () => ctrl.abort(), mode } });
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (ctrl.signal.aborted) throw new DraftImportCancelled();
    const r = await draftImport(file.name, bytes, { signal: ctrl.signal, onProgress: (stage, f) => state.job && setIo({ job: { ...state.job, stage, f } }) });
    setIo({ last: { name: file.name, format: r.format, version: r.version, report: r.report, note: r.note, mode, ms: Date.now() - t0 } });
    return r;
  } catch (e) {
    setIo({ job: null });
    throw e;
  }
}

const baseName = (n: string) => n.replace(/\.[^.]+$/, "");

/**
 * Otevře DXF / DWG jako 2D výkres v nové záložce (Otevřít, Ctrl+O, přetažení). `asSketch` = nabídnout v hlášce
 * „Otevřít jako 3D skicu“ (cad-app; DXF / DWG do skici jen touto volbou).
 */
export async function openDraftFile(file: File, deps: { openDoc: (d: CadDoc) => void; flash: (s: string) => void; asSketch?: (f: File) => void }): Promise<void> {
  try {
    const r = await runImport(file, "open");
    await showing(() => deps.openDoc(normalizeDraftDoc({ ...emptyDraftDoc(baseName(file.name)), draft: r.model })));
    const text = `${file.name}: ${r.note}`;
    if (deps.asSketch) {
      const to = deps.asSketch;
      setIo({ done: { text, t: Date.now(), toSketch: () => (setIo({ done: null }), to(file)) } });
    } else deps.flash(text);
  } catch (e) {
    if (e instanceof DraftImportCancelled) deps.flash(tr("Otevírání souboru {0} zrušeno.", file.name));
    else deps.flash((e as Error).message);
  } finally {
    endJob();
  }
}

/** DWG → DXF R2018 (pro 3D skicu, která čte DXF); chyba = hláška a null */
export async function dwgAsDxf(file: File, flash?: (s: string) => void): Promise<File | null> {
  try {
    const r = await runImport(file, "open");
    const f = await draftExport(r.model, "dxf", { name: baseName(file.name), version: "R2018" });
    return new File([f.data as BlobPart], `${baseName(file.name)}.dxf`);
  } catch (e) {
    flash?.(e instanceof DraftImportCancelled ? tr("Otevírání souboru {0} zrušeno.", file.name) : (e as Error).message);
    return null;
  } finally {
    endJob();
  }
}

/** window.mncad.importFile(soubor, { as: "draft" }): 2D výkres v nové záložce; vrátí protokol + stav výkresu */
export async function importDraftForAgent(file: File, open: (d: CadDoc) => void, current: () => CadDoc): Promise<string> {
  const r = await runImport(file, "open");
  let d: CadDoc;
  try {
    d = normalizeDraftDoc({ ...emptyDraftDoc(baseName(file.name)), draft: r.model });
    await showing(() => open(d));
  } finally {
    endJob();
  }
  // záložka se přepne až po vykreslení – další příkaz agenta už musí pracovat s novým výkresem
  for (let i = 0; i < 200 && current().draft?.id !== d.draft!.id; i++) await new Promise((res) => setTimeout(res, 25));
  const now = current();
  return [tr("✓ {0} otevřen jako 2D výkres „{1}“ (nová záložka) · {2}", file.name, d.name, r.note), "", draftDocStatus(isDraftDoc(now) ? now : d)].join("\n");
}

// ---------------------------------------------------------------- pás karet a panel

/** poslední rozhraní pracovní plochy (vložení výkresu po dočtení souboru pracuje s aktuálním modelem) */
let apiNow: DraftUiApi | null = null;

function pickFile(cb: (f: File) => void) {
  const i = document.createElement("input");
  i.type = "file";
  i.accept = DRAFT_IMPORT_ACCEPT;
  i.style.display = "none";
  i.setAttribute("data-io-file", "");
  document.body.appendChild(i);
  i.onchange = () => {
    const f = i.files?.[0];
    i.remove();
    if (f) cb(f);
  };
  i.addEventListener("cancel", () => i.remove());
  i.click();
}

/** vloží obsah výkresu do otevřeného výkresu (aktuální prostor, jeden krok historie, vložené entity vybrané) */
async function mergeFile(file: File) {
  const flash = (s: string) => apiNow?.flash(s);
  try {
    const r = await runImport(file, "merge");
    const api = apiNow;
    if (!api) return;
    const tx = new DraftTx(api.model, api.space);
    const rep = mergeDraftInto(tx, r.model);
    await showing(() => {
      api.commit(tx.model);
      api.select(rep.selectable);
    });
    const text = mergeNoteText(file.name, rep);
    if (state.last) setIo({ last: { ...state.last, merge: text } });
    api.flash(text);
    setTimeout(() => apiNow?.zoomExtents(), 0);
  } catch (e) {
    flash(e instanceof DraftImportCancelled ? tr("Vkládání souboru {0} zrušeno.", file.name) : (e as Error).message);
  } finally {
    endJob();
  }
}

const openIn = (mode: "open" | "merge") =>
  pickFile((f) => {
    const api = apiNow;
    if (!api) return;
    if (mode === "merge") void mergeFile(f);
    else void openDraftFile(f, { openDoc: api.openDoc, flash: api.flash });
  });

const VER_HINT: Record<DraftExportVersion, string> = {
  R2018: "AutoCAD 2018+ (AC1032)",
  R2013: "AutoCAD 2013–2017 (AC1027)",
  R2010: "AutoCAD 2010–2012 (AC1024)",
  R2007: "AutoCAD 2007–2009 (AC1021)",
  R2004: "AutoCAD 2004–2006 (AC1018)",
  R2000: "AutoCAD 2000–2002 (AC1015)",
  R12: "R12 (AC1009)",
};

/** textový příkaz exportu (stejná cesta jako příkazový řádek a agenti) */
export function exportLine(fmt: DraftExportFormat, version: DraftExportVersion, binary: boolean, name?: string): string {
  const n = (name ?? "").replace(/["„“”]/g, "").trim();
  return `export ${fmt} verze ${version}${binary && fmt === "dxf" && version !== "R12" ? " binární" : ""}${n ? ` název "${n}"` : ""}`;
}

const UNIT_LIST: DraftUnits[] = ["mm", "cm", "m", "in", "ft", "unitless"];

function IoPanel({ api }: { api: DraftUiApi }) {
  const s = useIo();
  const [fmt, setFmt] = useState<DraftExportFormat>("dxf");
  const [ver, setVer] = useState<DraftExportVersion>("R2018");
  const [bin, setBin] = useState(false);
  const [name, setName] = useState(api.doc.name);
  const vers = fmt === "dxf" ? DXF_VERSIONS : DXF_VERSIONS.filter((v) => v !== "R12");
  const v = vers.includes(ver) ? ver : "R2018";
  const canBin = fmt === "dxf" && v !== "R12";
  const sel = "w-full rounded border border-[#cfd6de] bg-white px-1.5 py-1 text-[12px] outline-none focus:border-brand";
  const h = "mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wider text-[#6b7785] first:mt-0";
  const last = s.last;
  const list = (r: Record<string, number>) => Object.entries(r).map(([k, n]) => `${k} ${n}`).join(", ");
  return (
    <div className="space-y-1 p-2.5 text-[12px]" data-io-panel>
      <p className={h}>{tr("Export")}</p>
      <div className="flex gap-1" role="radiogroup" aria-label={tr("Formát")}>
        {(["dxf", "dwg"] as const).map((f) => (
          <button key={f} type="button" role="radio" aria-checked={fmt === f} data-io-fmt={f} onClick={() => setFmt(f)} className={cn("flex-1 rounded border px-2 py-1 font-semibold", fmt === f ? "border-brand bg-[#fde3e1] text-brand" : "border-[#cfd6de] hover:bg-[#eef2f6]")}>
            {f.toUpperCase()}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="text-[#6b7785]">{tr("Verze")}</span>
        <select className={sel} value={v} onChange={(e) => setVer(e.target.value as DraftExportVersion)} data-io-ver>
          {vers.map((x) => (
            <option key={x} value={x}>
              {VER_HINT[x]}
            </option>
          ))}
        </select>
      </label>
      <label className={cn("flex items-center gap-2", !canBin && "opacity-40")}>
        <input type="checkbox" checked={canBin && bin} disabled={!canBin} onChange={(e) => setBin(e.target.checked)} data-io-bin />
        {tr("binární DXF (menší, rychlejší čtení)")}
      </label>
      <label className="block">
        <span className="text-[#6b7785]">{tr("Název souboru")}</span>
        <input className={sel} value={name} onChange={(e) => setName(e.target.value)} data-io-name />
      </label>
      <button type="button" data-io-export-go onClick={() => void api.run(exportLine(fmt, v, canBin && bin, name))} className="mt-1 flex w-full items-center justify-center gap-1.5 rounded bg-brand px-3 py-1.5 font-semibold text-white hover:bg-brand-600">
        <CadIcon name="export" className="h-4 w-4" />
        {tr("Exportovat {0}", `${fmt.toUpperCase()} ${v}${canBin && bin ? ` ${tr("binární")}` : ""}`)}
      </button>
      <p className="text-[11px] leading-snug text-[#6b7785]">
        {fmt === "dwg" ? tr("DWG R2000–R2018: bloky, kóty s geometrií, šrafy, rozvržení, XDATA. Čeština do R2004 jako \\U+.") : v === "R12" ? tr("R12: jen základní entity (křivky jako POLYLINE, MTEXT jako TEXT, šrafy rozložené) – pro CAM a staré programy.") : tr("DXF R2000–R2018 zachová všechny druhy entit, tabulky, bloky, rozvržení a XDATA.")}
      </p>

      <p className={h}>{tr("Jednotky výkresu (INSUNITS)")}</p>
      <select className={sel} value={api.model.vars.units} onChange={(e) => void api.run(`jednotky ${e.target.value}`)} data-io-units>
        {UNIT_LIST.map((u) => (
          <option key={u} value={u}>
            {u === "unitless" ? tr("bez jednotek") : UNITS[u].label}
          </option>
        ))}
      </select>
      <p className="text-[11px] leading-snug text-[#6b7785]">{tr("Jednotky se ukládají do DWG / DXF ($INSUNITS); geometrie se nepřepočítává. Při vložení výkresu s jinými jednotkami se jeho obsah převede měřítkem.")}</p>

      <p className={h}>{tr("Import")}</p>
      <div className="flex gap-1">
        <button type="button" onClick={() => openIn("open")} className="flex flex-1 items-center justify-center gap-1 rounded border border-[#cfd6de] px-2 py-1 hover:bg-[#eef2f6]" data-io-panel-open>
          <CadIcon name="open" className="h-4 w-4" />
          {tr("Otevřít…")}
        </button>
        <button type="button" onClick={() => openIn("merge")} className="flex flex-1 items-center justify-center gap-1 rounded border border-[#cfd6de] px-2 py-1 hover:bg-[#eef2f6]" data-io-panel-insert>
          <CadIcon name="import" className="h-4 w-4" />
          {tr("Vložit do výkresu…")}
        </button>
      </div>
      {s.job && (
        <div className="flex items-center gap-2 rounded bg-[#eef2f6] px-2 py-1">
          <span className="flex-1 truncate">
            {s.job.name}: {STAGE[s.job.stage]()}
          </span>
          <button type="button" onClick={s.job.abort} className="rounded border border-[#cfd6de] bg-white px-2 py-0.5">
            {tr("Zrušit")}
          </button>
        </div>
      )}
      {last ? (
        <div className="rounded border border-[#e3e9f0] bg-[#f8fafc] p-2 leading-snug" data-io-last>
          <p className="font-semibold">
            {last.name} · {last.version || last.format.toUpperCase()} · {tr("{0} s", (last.ms / 1000).toLocaleString(cadLocale(), { maximumFractionDigits: 1 }))}
          </p>
          <p>{tr("Entit {0}, hladin {1}, bloků {2}, rozvržení {3}", last.report.entities, last.report.layers, last.report.blocks, last.report.layouts)}</p>
          {Object.keys(last.report.converted).length > 0 && <p>{tr("Převedeno: {0}", list(last.report.converted))}</p>}
          {Object.keys(last.report.kept).length > 0 && <p>{tr("Uchováno pro zápis zpět: {0}", list(last.report.kept))}</p>}
          {Object.keys(last.report.skipped).length > 0 && <p className="text-brand">{tr("Nepřevedeno: {0}", list(last.report.skipped))}</p>}
          {last.report.warnings.length > 0 && <p className="text-[#8a5a00]">⚠ {last.report.warnings.slice(0, 4).join("; ")}</p>}
          {last.merge && <p className="mt-1 border-t border-[#e3e9f0] pt-1">{last.merge}</p>}
        </div>
      ) : (
        <p className="text-[11px] text-[#6b7785]">{tr("DWG R2000–R2018 a DXF R12–R2018 (ASCII i binární). Velké soubory se čtou na pozadí s průběhem.")}</p>
      )}
    </div>
  );
}

const quickExport = (api: DraftUiApi): RMenuEntry[] => [
  { divider: true, label: "DXF" },
  ...DXF_VERSIONS.map((v) => ({ id: `dxf-${v}`, label: `DXF ${VER_HINT[v]}`, icon: "export" as CadIconName, onClick: () => void api.run(exportLine("dxf", v, false)) })),
  { id: "dxf-bin", label: tr("DXF binární (R2018)"), icon: "export" as CadIconName, onClick: () => void api.run(exportLine("dxf", "R2018", true)) },
  { divider: true, label: "DWG" },
  ...DXF_VERSIONS.filter((v) => v !== "R12").map((v) => ({ id: `dwg-${v}`, label: `DWG ${VER_HINT[v]}`, icon: "export" as CadIconName, onClick: () => void api.run(exportLine("dwg", v, false)) })),
  { divider: true },
  { id: "opts", label: tr("Možnosti exportu…"), icon: "settings" as CadIconName, onClick: () => api.openPanel("io") },
];

export const ioUi: DraftUiExt = {
  id: "io",
  ribbon: (api) => {
    apiNow = api;
    ioUiBridge.open = (o) => openIn(o.merge ? "merge" : "open");
    return {
      output: [
        {
          label: tr("DWG / DXF"),
          big: 3,
          items: [
            { id: "io-open", label: tr("Otevřít DXF / DWG"), icon: "open", tone: "file", kbd: "Ctrl+O", hint: tr("nová záložka, průběh a Zrušit u velkých souborů"), onClick: () => openIn("open") },
            { id: "io-insert", label: tr("Vložit výkres"), icon: "import", tone: "file", hint: tr("obsah DXF / DWG do otevřeného výkresu (vybrané, jeden krok zpět)"), onClick: () => openIn("merge") },
            { id: "io-export", label: tr("Uložit jako…"), icon: "export", tone: "file", hint: tr("DWG / DXF ve zvolené verzi (R12–R2018, binární DXF)"), menu: quickExport(api) },
            { id: "io-panel", label: tr("Možnosti DWG / DXF"), icon: "settings", active: false, onClick: () => api.openPanel("io") },
          ],
        },
      ],
    };
  },
  panels: {
    io: { title: () => tr("DWG / DXF"), icon: "file", render: (api) => <IoPanel api={api} /> },
  },
};
