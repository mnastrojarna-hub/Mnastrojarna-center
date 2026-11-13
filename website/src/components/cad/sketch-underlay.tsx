"use client";

/**
 * Podklad skici v prohlížeči: načtení obrázku / stránky PDF do bitmapy (zmenšení podle cad/sketch-underlay.ts),
 * převod vektorových čar stránky PDF na entity skici (cad/pdf-vector.ts), vykreslení pod geometrií a panel podkladu.
 * Čtečka PDF (pdf.js) se načítá líně z /public/vendor (cad/pdfjs.ts); když se ji nepodaří načíst, ohlásí se to česky
 * a obrázkové podklady fungují dál.
 */
import { cadLocale, tr } from "@/cad/i18n";
import { extractPdfPaths, pdfPathsToEntities, type Mat, type PdfEntities } from "@/cad/pdf-vector";
import { loadPdfJs, pdfDocOptions } from "@/cad/pdfjs";
import { UNDERLAY_MAX_SIDE, newUnderlay, pdfPageUnderlay, pdfScaleLabel, pdfToSketch, rotateUnderlay, setUnderlayWidth, shrinkToFit, underlayMatrix, underlayWidth, type BitmapEncode } from "@/cad/sketch-underlay";
import type { SketchEntity, SketchUnderlay, Vec2 } from "@/cad/types";
import { cn } from "@/lib/cn";
import { useEffect, useRef, useState } from "react";
import { CadIcon } from "./cad-icons";

export const UNDERLAY_ACCEPT = "image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf";
export const isPdfFile = (f: { type: string; name?: string }) => f.type === "application/pdf" || /\.pdf$/i.test(f.name ?? "");
export const isImageFile = (f: { type: string; name?: string }) => /^image\/(png|jpeg|pjpeg)$/.test(f.type) || /\.(png|jpe?g)$/i.test(f.name ?? "");

// ======================= PDF soubory relace =======================

/**
 * Původní PDF podkladů této relace (id podkladu → data). Do dokumentu se ukládá jen vykreslená bitmapa; převod čar na
 * entity a změna stránky potřebují původní soubor – po znovunačtení aplikace ho uživatel vybere znovu.
 */
const pdfFiles = new Map<string, Uint8Array>();
export function rememberPdf(id: string, data: Uint8Array) {
  pdfFiles.delete(id);
  pdfFiles.set(id, data);
  // drží se jen posledních několik souborů (každý může mít desítky MB)
  while (pdfFiles.size > 4) pdfFiles.delete(pdfFiles.keys().next().value as string);
}
export const pdfOf = (id: string): Uint8Array | null => pdfFiles.get(id) ?? null;

// ======================= bitmapy =======================

/** Plátno w × h s bílým pozadím (JPEG neumí průhlednost, průhledné PNG by bylo černé). */
function whiteCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error(tr("Prohlížeč neumí kreslit do plátna (canvas) – podklad nelze vložit."));
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  return { c, ctx };
}

/** Kodér pro shrinkToFit: stejný rozměr se vykreslí jen jednou (PNG i JPEG různé kvality se zkoušejí nad týmž obrazem). */
function cachedEncoder(draw: (ctx: CanvasRenderingContext2D, w: number, h: number, c: HTMLCanvasElement) => Promise<void> | void): BitmapEncode {
  let last: { w: number; h: number; c: HTMLCanvasElement } | null = null;
  return async (w, h, type, quality) => {
    if (!last || last.w !== w || last.h !== h) {
      const { c, ctx } = whiteCanvas(w, h);
      await draw(ctx, w, h, c);
      last = { w, h, c };
    }
    return last.c.toDataURL(type, quality);
  };
}

async function decodeImage(file: Blob): Promise<{ img: CanvasImageSource; w: number; h: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const b = await createImageBitmap(file);
      return { img: b, w: b.width, h: b.height, close: () => b.close() };
    } catch {
      /* zkusí se <img> */
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(tr("Obrázek se nepodařilo načíst (poškozený soubor nebo nepodporovaný formát)."));
  }
  return { img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

/** Obrázek (PNG / JPG) jako podklad: zmenšený do limitu, vejde se do 80 % okna `fit` [mm] se středem `center`. */
export async function imageUnderlay(file: Blob & { name?: string }, at: { center: Vec2; fit: [number, number] }): Promise<SketchUnderlay> {
  const im = await decodeImage(file);
  try {
    if (!(im.w > 0 && im.h > 0)) throw new Error(tr("Obrázek je prázdný."));
    const enc = cachedEncoder((ctx, w, h) => {
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(im.img, 0, 0, w, h);
    });
    const b = await shrinkToFit(im.w, im.h, enc);
    return newUnderlay({ src: b.src, w: b.w, h: b.h, name: file.name || undefined, center: at.center, fit: at.fit });
  } finally {
    im.close();
  }
}

// ======================= PDF =======================

type PdfJsLib = Awaited<ReturnType<typeof loadPdfJs>>;
type OpenPdf = { pdfjs: PdfJsLib; pdf: Awaited<ReturnType<PdfJsLib["getDocument"]>["promise"]>; destroy: () => Promise<void> };

async function openPdf(data: Uint8Array): Promise<OpenPdf> {
  const pdfjs = await loadPdfJs(); // při neúspěchu česká chyba „Čtečku PDF se nepodařilo načíst.“
  // pdf.js předává data do svého workeru (původní pole by se vyprázdnilo) – posílá se kopie
  const task = pdfjs.getDocument(pdfDocOptions(data.slice()));
  try {
    const pdf = await task.promise;
    return { pdfjs, pdf, destroy: () => task.destroy().catch(() => undefined) };
  } catch (e) {
    await task.destroy().catch(() => undefined);
    throw new Error((e as { name?: string })?.name === "PasswordException" ? tr("PDF je chráněné heslem – podklad z něj nelze vložit.") : tr("PDF se nepodařilo přečíst (poškozený soubor?)."));
  }
}

/** Stránka PDF jako podklad ve skutečné velikosti (1:1); delší strana bitmapy UNDERLAY_MAX_SIDE px. */
export async function pdfUnderlay(data: Uint8Array, pageNo: number, name: string | undefined, center: Vec2): Promise<SketchUnderlay> {
  const doc = await openPdf(data);
  try {
    const n = Math.min(Math.max(1, Math.round(pageNo) || 1), doc.pdf.numPages);
    const page = await doc.pdf.getPage(n);
    const vp1 = page.getViewport({ scale: 1 });
    const k0 = UNDERLAY_MAX_SIDE / Math.max(vp1.width, vp1.height);
    // každá velikost se vykreslí přímo (ne zmenšením větší bitmapy): pixel = bod stránky × (w / šířka stránky) přesně
    const enc = cachedEncoder(async (_ctx, w, _h, c) => {
      await page.render({ canvas: c, viewport: page.getViewport({ scale: w / vp1.width }) }).promise;
    });
    const b = await shrinkToFit(Math.round(vp1.width * k0), Math.round(vp1.height * k0), enc);
    page.cleanup();
    return pdfPageUnderlay({ src: b.src, w: b.w, h: b.h, pxPerPt: b.w / vp1.width, name, center, page: n, pages: doc.pdf.numPages });
  } finally {
    await doc.destroy();
  }
}

/**
 * Vektorové čáry stránky podkladu → entity skici v měřítku, poloze a natočení podkladu. `data` = původní PDF; když
 * stránka neodpovídá podkladu (jiný soubor), vyhodí chybu.
 */
export async function pdfPageEntities(data: Uint8Array, u: SketchUnderlay, o: { construction?: boolean } = {}): Promise<PdfEntities> {
  const doc = await openPdf(data);
  try {
    const n = u.page ?? 1;
    if (n > doc.pdf.numPages) throw new Error(tr("Vybrané PDF nemá stránku {0} – neodpovídá podkladu.", n));
    const page = await doc.pdf.getPage(n);
    const vp1 = page.getViewport({ scale: 1 });
    const k = u.pxPerPt ?? 0;
    if (Math.abs(vp1.width * k - u.w) > 2 || Math.abs(vp1.height * k - u.h) > 2) throw new Error(tr("Vybrané PDF neodpovídá podkladu (stránka {0} má jiný rozměr).", n));
    const ops = await page.getOperatorList();
    const paths = extractPdfPaths(ops, doc.pdfjs.OPS as unknown as Record<string, number>, vp1.transform as Mat);
    const r = pdfPathsToEntities(paths, pdfToSketch(u));
    page.cleanup();
    return o.construction ? { ...r, entities: r.entities.map((e) => ({ ...e, construction: true }) as SketchEntity) } : r;
  } finally {
    await doc.destroy();
  }
}

/** Souhrn převodu pro uživatele: kolik čeho vzniklo. */
export function pdfEntitiesSummary(r: PdfEntities): string {
  const c = (t: SketchEntity["type"][]) => r.entities.filter((e) => t.includes(e.type)).length;
  const s = tr("Z PDF vloženo entit: {0} (úsečky a lomené čáry {1}, oblouky a kružnice {2}, křivky {3}).", r.entities.length, c(["line", "polyline"]), c(["arc", "circle"]), c(["spline"]));
  return r.found > r.entities.length ? s + tr(" Stránka má {0} čar – vloženo {1} nejdelších.", r.found, r.entities.length) : s;
}

// ======================= vykreslení =======================

/** Bitmapa podkladu uvnitř skupiny SVG kreslící v mm skici (osa Y nahoru). Nepřijímá kliknutí. */
export function UnderlayImage({ u }: { u: SketchUnderlay }) {
  return <image data-sketch-underlay-img href={u.src} x={0} y={0} width={u.w} height={u.h} preserveAspectRatio="none" transform={`matrix(${underlayMatrix(u).join(",")})`} opacity={u.opacity} pointerEvents="none" />;
}

// ======================= panel =======================

export type UnderlayMode = "calib" | "move" | null;

const num = (v: number, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(cadLocale());
const parse = (s: string) => Number(s.trim().replace(/\s/g, "").replace(",", "."));

/** Číselné pole, které změnu potvrdí Enterem nebo opuštěním (Esc vrátí původní hodnotu). */
function NumField({ value, onCommit, suffix, title, data }: { value: number; onCommit: (v: number) => void; suffix: string; title: string; data: string }) {
  const [t, setT] = useState<string | null>(null);
  const shown = t ?? num(value, 3);
  const done = () => {
    if (t == null) return;
    const v = parse(t);
    setT(null);
    if (Number.isFinite(v)) onCommit(v);
  };
  return (
    <label className="flex items-center gap-1" title={title}>
      <input
        {...{ [data]: "" }}
        value={shown}
        onChange={(e) => setT(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={done}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") done();
          if (e.key === "Escape") setT(null);
        }}
        className="h-6 w-[72px] rounded border border-[#cfd6de] px-1.5 text-right font-mono text-[11.5px] outline-none focus:border-[#2563eb]"
      />
      <span className="text-[#6b7785]">{suffix}</span>
    </label>
  );
}

/**
 * Panel podkladu skici: vložení / výměna / odebrání, zobrazení a krytí, kalibrace měřítka dvěma body, posun tažením,
 * natočení a šířka číslem, u stránky PDF volba stránky a převod čar na entity. Změny posílá jako `commit` (záznam
 * v historii); posuvník krytí při tažení jen `draft` (náhled bez historie) a hodnotu potvrdí po puštění.
 */
export function UnderlayPanel(p: {
  u: SketchUnderlay | null;
  busy: string | null;
  error: string | null;
  mode: UnderlayMode;
  calibN: number;
  construction: boolean;
  setConstruction: (v: boolean) => void;
  commit: (u: SketchUnderlay | null) => void;
  draft: (u: SketchUnderlay | null) => void;
  pick: () => void;
  setMode: (m: UnderlayMode) => void;
  setPage: (n: number) => void;
  convert: () => void;
  close: () => void;
}) {
  const { u } = p;
  const range = useRef<HTMLInputElement>(null);
  const op = useRef<number | null>(null);
  // posuvník: „input“ = náhled, „change“ (puštění myši, klávesa, vyplnění) = uložit
  const latest = useRef({ u, commit: p.commit });
  latest.current = { u, commit: p.commit };
  useEffect(() => {
    const el = range.current;
    if (!el) return;
    const onChange = () => {
      const cur = latest.current.u;
      if (cur && op.current != null) latest.current.commit({ ...cur, opacity: op.current });
      op.current = null;
    };
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, [u?.id]);
  const btn = "rounded border border-[#cfd6de] px-2 py-0.5 text-[11.5px] hover:bg-[#eef2f6] disabled:opacity-40";
  const on = "border-[#2563eb] bg-[#dbeafe] text-[#1d4ed8]";
  const scale = u ? pdfScaleLabel(u, (v) => num(v, 3)) : null;
  return (
    <div data-sketch-underlay className="absolute right-3 top-3 z-20 w-[290px] rounded-md border border-[#cfd6de] bg-white/95 p-3 text-[12px] shadow-lg backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
      <p className="mb-1.5 flex items-center gap-1.5 font-semibold">
        <CadIcon name="layers" tone="file" className="h-4 w-4" />
        {tr("Podklad skici")}
        <span className="flex-1" />
        <button type="button" title={tr("Zavřít panel (podklad zůstane)")} onClick={p.close} className="rounded px-1 text-[#6b7785] hover:bg-[#eef2f6]">
          ×
        </button>
      </p>
      {!u && <p className="mb-2 text-[#6b7785]">{tr("Obrázek (PNG, JPG) nebo stránka PDF pod geometrií skici – k obkreslení, s kalibrací měřítka; čáry vektorového PDF lze převést na entity. Velké obrázky se zmenší na nejvýše {0} px.", UNDERLAY_MAX_SIDE)}</p>}
      {u && (
        <div className="space-y-1.5">
          <p className="truncate text-[#26303b]" title={u.name}>
            {u.name ?? tr("obrázek")}
            {u.page ? <span className="text-[#6b7785]">{tr(" · strana {0} z {1}", u.page, u.pages ?? 1)}</span> : null}
          </p>
          <p data-ul-size className="text-[#6b7785]">
            {tr("{0} × {1} mm", num(underlayWidth(u)), num(u.h * u.mmPerPx))}
            {scale ? tr(" · měřítko {0}", scale) : ""}
            {u.angle ? ` · ${num(u.angle)}°` : ""}
          </p>
          <div className="flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1">
              <input data-ul-visible type="checkbox" checked={!u.hidden} onChange={(e) => p.commit({ ...u, hidden: e.target.checked ? undefined : true })} />
              {tr("Zobrazit")}
            </label>
            <input
              ref={range}
              data-ul-opacity
              type="range"
              min={5}
              max={100}
              step={5}
              value={Math.round(u.opacity * 100)}
              title={tr("Krytí podkladu")}
              onChange={(e) => {
                op.current = Number(e.target.value) / 100;
                p.draft({ ...u, opacity: op.current });
              }}
              className="min-w-0 flex-1 accent-[#2563eb]"
            />
            <span className="w-9 text-right font-mono text-[11px]">{Math.round(u.opacity * 100)} %</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <NumField data="data-ul-angle" title={tr("Natočení podkladu kolem jeho středu (kladně proti směru hodin)")} value={u.angle} suffix="°" onCommit={(v) => p.commit(rotateUnderlay(u, v))} />
            <NumField data="data-ul-width" title={tr("Šířka podkladu – mění měřítko kolem středu")} value={underlayWidth(u)} suffix="mm" onCommit={(v) => v > 0 && p.commit(setUnderlayWidth(u, v))} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" data-ul-calib className={cn(btn, p.mode === "calib" && on)} onClick={() => p.setMode(p.mode === "calib" ? null : "calib")} title={tr("Klikněte na dva body podkladu se známou vzdáleností a zadejte ji")}>
              {tr("Kalibrovat měřítko")}
            </button>
            <button type="button" data-ul-move className={cn(btn, p.mode === "move" && on)} onClick={() => p.setMode(p.mode === "move" ? null : "move")} title={tr("Táhněte podklad myší")}>
              {tr("Posunout")}
            </button>
          </div>
          {p.mode && (
            <p data-ul-hint className="rounded bg-[#eff6ff] px-1.5 py-1 text-[#1d4ed8]">
              {p.mode === "calib" ? (p.calibN ? tr("Klikněte na druhý bod podkladu (Esc zruší).") : tr("Klikněte na první bod podkladu se známou vzdáleností (Esc zruší).")) : tr("Táhněte podklad myší; Esc nebo „Posunout“ režim ukončí.")}
            </p>
          )}
          {u.page != null && (
            <div className="space-y-1 border-t border-[#edf1f5] pt-1.5">
              {(u.pages ?? 1) > 1 && (
                <div className="flex items-center gap-1">
                  <span className="text-[#6b7785]">{tr("Stránka")}</span>
                  <button type="button" className={btn} disabled={!!p.busy || u.page <= 1} onClick={() => p.setPage(u.page! - 1)}>
                    ‹
                  </button>
                  <span data-ul-page className="w-12 text-center font-mono">
                    {u.page} / {u.pages}
                  </span>
                  <button type="button" className={btn} disabled={!!p.busy || u.page >= (u.pages ?? 1)} onClick={() => p.setPage(u.page! + 1)}>
                    ›
                  </button>
                </div>
              )}
              <button type="button" data-ul-convert disabled={!!p.busy} onClick={p.convert} className="w-full rounded bg-[#2563eb] px-2.5 py-1 text-[11.5px] font-semibold text-white disabled:opacity-40" title={tr("Úsečky, oblouky a křivky stránky PDF se vloží jako entity skici v aktuálním měřítku a poloze podkladu")}>
                {tr("Převést čáry na entity skici")}
              </button>
              <label className="flex cursor-pointer items-center gap-1.5 text-[#6b7785]">
                <input type="checkbox" checked={p.construction} onChange={(e) => p.setConstruction(e.target.checked)} />
                {tr("jako pomocnou geometrii")}
              </label>
            </div>
          )}
        </div>
      )}
      {p.busy && <p data-ul-busy className="mt-1.5 text-[#1d4ed8]">{p.busy}</p>}
      {p.error && (
        <p data-ul-error className="mt-1.5 text-red-600">
          {p.error}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" data-ul-pick disabled={!!p.busy} onClick={p.pick} className={cn(btn, !u && "border-[#2563eb] bg-[#2563eb] font-semibold text-white hover:bg-[#1d4ed8]")}>
          {u ? tr("Vyměnit…") : tr("Vložit obrázek / PDF…")}
        </button>
        {u && (
          <button type="button" data-ul-remove disabled={!!p.busy} onClick={() => p.commit(null)} className={cn(btn, "text-red-700")}>
            {tr("Odebrat podklad")}
          </button>
        )}
      </div>
    </div>
  );
}
