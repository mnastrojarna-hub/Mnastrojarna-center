"use client";

/**
 * Výkresové prostředí (jako list výkresu v ZW3D / Inventoru): vlevo nastavení listu, pohledů, řezu,
 * kót a razítka; uprostřed živý náhled listu (kolečko = zoom, tažení = posun); nahoře export PDF / DWG / DXF / SVG / tisk.
 */
import { cadLocale, tr } from "@/cad/i18n";
import { saveFile } from "@/lib/save-file";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { cad } from "@/cad/client";
import { angleGeom, annotationGeometry, annotationStatus, annToSheet, bomToCsv, defaultDrawingOptions, dimFromPicks, GDT_LABEL, isRadialDim, LAYER_STYLE, pickViewEnt, scaleLabel, sheetToAnn, STANDARD_SCALES, VIEW_LABEL, viewAt, withAnnotations, type BalloonItem, type BomItem, type DetailView, type DimAnn, type DimPick, type DimSel, type DrawingMeta, type DrawingOptions, type DrawingResult, type ModelView, type NewDim, type PlacedView, type RevisionItem, type SheetName, type ViewKey, type ViewRotation } from "@/cad/drawing";
import { threadsOfDoc } from "@/cad/drawing-doc";
import { dimCheck } from "@/cad/dim-check";
import { mergeSmart, NEW_DRAWING_OPTIONS } from "@/cad/drawing-agent";
import type { SmartDims } from "@/cad/drawing-dims";
import { DWG_VERSIONS, type DwgVersion } from "@/cad/formats/dwg-versions";
import { uid, type CadDoc, type DrawingAnnotation, type DrawingDoc, type GdtSymbol, type PlaneName, type Vec2, type Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";

type Props = {
  doc: CadDoc;
  massKg?: number;
  materialLabel: string;
  onClose: () => void;
  /** sdílení odkazem (dialog otevírá aplikace) */
  onShare?: () => void;
  /** změna označení materiálu v razítku – uloží se do dokumentu (sdílí se s odkazem i souborem) */
  onMaterialChange?: (name: string) => void;
  /** kusovník sestavy (volitelné) */
  bom?: BomItem[];
  /** obálka modelu – pro výchozí polohu řezu */
  bbox?: [Vec3, Vec3];
  /** uložení údajů razítka zpět do dokumentu */
  onPropsChange?: (p: NonNullable<CadDoc["props"]>) => void;
  /** výkresy uložené v dokumentu (volby, razítko, kóty a poznámky) */
  drawings?: DrawingDoc[];
  onDrawingsChange?: (d: DrawingDoc[]) => void;
  /** komponenty sestavy pro pozice (balónky): světové obalové kvádry */
  balloons?: BalloonItem[];
};

type AnnTool = "dim" | "note" | "roughness" | "gdt" | "datum" | "text" | "detail";
type DimKind = "auto" | "aligned" | "horizontal" | "vertical";
/** kóta kružnice / oblouku: auto = kružnice průměrem, oblouk poloměrem */
type CircKind = "auto" | "diameter" | "radius";
const ANN_TOOLS: { id: AnnTool; label: string; kbd: string; hint: string }[] = [
  { id: "dim", label: tr("Kóta"), kbd: "D", hint: `${tr("kružnice → Ø / R, hrana → délka, 2 hrany → úhel")} · ${tr("2 body + umístění kótovací čáry")}` },
  { id: "note", label: tr("Poznámka"), kbd: "N", hint: tr("odkazová čára + text") },
  { id: "roughness", label: tr("Drsnost"), kbd: "R", hint: tr("značka ISO 1302 na povrch") },
  { id: "gdt", label: tr("Geom. tolerance"), kbd: "G", hint: tr("rámeček ISO 1101 s odkazem") },
  { id: "datum", label: tr("Základna"), kbd: "B", hint: tr("A, B, C…") },
  { id: "text", label: tr("Text"), kbd: "T", hint: tr("volný text na listu") },
  { id: "detail", label: tr("Detail"), kbd: "L", hint: tr("detailní pohled: střed, poloměr, umístění") },
];
/** nástroje, které se po jednom vložení vypnou (kóty a detaily zůstávají aktivní pro sérii) */
const ONE_SHOT = new Set<DrawingAnnotation["type"]>(["text", "note", "roughness", "gdt", "datum"]);
const ANN_LABEL: Record<DrawingAnnotation["type"], string> = { dim: tr("Kóta"), note: tr("Poznámka"), roughness: tr("Drsnost"), gdt: tr("Tolerance"), datum: tr("Základna"), text: tr("Text"), callout: tr("Popis"), centerline: tr("Osa") };

/** naposledy použité volby listu (pro nový výkres); v2 = skryté hrany už nejsou výchozí – z v1 se nepřebírají */
const OPTS_KEY = "mn-cad-drawing-opts-v2";
const OPTS_KEY_V1 = "mn-cad-drawing-opts-v1";

// ---------- kóty: čísla a odsazení ----------
const fmtN = (n: number) => (Math.round(n * 100) / 100).toLocaleString(cadLocale());
const parseNum = (t: string): number | null => {
  const x = t.trim().replace(",", ".");
  if (!x) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
const fmtOffset = (n: number) => (Math.round(n * 10) / 10).toLocaleString(cadLocale(), { useGrouping: false });
/** odsazení kóty, jak se zadává: délková = vzdálenost kótovací čáry od geometrie, Ø / R = délka odkazu od kružnice, úhel = poloměr oblouku [mm listu] */
const shownOffset = (a: DimAnn) => (isRadialDim(a) || a.kind === "angle" ? a.offset : Math.abs(a.offset));
const withOffset = (a: DimAnn, n: number): DimAnn => ({ ...a, offset: isRadialDim(a) ? n : a.kind === "angle" ? Math.max(1, Math.abs(n)) : (a.offset < 0 ? -1 : 1) * n });
const offsetLabel = (a: DimAnn) => (isRadialDim(a) ? tr("Délka odkazu od kružnice [mm]") : a.kind === "angle" ? tr("Poloměr kótovacího oblouku [mm]") : tr("Odsazení kótovací čáry [mm]"));
const dimSymbol = (a: DimAnn) => (a.kind === "horizontal" ? "↔" : a.kind === "vertical" ? "↕" : a.kind === "diameter" ? "Ø" : a.kind === "radius" ? "R" : a.kind === "angle" ? "∠" : "⤢");
/** vybraná / nabízená geometrie kóty v mm listu (pro zvýraznění) */
type SheetPick = { kind: "point"; p: Vec2 } | { kind: "line"; a: Vec2; b: Vec2 } | { kind: "circle"; c: Vec2; r: number };
const samePick = (a: DimPick, b: DimPick) => a.kind === "line" && b.kind === "line" && ((a.a === b.a && a.b === b.b) || (Math.hypot(a.a[0] - b.a[0], a.a[1] - b.a[1]) < 1e-6 && Math.hypot(a.b[0] - b.b[0], a.b[1] - b.b[1]) < 1e-6));

function download(name: string, data: BlobPart | (() => Promise<BlobPart> | BlobPart), type: string) {
  void saveFile(name, data, type).catch((e) => console.warn("Uložení se nezdařilo:", e));
}

const safeName = (s: string) => (s || "vykres").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(0, 60);

function printSvg(svg: string, w: number, h: number) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(iframe);
  const d = iframe.contentDocument!;
  d.open();
  d.write(`<!doctype html><html><head><title>${tr("Výkres")}</title><style>@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0}svg{width:${w}mm;height:${h}mm;display:block}</style></head><body>${svg}</body></html>`);
  d.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 1500);
  }, 300);
}

function loadOpts(): DrawingOptions {
  try {
    const raw = localStorage.getItem(OPTS_KEY);
    const old = raw ? null : localStorage.getItem(OPTS_KEY_V1);
    if (raw || old) {
      const o = JSON.parse((raw ?? old)!) as Partial<DrawingOptions>;
      // v1 ukládala i dřívější výchozí „skryté hrany zapnuté“ – nový výkres je má vypnuté
      if (old) delete o.hidden;
      // řez, otočení a další modely patří ke konkrétnímu modelu – nový výkres začíná bez nich
      return { ...defaultDrawingOptions, ...o, views: { ...defaultDrawingOptions.views, ...(o.views ?? {}) }, section: null, rotation: 0, models: [], dimensions: NEW_DRAWING_OPTIONS.dimensions, smartGen: undefined, smartOff: undefined };
    }
  } catch {
    /* nedostupné úložiště */
  }
  return NEW_DRAWING_OPTIONS;
}

export function DrawingWorkspace({ doc, massKg, materialLabel, onClose, onShare, onMaterialChange, bom, bbox, onPropsChange, drawings, onDrawingsChange, balloons }: Props) {
  const [opts, setOpts] = useState<DrawingOptions>(NEW_DRAWING_OPTIONS);
  const [meta, setMeta] = useState<DrawingMeta>(() => ({
    name: doc.name,
    material: materialLabel,
    massKg,
    number: doc.props?.number ?? "",
    author: doc.props?.author ?? "",
    revision: doc.props?.revision ?? "",
    date: new Date().toLocaleDateString(cadLocale()),
    tolerance: "", // výrobní požadavky (tolerance, hrany) se nedoplňují automaticky – uvedou se jen zadané
  }));
  const [showBom, setShowBom] = useState(!!bom?.length);
  /** závity: kružnice válce / jádra se kótuje označením („M6 hl. 12“, „M18×1,5 dl. 18“) – modelované šroubovice se na výkrese nekreslí (ISO 6410) */
  const threads = useMemo(() => threadsOfDoc(doc), [doc.features]);
  const [repeatTool, setRepeatTool] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [dwgVer, setDwgVer] = useState<DwgVersion>(() => {
    try {
      const v = localStorage.getItem("mn-cad-dwg-version") as DwgVersion | null;
      return v && DWG_VERSIONS.some((x) => x.id === v) ? v : "R2018";
    } catch {
      return "R2018";
    }
  });
  const [res, setRes] = useState<DrawingResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ms, setMs] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const seq = useRef(0);
  // ---------- uživatelské kóty a poznámky (uložené v dokumentu) ----------
  // ---------- listy (každý list = DrawingDoc v doc.drawings) ----------
  const sheets = useMemo(() => drawings ?? [], [drawings]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const saved = sheets[sheetIdx];
  const [sheetName, setSheetName] = useState(saved?.name ?? tr("List 1"));
  const [ann, setAnn] = useState<DrawingAnnotation[]>(() => saved?.annotations ?? []);
  const [annTool, setAnnTool] = useState<AnnTool | null>(null);
  const [dimKind, setDimKind] = useState<DimKind>("auto");
  const [annPts, setAnnPts] = useState<Vec2[]>([]);
  const [hover, setHover] = useState<Vec2 | null>(null);
  const [prompt, setPrompt] = useState<null | { id: string; kind: AnnTool; x: number; y: number; done: (v: Record<string, string>) => void }>(null);
  // ---------- nástroj Kóta: výběr geometrie (bod / hrana / kružnice), kurzor a pole u kurzoru po vložení ----------
  const [circKind, setCircKind] = useState<CircKind>("auto");
  /** vybraná geometrie rozpracované kóty; `inv` = kružnice vybraná se Shiftem (průměr ↔ poloměr) */
  const [dimSel, setDimSel] = useState<(DimSel & { inv?: boolean })[]>([]);
  /** kurzor nad listem: poloha v mm listu, v px náhledu a stav klávesy Shift */
  const [cursor, setCursor] = useState<{ q: Vec2; x: number; y: number; shift: boolean } | null>(null);
  /** pole u kurzoru po vložení kóty (tolerance / přípona, odsazení); `orig` = kóta tak, jak byla vložena (Esc ji vrátí) */
  const [dimBox, setDimBox] = useState<null | { id: string; x: number; y: number; suffix: string; offset: string; orig: DimAnn }>(null);
  /** přejmenování listu přímo na záložce (ref = platný stav i pro ztrátu fokusu, která přijde až po Enter / Esc) */
  const [rename, setRename] = useState<null | { i: number; v: string }>(null);
  const renameRef = useRef<null | { i: number; v: string }>(null);
  const editRename = (r: null | { i: number; v: string }) => {
    renameRef.current = r;
    setRename(r);
  };
  const dirty = useRef(false);

  // načtení listu (při otevření a při přepnutí listu; po změně listu zvenku – textové příkazy „výkres …“, „kótovat“)
  const wrote = useRef(JSON.stringify(drawings ?? null));
  const loadSheet = () => {
    const sv = sheets[sheetIdx];
    dirty.current = false;
    if (sv?.options) setOpts({ ...defaultDrawingOptions, ...(sv.options as Partial<DrawingOptions>), views: { ...defaultDrawingOptions.views, ...((sv.options as Partial<DrawingOptions>).views ?? {}) } });
    else setOpts(loadOpts());
    if (sv?.meta) setMeta((m) => ({ ...m, ...(sv.meta as Partial<DrawingMeta>), material: materialLabel, massKg }));
    setAnn(sv?.annotations ?? []);
    setSheetName(sv?.name ?? tr("List {0}", sheetIdx + 1));
    setAnnTool(null);
    setAnnPts([]);
    setDimSel([]);
    setDimBox(null);
  };
  const loadRef = useRef(loadSheet);
  loadRef.current = loadSheet;
  useEffect(() => loadRef.current(), [sheetIdx]);
  useEffect(() => {
    const now = JSON.stringify(drawings ?? null);
    if (now === wrote.current) return;
    wrote.current = now;
    loadRef.current();
  }, [drawings]);
  // rozpracovaný výběr kóty patří jen nástroji Kóta
  useEffect(() => {
    if (annTool === "dim") return;
    setDimSel([]);
    setCursor(null);
  }, [annTool]);
  // pole u kurzoru patří existující kótě (po smazání kóty v seznamu zmizí)
  useEffect(() => {
    if (dimBox && !ann.some((a) => a.id === dimBox.id)) setDimBox(null);
  }, [ann, dimBox]);
  /** aktuální stav listu jako DrawingDoc */
  const sheetDoc = (): DrawingDoc => {
    const { bom: _b, massKg: _m, material: _mat, components: _c, sheetIndex: _si, sheetCount: _sc, ...metaRest } = meta;
    void _b;
    void _m;
    void _mat;
    void _c;
    void _si;
    void _sc;
    return { id: saved?.id ?? uid(), name: sheetName, options: { ...opts, section: opts.section } as unknown as Record<string, unknown>, meta: metaRest as unknown as Record<string, unknown>, annotations: ann };
  };
  const persistNow = () => {
    if (!onDrawingsChange) return;
    const next = sheets.length ? [...sheets] : [];
    next[sheetIdx] = sheetDoc();
    dirty.current = false;
    wrote.current = JSON.stringify(next);
    onDrawingsChange(next);
  };
  const persistRef = useRef(persistNow);
  persistRef.current = persistNow;
  /** zavření výkresu: rozpracované změny (formát, razítko, kóty) se uloží hned – i když ještě běží odložené uložení nebo přepočet */
  const close = useCallback(() => {
    // uložení se musí do dokumentu propsat dřív, než aplikace záložku výkresu zavře – zavření bere stav dokumentu
    // z posledního vykreslení a čekající změnu by přepsalo (ztratil by se např. formát změněný těsně před Esc)
    if (dirty.current) flushSync(() => persistRef.current());
    onClose();
  }, [onClose]);
  useEffect(() => () => {
    if (dirty.current) persistRef.current();
  }, []);
  // uložení do dokumentu (po změně kót, voleb nebo razítka)
  useEffect(() => {
    if (!dirty.current || !onDrawingsChange) return;
    const t = setTimeout(persistNow, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ann, opts, meta, sheetName]);
  const markDirty = () => (dirty.current = true);
  const addSheet = () => {
    if (!onDrawingsChange) return;
    const cur = sheets.length ? [...sheets] : [];
    cur[sheetIdx] = sheetDoc();
    const n = cur.length + 1;
    cur.push({ id: uid(), name: tr("List {0}", n), options: { ...NEW_DRAWING_OPTIONS, views: { ...defaultDrawingOptions.views }, details: [] } as unknown as Record<string, unknown>, meta: { name: meta.name, number: meta.number, author: meta.author, revision: meta.revision, date: meta.date, tolerance: meta.tolerance }, annotations: [] });
    dirty.current = false;
    wrote.current = JSON.stringify(cur);
    onDrawingsChange(cur);
    setSheetIdx(n - 1);
  };
  const removeSheet = (i: number) => {
    if (!onDrawingsChange || sheets.length <= 1) return;
    const cur = sheets.filter((_, k) => k !== i);
    dirty.current = false;
    wrote.current = JSON.stringify(cur);
    onDrawingsChange(cur);
    setSheetIdx(Math.max(0, Math.min(i, cur.length - 1)));
  };
  const switchSheet = (i: number) => {
    if (i === sheetIdx) return;
    if (dirty.current) persistNow();
    setSheetIdx(i);
  };
  /** konec přejmenování listu na záložce: Enter / opuštění pole potvrdí (prázdný název se nepřijme), Esc zruší */
  const commitRename = (apply: boolean) => {
    const r = renameRef.current;
    if (!r) return; // už ukončeno (Enter / Esc následované ztrátou fokusu při zániku pole)
    editRename(null);
    const n = r.v.trim();
    if (!apply || !n) return;
    if (r.i === sheetIdx) {
      if (n === sheetName) return;
      setSheetName(n);
      markDirty();
    } else {
      const next = sheets.map((x, k) => (k === r.i ? { ...x, name: n } : x));
      wrote.current = JSON.stringify(next);
      onDrawingsChange?.(next);
    }
  };
  useEffect(() => {
    try {
      localStorage.setItem(OPTS_KEY, JSON.stringify({ ...opts, section: undefined, rotation: undefined, models: undefined }));
    } catch {
      /* nedostupné úložiště */
    }
  }, [opts]);
  useEffect(() => setMeta((m) => ({ ...m, material: materialLabel, massKg })), [materialLabel, massKg]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast((t) => (t === m ? null : t)), 2800);
  };

  // přepočet výkresu (s krátkou prodlevou při psaní)
  useEffect(() => {
    const id = ++seq.current;
    setBusy(true);
    const t = setTimeout(async () => {
      const t0 = performance.now();
      try {
        const d = await cad.drawing(doc, { ...meta, threads, bom: showBom ? bom : undefined, components: balloons, sheetIndex: sheetIdx + 1, sheetCount: Math.max(1, sheets.length) }, opts);
        if (id !== seq.current) return;
        setRes(d);
        setError(null);
        setMs(Math.round(performance.now() - t0));
      } catch (e) {
        if (id === seq.current) setError((e as Error).message);
      } finally {
        if (id === seq.current) setBusy(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [doc, meta, threads, opts, bom, showBom, balloons, sheetIdx, sheets.length]);

  const set = <K extends keyof DrawingOptions>(k: K, v: DrawingOptions[K]) => {
    markDirty();
    setOpts((o) => ({ ...o, [k]: v }));
  };
  const setView = (k: ViewKey | "iso", v: boolean) => setOpts((o) => ({ ...o, views: { ...o.views, [k]: v } }));
  const setM = (patch: Partial<DrawingMeta>) => {
    markDirty();
    setMeta((m) => ({ ...m, ...patch }));
  };
  const persistProps = () => onPropsChange?.({ ...(doc.props ?? {}), number: meta.number, author: meta.author, revision: meta.revision });

  const centerOf = (plane: PlaneName) => {
    if (!bbox) return 0;
    const k = plane === "YZ" ? 0 : plane === "XZ" ? 1 : 2;
    return Math.round(((bbox[0][k] + bbox[1][k]) / 2) * 100) / 100;
  };

  // Chytré kóty: vygenerované poznámky (auto) se po výpočtu sloučí s vlastními (cad/drawing-agent.ts)
  const smart = (res as (DrawingResult & { smart?: SmartDims }) | null)?.smart;
  useEffect(() => {
    if (!res) return;
    if (opts.dimensions === "smart" && smart) {
      const m = mergeSmart(ann, opts, smart);
      if (!m) return;
      setAnn(m.annotations);
      setOpts((o) => ({ ...o, smartGen: m.gen }));
      markDirty();
    } else if (opts.dimensions !== "smart" && ann.some((a) => a.auto)) {
      setAnn((l) => l.filter((a) => !a.auto));
      setOpts((o) => ({ ...o, smartGen: undefined, smartOff: undefined }));
      markDirty();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res]);
  const regenSmart = () => {
    if (!smart) return;
    const m = mergeSmart(ann, opts, smart, true)!;
    setAnn(m.annotations);
    setOpts((o) => ({ ...o, smartGen: m.gen, smartOff: [] }));
    markDirty();
    flash(tr("Chytré kóty přegenerovány: {0}{1}", smart.annotations.filter((a) => a.type !== "centerline").length, smart.report.skipped.length ? tr(" · vynecháno {0}", smart.report.skipped.length) : ""));
  };
  // výsledek včetně uživatelských kót a poznámek
  const out = useMemo(() => (res ? withAnnotations(res, ann) : null), [res, ann]);
  /** stav kót a poznámek vůči aktuální geometrii (ztracená hrana / kružnice, pohled mimo list) */
  const annState = useMemo(() => (res ? annotationStatus(res, ann) : {}), [res, ann]);
  const flagged = ann.filter((a) => (annState[a.id] ?? "ok") !== "ok").length;
  /** kóty, jejichž hrana / kružnice v pohledu není – na obrazovce se zvýrazní oranžově (do exportu se zvýraznění nepromítá) */
  const lostGeom = useMemo(() => {
    const lost = ann.filter((a) => annState[a.id] === "lost");
    return res && lost.length ? annotationGeometry(res, lost) : null;
  }, [res, ann, annState]);
  /** umístění pohledů na listu (pro automatizované testy a agenty: přepočet mm modelu → list) */
  const viewsAttr = useMemo(() => (res ? JSON.stringify(res.views.map((v) => ({ key: v.key, px: v.px, py: v.py, s: v.s, x0: v.x0, y0: v.y0, w: v.w, h: v.h }))) : undefined), [res]);

  // ---------- export ----------
  const base = safeName(meta.name || doc.name);
  const exportPdf = async () => {
    if (!out) return;
    try {
      const saved = await saveFile(`${base}_vykres.pdf`, async () => {
        flash(tr("Generuji PDF…"));
        const { drawingToPdf } = await import("@/cad/pdf");
        return drawingToPdf({ ...out, title: meta.name });
      }, "application/pdf");
      if (saved) flash(tr("PDF uloženo: {0}", saved.name));
    } catch (e) {
      flash((e as Error).message || tr("PDF se nepodařilo vytvořit."));
    }
  };

  const exportDwg = async () => {
    if (!out) return;
    try {
      const saved = await saveFile(`${base}_vykres.dwg`, async () => {
        flash(tr("Generuji DWG ({0})…", dwgVer));
        const { drawingToDwg } = await import("@/cad/formats/dwg");
        return drawingToDwg(out, { version: dwgVer });
      }, "application/acad");
      if (saved) flash(tr("DWG {0} uloženo: {1}", dwgVer, saved.name));
    } catch (e) {
      flash((e as Error).message || tr("DWG se nepodařilo vytvořit."));
    }
  };

  // ---------- náhled: zoom & posun ----------
  const canvas = useRef<HTMLDivElement>(null);
  const [view, setViewTf] = useState({ x: 0, y: 0, z: 2 });
  const fitted = useRef<string | null>(null);
  const fit = useCallback(() => {
    const el = canvas.current;
    if (!el || !res) return;
    const { w, h } = res.sheet;
    const z = Math.min((el.clientWidth - 48) / w, (el.clientHeight - 48) / h);
    setViewTf({ z, x: (el.clientWidth - w * z) / 2, y: (el.clientHeight - h * z) / 2 });
  }, [res]);
  useLayoutEffect(() => {
    if (!res) return;
    const key = `${res.sheet.name}-${res.sheet.w}`;
    if (fitted.current !== key) {
      fitted.current = key;
      fit();
    }
  }, [res, fit]);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setViewTf((v) => {
        const z = Math.min(40, Math.max(0.3, v.z * Math.exp(-e.deltaY * 0.0015)));
        return { z, x: mx - ((mx - v.x) * z) / v.z, y: my - ((my - v.y) * z) / v.z };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    const ro = new ResizeObserver(() => fitRef.current());
    ro.observe(el);
    return () => {
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, []);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  // Klávesy: posluchač se registruje jednou a aktuální stav čte přes ref. Kdyby se při každé změně stavu registroval znovu,
  // ztratil by se stisk klávesy, během jehož zpracování se výkres překreslí (překreslení vyvolá posluchač kláves aplikace,
  // který běží před ním) – typicky druhý Esc hned po zavření pole kóty nebo formuláře poznámky.
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  onKeyRef.current = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("input,textarea,select")) return;
    if (prompt) {
      if (e.key === "Escape") setPrompt(null);
      return; // při otevřeném formuláři poznámky nepřepínat nástroje
    }
    if (e.key === "Escape") {
      if (dimBox) {
        // pole kóty zavřít, kóta zůstane s výchozími hodnotami
        setAnn((l) => l.map((x) => (x.id === dimBox.id ? dimBox.orig : x)));
        return setDimBox(null);
      }
      if (dimSel.length) return setDimSel([]); // rozpracovaný výběr kóty zrušit, nástroj zůstává
      if (annTool) {
        setAnnTool(null);
        setAnnPts([]);
        return;
      }
      return close();
    }
    const k = e.key.toLowerCase();
    if (k === "f") fit();
    const t = ANN_TOOLS.find((x) => x.kbd.toLowerCase() === k);
    if (t && !e.ctrlKey && !e.metaKey) {
      setAnnTool((cur) => (cur === t.id ? null : t.id));
      setAnnPts([]);
    }
    if ((e.key === "Delete" || e.key === "Backspace") && ann.length && !annTool) {
      setAnn((a) => a.slice(0, -1));
      markDirty();
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------- umisťování kót a poznámek ----------
  const toSheet = (e: { clientX: number; clientY: number }): Vec2 | null => {
    const el = canvas.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [(e.clientX - r.left - view.x) / view.z, (e.clientY - r.top - view.y) / view.z];
  };
  /** přichycení k nejbližšímu vrcholu geometrie výkresu (do 10 px) */
  const snap = (q: Vec2): Vec2 => {
    if (!res) return q;
    const tol = 10 / view.z;
    let best = q;
    let bd = tol;
    for (const p of res.polys) {
      if (p.layer === "frame" || p.layer === "title" || p.layer === "hatch") continue;
      for (const pt of p.pts) {
        const d = Math.hypot(pt[0] - q[0], pt[1] - q[1]);
        if (d < bd) {
          bd = d;
          best = pt;
        }
      }
    }
    return best;
  };
  const addAnn = (a: DrawingAnnotation) => {
    setAnn((list) => [...list, a]);
    markDirty();
    setAnnPts([]);
    if (ONE_SHOT.has(a.type) && !repeatTool) setAnnTool(null); // jednorázové vložení – nástroj se po vložení vypne
  };
  /** převod bodů listu do souřadnic pohledu (asociativní) – podle prvního bodu */
  const localize = (pts: Vec2[]): { view: string; pts: Vec2[] } => {
    const v = res ? viewAt(res.views, pts[0]) : null;
    if (!v) return { view: "sheet", pts };
    return { view: v.key, pts: pts.map((p) => sheetToAnn(v, p)) };
  };
  const nextDatum = () => {
    const used = new Set(ann.filter((a): a is Extract<DrawingAnnotation, { type: "datum" }> => a.type === "datum").map((a) => a.label));
    return "ABCDEFGHJKLMNPRSTUVWXYZ".split("").find((c) => !used.has(c)) ?? "A";
  };
  const ask = (kind: AnnTool, e: { clientX: number; clientY: number }) => new Promise<Record<string, string> | null>((resolve) => setPrompt({ id: uid(), kind, x: e.clientX, y: e.clientY, done: (v) => { setPrompt(null); resolve(v); } }));

  // ---------- nástroj Kóta: co je pod kurzorem ----------
  /** pohled s rozpoznanou geometrií, ve kterém leží bod listu (s okrajem dosahu výběru) */
  const entViewAt = (q: Vec2, m: number): PlacedView | null => res?.views.find((v) => v.ents?.length && q[0] >= v.px - m && q[0] <= v.px + v.w * v.s + m && q[1] >= v.py - m && q[1] <= v.py + v.h * v.s + m) ?? null;
  /**
   * Co by se kliknutím vybralo: v pohledu hrana, kružnice / oblouk nebo bod (konec hrany, střed kružnice), jinak volný bod pohledu;
   * mimo pohledy (izometrie, detail) vrchol geometrie jako dosud. `want`: jen body (druhý bod kóty) / jen hrany (druhá hrana úhlu).
   * `hit` = pod kurzorem opravdu leží geometrie (ne volný bod).
   */
  const dimTarget = (q: Vec2, want: "any" | "point" | "line", inView?: string): { sel: DimSel; hit: boolean } | null => {
    if (!res) return null;
    const tol = 10 / view.z;
    const v = entViewAt(q, tol);
    if (v && (!inView || v.key === inView)) {
      const pick = pickViewEnt(v.ents ?? [], sheetToAnn(v, q), tol / v.s, want);
      if (pick) return { sel: { view: v.key, pick }, hit: true };
      return want === "line" ? null : { sel: { view: v.key, pick: { kind: "point", p: sheetToAnn(v, q) } }, hit: false };
    }
    if (want === "line") return null;
    const p = snap(q);
    const loc = localize([p]);
    return { sel: { view: loc.view, pick: { kind: "point", p: loc.pts[0] } }, hit: p !== q };
  };
  const dimModes = (shift: boolean) => ({ linear: dimKind, circle: circKind, invert: shift || !!dimSel[0]?.inv });
  /** co se stane v místě kurzoru: další výběr (`next`), nebo vložení kóty (`place`) */
  const dimStep = (q: Vec2, shift: boolean): { next?: { sel: DimSel; hit: boolean }; place?: NewDim | null } => {
    const first = dimSel[0];
    if (!first) return { next: dimTarget(q, "any") ?? undefined };
    if (first.pick.kind === "point" && dimSel.length === 1) return { next: dimTarget(q, "point") ?? undefined };
    if (first.pick.kind === "line" && dimSel.length === 1) {
      const t = dimTarget(q, "line", first.view);
      if (t && !samePick(t.sel.pick, first.pick)) return { next: t };
    }
    return { place: res ? dimFromPicks(res, dimSel, q, dimModes(shift)) : null };
  };
  const onDimClick = (e: React.PointerEvent, raw: Vec2) => {
    setDimBox(null); // rozepsané pole předchozí kóty: hodnoty už jsou zapsané
    const st = dimStep(raw, e.shiftKey);
    if (st.next) return setDimSel([...dimSel, st.next.sel.pick.kind === "circle" && e.shiftKey ? { ...st.next.sel, inv: true } : st.next.sel]);
    if (!st.place) {
      if (dimSel.length > 1) flash(tr("Tuto kombinaci nelze okótovat."));
      return setDimSel([]);
    }
    const a = { ...st.place, id: uid() } as DimAnn;
    addAnn(a);
    setDimSel([]);
    setDimBox({ id: a.id, x: e.clientX, y: e.clientY, suffix: "", offset: fmtOffset(shownOffset(a)), orig: a });
  };
  /** zápis hodnot z pole u kurzoru do kóty (průběžně při psaní); prázdné / neplatné odsazení = původní */
  const editDimBox = (patch: { suffix?: string; offset?: string }) => {
    if (!dimBox) return;
    const box = { ...dimBox, ...patch };
    setDimBox(box);
    const n = parseNum(box.offset);
    const base = n == null || box.offset === fmtOffset(shownOffset(box.orig)) ? box.orig : withOffset(box.orig, n);
    const next: DimAnn = { ...base, suffix: box.suffix.trim() ? box.suffix : undefined };
    setAnn((l) => l.map((x) => (x.id === box.id ? next : x)));
    markDirty();
  };
  const cancelDimBox = () => {
    if (!dimBox) return;
    setAnn((l) => l.map((x) => (x.id === dimBox.id ? dimBox.orig : x)));
    setDimBox(null);
  };

  const onCanvasClick = async (e: React.PointerEvent) => {
    if (!annTool || !res) return;
    const raw = toSheet(e);
    if (!raw) return;
    if (annTool === "dim") return onDimClick(e, raw);
    const q = snap(raw);
    const pts = [...annPts, q];
    switch (annTool) {
      case "note": {
        if (pts.length < 2) return setAnnPts(pts);
        const v = await ask("note", e);
        if (!v?.text) return setAnnPts([]);
        const loc = localize([pts[1], pts[0]]);
        return addAnn({ id: uid(), view: loc.view, type: "note", at: loc.pts[0], leader: loc.pts[1], text: v.text });
      }
      case "roughness": {
        const v = await ask("roughness", e);
        if (!v?.ra) return setAnnPts([]);
        const loc = localize([q]);
        return addAnn({ id: uid(), view: loc.view, type: "roughness", at: loc.pts[0], ra: v.ra });
      }
      case "gdt": {
        if (pts.length < 2) return setAnnPts(pts);
        const v = await ask("gdt", e);
        if (!v?.value) return setAnnPts([]);
        const loc = localize([pts[1], pts[0]]);
        return addAnn({ id: uid(), view: loc.view, type: "gdt", at: loc.pts[0], leader: loc.pts[1], symbol: (v.symbol as GdtSymbol) || "pos", value: v.value, datum: v.datum || undefined });
      }
      case "datum": {
        const loc = localize([q]);
        return addAnn({ id: uid(), view: loc.view, type: "datum", at: loc.pts[0], label: nextDatum() });
      }
      case "text": {
        const v = await ask("text", e);
        if (!v?.text) return setAnnPts([]);
        return addAnn({ id: uid(), view: "sheet", type: "text", at: raw, text: v.text, size: Number(v.size) || 3.5 });
      }
      case "detail": {
        if (pts.length < 3) return setAnnPts(pts);
        const [C, Rp, At] = pts;
        const v = viewAt(res.views, C);
        if (!v) {
          flash(tr("Střed detailu musí ležet v některém pohledu."));
          return setAnnPts([]);
        }
        const c = sheetToAnn(v, C);
        const r = Math.max(1, Math.hypot(Rp[0] - C[0], Rp[1] - C[1]) / v.s);
        const used = new Set((opts.details ?? []).map((d) => d.label));
        const label = "ABCDEFGHJKLMNPRSTUVWXYZ".split("").find((ch) => !used.has(ch)) ?? "A";
        const sc = STANDARD_SCALES.find((x) => x <= res.scaleValue * 2) ?? res.scaleValue * 2;
        const size = 2 * r * sc;
        const d: DetailView = { id: uid(), label, view: v.key, cx: c[0], cy: c[1], r, scale: sc, at: [At[0] - size / 2, At[1] - size / 2] };
        set("details", [...(opts.details ?? []), d]);
        setAnnPts([]);
        return;
      }
    }
  };

  /** nápověda nástroje Kóta podle toho, co je vybráno */
  const dimHint = () => {
    const k = dimSel[0]?.pick.kind;
    if (!k) return tr("Klikněte na kružnici nebo oblouk (Ø / R), na hranu (délka; druhá hrana = úhel) nebo na dva body. Shift = průměr ↔ poloměr.");
    if (k === "circle") return tr("Kružnice vybrána – klikněte na místo kóty (Shift = průměr ↔ poloměr).");
    if (k === "line") return dimSel.length === 1 ? tr("Hrana vybrána – klikněte na místo kóty délky, nebo na druhou hranu (úhel, u rovnoběžných vzdálenost).") : tr("Dvě hrany vybrány – klikněte na místo kóty (úhel se bere v sektoru, kde je kurzor).");
    return tr("Klikněte na 2 body geometrie (přichytávání k vrcholům) a pak na místo kótovací čáry. Vybráno {0}/3.", dimSel.length);
  };

  // ---------- nástroj Kóta: zvýraznění pod kurzorem a náhled kóty ----------
  const pickSheet = (sel: DimSel): SheetPick => {
    const S = (q: Vec2) => annToSheet(res?.views ?? [], sel.view, q);
    const k = sel.pick;
    if (k.kind === "point") return { kind: "point", p: S(k.p) };
    if (k.kind === "line") return { kind: "line", a: S(k.a), b: S(k.b) };
    return { kind: "circle", c: S(k.c), r: k.r * (res?.views.find((v) => v.key === sel.view)?.s ?? 1) };
  };
  const dimHover = (() => {
    if (annTool !== "dim" || !cursor || !res) return null;
    const st = dimStep(cursor.q, cursor.shift);
    const first = dimSel[0];
    let label = "";
    if (st.next?.hit) {
      const k = st.next.sel.pick;
      if (k.kind === "circle") {
        const base = circKind === "auto" ? (k.full ? "diameter" : "radius") : circKind;
        const dia = (base === "diameter") !== cursor.shift;
        const [main, alt] = dia ? [`Ø${fmtN(2 * k.r)}`, `R${fmtN(k.r)}`] : [`R${fmtN(k.r)}`, `Ø${fmtN(2 * k.r)}`];
        label = k.full ? tr("Kružnice: {0} · Shift = {1}", main, alt) : tr("Oblouk: {0} · Shift = {1}", main, alt);
      } else if (k.kind === "line") {
        const len = Math.hypot(k.b[0] - k.a[0], k.b[1] - k.a[1]);
        if (first?.pick.kind === "line") {
          const g = angleGeom(first.pick.a, first.pick.b, k.a, k.b, 0);
          if (g) label = tr("Druhá hrana: úhel {0}° / {1}°", fmtN(g.angle), fmtN(180 - g.angle));
          else {
            const f = first.pick;
            const l = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]) || 1;
            label = tr("Druhá hrana: vzdálenost {0}", fmtN(Math.abs(((k.a[0] - f.a[0]) * (f.b[1] - f.a[1]) - (k.a[1] - f.a[1]) * (f.b[0] - f.a[0])) / l)));
          }
        } else label = tr("Hrana: délka {0}", fmtN(len));
      } else label = tr("Bod");
    }
    const preview = st.place ? annotationGeometry(res, [{ ...st.place, id: "preview" } as DimAnn]) : null;
    if (preview) label = preview.texts[0]?.s ? tr("Klikněte na místo kóty {0}", preview.texts[0].s) : "";
    const target = st.next?.hit ? pickSheet(st.next.sel) : null;
    // první bod vybrán → pomocná čára k druhému bodu
    const from = first?.pick.kind === "point" && dimSel.length === 1 ? annToSheet(res.views, first.view, first.pick.p) : null;
    const rubber: [Vec2, Vec2] | null = from ? [from, target?.kind === "point" ? target.p : cursor.q] : null;
    return { target, preview, label, rubber };
  })();

  const scaleValue = opts.scale === "auto" ? "auto" : String(opts.scale);

  return (
    <div data-drawing-workspace className="fixed inset-x-0 bottom-0 top-[76px] z-30 flex flex-col bg-[#4b5058] text-[12.5px] text-ink-700 sm:top-10">
      {/* horní lišta */}
      <header className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto overflow-y-hidden whitespace-nowrap border-b border-black/10 bg-white px-3 [scrollbar-width:none] [touch-action:pan-x]">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-brand" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <rect x="3" y="4" width="18" height="16" rx="1" />
          <path d="M3 15h18M13 15v5M6 8h6M6 11h4" />
        </svg>
        <p className="min-w-0 truncate text-[13px] font-semibold">
          {tr("Výkres")}{" "}<span className="font-normal text-ink-700/50">· {doc.name}</span>
        </p>
        {res && (
          <span className="hidden rounded-md bg-steel-100 px-2 py-0.5 font-mono text-[11px] text-ink-700/70 sm:inline">
            {res.sheet.name} · {res.scale} {tr("· ISO")}{" "}{opts.projection}
          </span>
        )}
        <div className="flex-1" />
        <Btn primary onClick={exportPdf} disabled={!res}>
          PDF
        </Btn>
        <span className="inline-flex items-stretch overflow-hidden rounded-md border border-ink-700/15 bg-white">
          <button type="button" onClick={exportDwg} disabled={!res} title={tr("DWG {0} – přímo do AutoCADu, ZWCADu, BricsCADu", DWG_VERSIONS.find((v) => v.id === dwgVer)?.hint ?? "")} className="px-3 py-1.5 text-[12.5px] font-medium hover:bg-steel-100 disabled:opacity-40">
            DWG
          </button>
          <select
            value={dwgVer}
            onChange={(e) => {
              const v = e.target.value as DwgVersion;
              setDwgVer(v);
              try {
                localStorage.setItem("mn-cad-dwg-version", v);
              } catch {
                /* ignore */
              }
            }}
            aria-label={tr("Verze DWG")}
            title={tr("Verze souboru DWG")}
            className="border-l border-ink-700/15 bg-steel-100 px-1.5 text-[11px] text-ink-700/80 outline-none"
          >
            {DWG_VERSIONS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </span>
        <Btn onClick={() => out && download(`${base}_vykres.dxf`, out.dxf, "application/dxf")} disabled={!res} title={tr("DXF (AutoCAD R12) – otevře AutoCAD, ZWCAD, DraftSight, LibreCAD")}>
          DXF
        </Btn>
        <Btn onClick={() => out && download(`${base}_vykres.svg`, out.svg, "image/svg+xml")} disabled={!res}>
          SVG
        </Btn>
        {bom?.length ? <Btn onClick={() => download(`${base}_kusovnik.csv`, bomToCsv(bom), "text/csv;charset=utf-8")}>{tr("Kusovník CSV")}</Btn> : null}
        <Btn onClick={() => out && printSvg(out.svg, out.sheet.w, out.sheet.h)} disabled={!res}>
          {tr("Tisk")}
        </Btn>
        {onShare && (
          <>
            <div className="mx-1 h-6 w-px bg-ink-700/10" />
            <Btn
              onClick={() => {
                if (dirty.current) persistNow(); // rozpracované razítko / poznámky do dokumentu ještě před vytvořením odkazu
                onShare?.();
              }}
              title={tr("Sdílet odkazem (WhatsApp, e-mail, Teams…) – příjemci se otevře rovnou výkres")}>
              {tr("Sdílet")}
            </Btn>
          </>
        )}
        <div className="mx-1 h-6 w-px bg-ink-700/10" />
        <Btn onClick={close} title={tr("Zpět do 3D (Esc)")}>
          {tr("Zavřít")}
        </Btn>
      </header>
      {/* listy výkresu */}
      <div className="flex h-8 shrink-0 items-end gap-1 overflow-x-auto overflow-y-hidden border-b border-black/10 bg-[#dfe5eb] px-3 [scrollbar-width:none] [touch-action:pan-x]">
        {(sheets.length ? sheets : [{ id: "main", name: sheetName }]).map((sh, i) => (
          <div key={sh.id} className={cn("group flex items-center gap-1 rounded-t-md border-x border-t px-3 py-1 text-[12px]", i === sheetIdx ? "relative top-px border-black/10 bg-white font-semibold" : "border-transparent text-ink-700/60 hover:bg-white/60")}>
            {rename?.i === i ? (
              <input
                data-sheet-rename
                autoFocus
                aria-label={tr("Název listu")}
                value={rename.v}
                onChange={(e) => editRename({ i, v: e.target.value })}
                onFocus={(e) => e.target.select()}
                onBlur={() => commitRename(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(true);
                  if (e.key === "Escape") commitRename(false);
                }}
                className="w-28 rounded border border-brand bg-white px-1 py-0 text-[12px] font-normal outline-none ring-2 ring-brand/15"
              />
            ) : (
              <button type="button" onClick={() => switchSheet(i)} onDoubleClick={() => editRename({ i, v: i === sheetIdx ? sheetName : sh.name })} title={tr("Dvojklik = přejmenovat")}>
                {i === sheetIdx ? sheetName : sh.name}
              </button>
            )}
            {sheets.length > 1 && (
              <button type="button" title={tr("Odstranit list")} onClick={() => removeSheet(i)} className="hidden text-ink-700/40 hover:text-brand group-hover:inline">
                ×
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={addSheet} disabled={!onDrawingsChange} className="mb-0.5 rounded px-2 py-0.5 text-[12px] text-ink-700/60 hover:bg-white/60 hover:text-brand disabled:opacity-40" title={tr("Přidat list")}>
          {tr("+ List")}
        </button>
        <span className="ml-auto pb-1 text-[11px] text-ink-700/45">
          {tr("List")}{" "}{sheetIdx + 1}/{Math.max(1, sheets.length)}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* nastavení */}
        <aside className="w-[272px] shrink-0 overflow-y-auto border-r border-black/10 bg-white">
          <Section title={tr("Kóty a poznámky")}>
            <div className="grid grid-cols-3 gap-1">
              {ANN_TOOLS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={`${t.hint} (${t.kbd})`}
                  onClick={() => {
                    setAnnTool((cur) => (cur === t.id ? null : t.id));
                    setAnnPts([]);
                  }}
                  className={cn("rounded-md border px-1 py-1.5 text-[11.5px] leading-tight", annTool === t.id ? "border-brand bg-brand/10 font-semibold text-brand" : "border-ink-700/15 hover:bg-steel-100")}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {annTool === "dim" && (
              <>
                <div className="mt-2 flex rounded-md bg-steel-100 p-0.5" title={tr("Druh délkové kóty (2 body, hrana)")}>
                  {(["auto", "aligned", "horizontal", "vertical"] as DimKind[]).map((k) => (
                    <button key={k} type="button" onClick={() => setDimKind(k)} className={cn("flex-1 rounded px-1 py-0.5 text-[11px]", dimKind === k ? "bg-white shadow-sm" : "text-ink-700/60")}>
                      {k === "auto" ? tr("Auto") : k === "aligned" ? tr("Šikmá") : k === "horizontal" ? tr("Vodor.") : tr("Svislá")}
                    </button>
                  ))}
                </div>
                <div data-circ-kind className="mt-1 flex items-center gap-1.5">
                  <span className="shrink-0 text-[11px] text-ink-700/55">{tr("Kružnice")}</span>
                  <div className="flex flex-1 rounded-md bg-steel-100 p-0.5" title={tr("Kóta kružnice / oblouku: Auto = kružnice průměrem Ø, oblouk poloměrem R; Shift při kliknutí volbu obrátí")}>
                    {(["auto", "diameter", "radius"] as CircKind[]).map((k) => (
                      <button key={k} type="button" onClick={() => setCircKind(k)} className={cn("flex-1 rounded px-1 py-0.5 text-[11px]", circKind === k ? "bg-white shadow-sm" : "text-ink-700/60")}>
                        {k === "auto" ? tr("Auto") : k === "diameter" ? tr("Ø průměr") : tr("R poloměr")}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            {annTool && (
              <div data-active-tool className="mt-2 flex items-center justify-between gap-2 rounded-md border border-brand/30 bg-brand/5 px-2 py-1 text-[11px]">
                <span>
                  <strong className="text-brand">{tr("Aktivní nástroj:")}{" "}{ANN_TOOLS.find((t) => t.id === annTool)?.label ?? annTool}</strong> {tr("· Esc ukončí")}
                </span>
                <label className="flex shrink-0 items-center gap-1 text-ink-700/70" title={tr("Po vložení zůstat v nástroji (jinak se po jednom vložení vypne)")}>
                  <input type="checkbox" checked={repeatTool} onChange={(e) => setRepeatTool(e.target.checked)} /> {tr("opakovat")}
                </label>
              </div>
            )}
            <p className="mt-2 text-[11px] leading-snug text-ink-700/55">
              {annTool ? (annTool === "detail" ? tr("Detail: 1. klik = střed, 2. klik = poloměr, 3. klik = umístění na listu ({0}/3).", annPts.length) : annTool === "dim" ? dimHint() : annTool === "note" || annTool === "gdt" ? tr("1. klik = kam šipka ukazuje, 2. klik = umístění. ({0}/2)", annPts.length) : tr("Klikněte na místo ve výkresu.")) : tr("Kóty a poznámky jsou asociativní – drží se geometrie pohledu i po změně modelu. Ukládají se do dokumentu.")}
            </p>
            <div className="mt-2">
              <button type="button" onClick={() => setCheckOpen((v) => !v)} className="w-full rounded-md border border-ink-700/15 px-2 py-1 text-[11.5px] hover:bg-steel-100">
                {checkOpen ? tr("Skrýt kontrolu kót") : tr("Kontrola kót – co chybí")}
              </button>
              {checkOpen &&
                (() => {
                  const items = dimCheck(doc, bbox ?? null, out?.texts ?? []);
                  const missing = items.filter((i) => !i.present);
                  return (
                    <div data-dim-check className="mt-1 rounded-md border border-ink-700/10 bg-steel-100/60 p-2 text-[11px]">
                      <p className="font-semibold">{missing.length ? tr("Chybí {0} z {1} očekávaných kót", missing.length, items.length) : tr("Všech {0} očekávaných kót je na listu", items.length)}</p>
                      {missing.length > 0 && (
                        <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                          {missing.map((m, i) => (
                            <li key={i} className="flex gap-1">
                              <span className="text-brand">✗</span>
                              <span className="min-w-0 flex-1 truncate">{m.label}</span>
                              <span className="shrink-0 text-ink-700/45">{m.source}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-1 leading-snug text-ink-700/55">{tr("Odvozeno z historie prvků – pomocný seznam, ne náhrada kontroly konstruktérem. Chybějící kótu přidáte nástrojem Kóta (2 body + odsazení); toleranci (H8, ±0,1) doplňte u kóty v seznamu do pole „přípona“.")}</p>
                    </div>
                  );
                })()}
            </div>
            {ann.length > 0 && (
              <ul className="mt-2 max-h-44 space-y-0.5 overflow-y-auto">
                {ann.map((a, i) => (
                  <li key={a.id} className="flex items-center gap-2 rounded px-1.5 py-0.5 text-[11.5px] hover:bg-steel-100">
                    <span className="w-16 shrink-0 text-ink-700/50">{tr(ANN_LABEL[a.type])}</span>
                    <span className="min-w-0 flex-1 truncate">{a.type === "dim" ? `${dimSymbol(a)} ${a.view}` : a.type === "note" || a.type === "text" ? a.text : a.type === "roughness" ? a.ra : a.type === "gdt" ? `${GDT_LABEL[a.symbol]} ${a.value}${a.datum ? " " + a.datum : ""}` : a.type === "callout" ? a.lines.join(" · ") : a.type === "centerline" ? tr("osa souměrnosti") : a.label}</span>
                    {(annState[a.id] ?? "ok") !== "ok" && (
                      <span data-ann-flag={annState[a.id]} className="shrink-0 cursor-help text-amber-600" title={annState[a.id] === "noView" ? (a.type === "dim" ? tr("Pohled kóty není na listu – kóta se nekreslí.") : tr("Pohled, ke kterému se poznámka váže, není na listu.")) : tr("Hrana nebo kružnice, ke které se kóta váže, v pohledu není (model se změnil) – kreslí se podle uložených údajů. Zkontrolujte ji nebo ji vložte znovu.")}>
                        ⚠
                      </span>
                    )}
                    {a.type === "dim" && (
                      <>
                        <input
                          value={a.suffix ?? ""}
                          placeholder={tr("H8 / ±0,1")}
                          title={tr("Tolerance nebo přípona kóty (zobrazí se za hodnotou)")}
                          aria-label={tr("Přípona kóty")}
                          onChange={(e) => {
                            const v = e.target.value;
                            setAnn((l) => l.map((x) => (x.id === a.id && x.type === "dim" ? { ...x, suffix: v } : x)));
                            markDirty();
                          }}
                          className="w-14 shrink-0 rounded border border-ink-700/15 px-1 py-0.5 font-mono text-[10.5px]"
                        />
                        <OffsetInput
                          value={shownOffset(a)}
                          title={offsetLabel(a)}
                          onCommit={(n) => {
                            setAnn((l) => l.map((x) => (x.id === a.id && x.type === "dim" ? withOffset(x, n) : x)));
                            markDirty();
                          }}
                        />
                      </>
                    )}
                    <button
                      type="button"
                      title={tr("Smazat")}
                      onClick={() => {
                        setAnn((l) => l.filter((_, k) => k !== i));
                        if (a.auto) setOpts((o) => ({ ...o, smartOff: [...(o.smartOff ?? []), a.auto!] }));
                        markDirty();
                      }}
                      className="text-ink-700/40 hover:text-brand"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {ann.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setAnn([]);
                  if (ann.some((a) => a.auto)) setOpts((o) => ({ ...o, smartOff: ann.flatMap((a) => (a.auto ? [a.auto] : [])) }));
                  markDirty();
                }}
                className="mt-1 text-[11px] text-ink-700/50 hover:text-brand"
              >
                {tr("Smazat vše (")}{ann.length})
              </button>
            )}
          </Section>
          <Section title={tr("List")}>
            <Row label={tr("Formát")}>
              <select className={inputCls} aria-label={tr("Formát listu")} value={opts.sheet} onChange={(e) => set("sheet", e.target.value as DrawingOptions["sheet"])}>
                <option value="auto">{tr("Automaticky")}</option>
                {(["A4", "A3", "A2", "A1", "A0"] as SheetName[]).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Row>
            <Seg value={opts.orientation} onChange={(v) => set("orientation", v)} options={[{ v: "landscape", l: tr("Na šířku") }, { v: "portrait", l: tr("Na výšku") }]} />
            <Row label={tr("Měřítko")}>
              <select className={inputCls} value={scaleValue} onChange={(e) => set("scale", e.target.value === "auto" ? "auto" : Number(e.target.value))}>
                <option value="auto">{tr("Automaticky")}</option>
                {STANDARD_SCALES.map((s) => (
                  <option key={s} value={String(s)}>
                    {scaleLabel(s)}
                  </option>
                ))}
              </select>
            </Row>
            <Row label={tr("Promítání")}>
              <Seg value={opts.projection} onChange={(v) => set("projection", v)} options={[{ v: "E", l: tr("ISO E (EU)") }, { v: "A", l: tr("ISO A (US)") }]} />
            </Row>
          </Section>

          <Section title={tr("Pohledy")}>
            <div className="grid grid-cols-2 gap-1">
              {(["front", "top", "left", "right", "back", "bottom", "iso"] as (ViewKey | "iso")[]).map((k) => (
                <Check key={k} checked={opts.views[k]} onChange={(v) => setView(k, v)} disabled={k === "front"}>
                  {tr(VIEW_LABEL[k])}
                </Check>
              ))}
            </div>
            <Row label={tr("Otočení hlavního pohledu")}>
              <Seg
                value={String(opts.rotation ?? 0) as `${ViewRotation}`}
                onChange={(v) => set("rotation", Number(v) as ViewRotation)}
                options={(["0", "90", "180", "270"] as const).map((v) => ({ v, l: `${v}°` }))}
              />
            </Row>
            <p className="-mt-1 text-[10.5px] leading-snug text-ink-700/50">{tr("Otočí hlavní pohled po směru hodin a s ním celé promítání – soustružený díl tak může ležet osou vodorovně.")}</p>
          </Section>

          <Section title={tr("Řez A–A")}>
            <Check
              checked={!!opts.section}
              onChange={(v) => set("section", v ? { plane: "XZ", offset: centerOf("XZ") } : null)}
            >
              {tr("Zobrazit řez se šrafováním")}
            </Check>
            {opts.section && (
              <>
                <Seg
                  value={opts.section.plane}
                  onChange={(p) => set("section", { plane: p, offset: centerOf(p), kind: opts.section!.kind })}
                  options={[
                    { v: "XZ", l: tr("XZ (čelní)") },
                    { v: "YZ", l: tr("YZ (boční)") },
                    { v: "XY", l: tr("XY (vodor.)") },
                  ]}
                />
                <Seg
                  value={opts.section.kind ?? "full"}
                  onChange={(k) => set("section", { ...opts.section!, kind: k })}
                  options={[
                    { v: "full", l: tr("Celý řez") },
                    { v: "half", l: tr("Poloviční řez") },
                  ]}
                />
                <Row label={tr("Poloha roviny")}>
                  <NumInput value={opts.section.offset} onChange={(n) => set("section", { ...opts.section!, offset: n })} suffix="mm" />
                </Row>
                {opts.section.kind === "half" && <p className="text-[10.5px] leading-snug text-ink-700/50">{tr("Polovina pohled, polovina řez – dělí je osa souměrnosti (u soustružených dílů osa rotace).")}</p>}
              </>
            )}
          </Section>

          <Section title={tr("Zobrazení a kóty")}>
            <Check checked={opts.hidden} onChange={(v) => set("hidden", v)}>
              {tr("Skryté hrany (čárkovaně)")}
            </Check>
            <Check checked={opts.centerLines} onChange={(v) => set("centerLines", v)}>
              {tr("Osy děr a válců")}
            </Check>
            <Row label={tr("Kóty")}>
              <Seg value={opts.dimensions} onChange={(v) => set("dimensions", v)} options={[{ v: "smart", l: tr("Chytré kóty") }, { v: "none", l: tr("Žádné") }, { v: "overall", l: tr("Celkové") }, { v: "auto", l: tr("Auto + Ø") }]} />
            </Row>
            {opts.dimensions === "smart" && (
              <div data-smart-dims className="-mt-0.5 mb-1.5 flex items-center gap-1.5">
                <Seg value={opts.dimStyle ?? "chain"} onChange={(v) => set("dimStyle", v)} options={[{ v: "chain", l: tr("řetězově") }, { v: "baseline", l: tr("od základny") }]} />
                <button type="button" onClick={regenSmart} disabled={!smart} title={tr("Nahradí jen vygenerované kóty – vlastní kóty a poznámky zůstanou")} className="shrink-0 rounded-md border border-ink-700/15 px-2 py-1 text-[11px] hover:bg-steel-100 disabled:opacity-40">
                  {tr("Přegenerovat kóty")}
                </button>
              </div>
            )}
            <p className="-mt-1 mb-1.5 text-[10.5px] leading-snug text-ink-700/50">{tr("Auto + Ø je jen pomocný základ: funkční kóty, tolerance (H8, ±0,1) a drsnosti doplňte ručně. „Kontrola kót“ v sekci Kóty a poznámky ukáže, co chybí.")}</p>
            {bom?.length ? (
              <Check checked={showBom} onChange={setShowBom}>
                {tr("Kusovník nad razítkem (")}{bom.length} {tr("pol.)")}
              </Check>
            ) : null}
            {balloons?.length ? (
              <Check checked={opts.balloons !== false} onChange={(v) => set("balloons", v)}>
                {tr("Pozice komponent – balónky (")}{balloons.length})
              </Check>
            ) : null}
            <Check checked={!!opts.holeTable} onChange={(v) => set("holeTable", v)}>
              {tr("Tabulka děr (X, Y, Ø v půdorysu)")}
            </Check>
          </Section>

          <Section title={tr("Detailní pohledy")}>
            {(opts.details ?? []).length === 0 && <p className="text-[11px] text-ink-700/50">{tr("Nástroj „Detail“ (L): střed, poloměr, umístění.")}</p>}
            {(opts.details ?? []).map((d) => (
              <div key={d.id} className="flex items-center gap-2 py-0.5 text-[12px]">
                <span className="w-6 font-semibold">{d.label}</span>
                <span className="text-ink-700/55">{tr(VIEW_LABEL[d.view as ViewKey] ?? d.view)}</span>
                <select
                  className="ml-auto rounded border border-ink-700/15 bg-white px-1 py-0.5 text-[11.5px]"
                  value={String(d.scale)}
                  onChange={(e) => set("details", (opts.details ?? []).map((x) => (x.id === d.id ? { ...x, scale: Number(e.target.value), at: undefined } : x)))}
                >
                  {STANDARD_SCALES.filter((x) => x >= 1).map((x) => (
                    <option key={x} value={String(x)}>
                      {scaleLabel(x)}
                    </option>
                  ))}
                </select>
                <button type="button" title={tr("Smazat detail")} onClick={() => set("details", (opts.details ?? []).filter((x) => x.id !== d.id))} className="text-ink-700/40 hover:text-brand">
                  ×
                </button>
              </div>
            ))}
          </Section>

          <ModelsSection doc={doc} models={opts.models ?? []} onChange={(m) => set("models", m)} flash={flash} />

          <Section title={tr("Razítko")}>
            <Row label={tr("Název")}>
              <TextInput value={meta.name} onChange={(v) => setM({ name: v })} />
            </Row>
            <Row label={tr("Číslo výkresu")}>
              <TextInput value={meta.number ?? ""} onChange={(v) => setM({ number: v })} onBlur={persistProps} placeholder={tr("např. MN-2026-001")} />
            </Row>
            <div className="grid grid-cols-2 gap-2">
              <Row label={tr("Kreslil")}>
                <TextInput value={meta.author ?? ""} onChange={(v) => setM({ author: v })} onBlur={persistProps} />
              </Row>
              <Row label={tr("Revize")}>
                <TextInput value={meta.revision ?? ""} onChange={(v) => setM({ revision: v })} onBlur={persistProps} placeholder="A" />
              </Row>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Row label={tr("Datum")}>
                <TextInput value={meta.date ?? ""} onChange={(v) => setM({ date: v })} />
              </Row>
              <Row label={tr("Nepředepsané tolerance")}>
                <TextInput value={meta.tolerance ?? ""} onChange={(v) => setM({ tolerance: v })} placeholder={tr("např. ISO 2768-mK")} />
              </Row>
            </div>
            <Row label={tr("Opracování hran")}>
              <TextInput value={meta.edges ?? ""} onChange={(v) => setM({ edges: v })} placeholder={tr("např. srazit 0,5×45°")} />
            </Row>
            <Row label={tr("Poznámka v patičce")}>
              <TextInput value={meta.note ?? ""} onChange={(v) => setM({ note: v })} placeholder={tr("např. Nekótované rozměry dle 3D modelu (STEP)")} />
            </Row>
            <p className="-mt-0.5 mb-1.5 text-[10.5px] leading-snug text-ink-700/50">
              {tr("Výrobní požadavky ani poznámky se na výkres nedoplňují automaticky – uvedou se jen vyplněné.")}{" "}
              {!meta.tolerance && !meta.edges && !meta.note && (
                <button type="button" className="text-brand underline-offset-2 hover:underline" onClick={() => setM({ tolerance: "ISO 2768-mK", edges: "srazit 0,5×45°", note: tr("Nekótované rozměry dle 3D modelu (STEP)") })}>
                  {tr("Doplnit obvyklé (ISO 2768-mK, hrany 0,5×45°, poznámka k modelu)")}
                </button>
              )}
            </p>
            <Row label={tr("Materiál")}>
              <TextInput value={meta.material} onChange={(v) => setM({ material: v })} onBlur={() => onMaterialChange?.(meta.material)} placeholder={tr("označení do razítka, např. ČSN 11 423")} />
            </Row>
          </Section>

          <Section title={tr("Tabulka revizí")}>
            {(meta.revisions ?? []).map((r, i) => (
              <div key={i} className="mb-1.5 rounded border border-ink-700/10 p-1.5">
                <div className="grid grid-cols-[2.2rem_1fr_1fr] gap-1">
                  <TextInput value={r.rev} placeholder="A" onChange={(v) => setM({ revisions: (meta.revisions ?? []).map((x, k) => (k === i ? { ...x, rev: v } : x)) })} />
                  <TextInput value={r.date} placeholder="datum" onChange={(v) => setM({ revisions: (meta.revisions ?? []).map((x, k) => (k === i ? { ...x, date: v } : x)) })} />
                  <TextInput value={r.author ?? ""} placeholder="kreslil" onChange={(v) => setM({ revisions: (meta.revisions ?? []).map((x, k) => (k === i ? { ...x, author: v } : x)) })} />
                </div>
                <div className="mt-1 flex gap-1">
                  <TextInput value={r.note} placeholder={tr("popis změny")} onChange={(v) => setM({ revisions: (meta.revisions ?? []).map((x, k) => (k === i ? { ...x, note: v } : x)) })} />
                  <button type="button" title={tr("Smazat revizi")} onClick={() => setM({ revisions: (meta.revisions ?? []).filter((_, k) => k !== i) })} className="px-1 text-ink-700/40 hover:text-brand">
                    ×
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                const list: RevisionItem[] = meta.revisions ?? [];
                const next = String.fromCharCode(65 + Math.min(25, list.length));
                setM({ revisions: [...list, { rev: next, date: new Date().toLocaleDateString(cadLocale()), note: "", author: meta.author ?? "" }], revision: next });
              }}
              className="w-full rounded border border-dashed border-ink-700/25 py-1 text-[12px] hover:border-brand hover:text-brand"
            >
              {tr("+ Přidat revizi")}
            </button>
          </Section>
          <p className="px-4 pb-5 text-[11px] leading-relaxed text-ink-700/45">
            {tr("DWG se ukládá přímo v prohlížeči (vrstvy OBRYS/SKRYTE/OSY/KOTY, typy a tloušťky čar, verze AutoCAD 2000–2018+). DXF je ve formátu AutoCAD R12 pro starší a open-source programy (LibreCAD, QCAD).")}
          </p>
        </aside>

        {/* náhled listu */}
        <main
          ref={canvas}
          data-sheet
          data-views={viewsAttr}
          data-sheet-format={res ? `${res.sheet.name} ${res.scale}` : undefined}
          data-stacks={res?.stacks ? JSON.stringify(res.stacks) : undefined}
          className={cn("relative min-w-0 flex-1 touch-none overflow-hidden", annTool ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing")}
          onPointerDown={(e) => {
            if (annTool && e.button === 0) {
              e.preventDefault(); // nebrat fokus formuláři poznámky, který se při kliku otevře
              void onCanvasClick(e);
              return;
            }
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d) setViewTf((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
            if (annTool === "dim") {
              const q = toSheet(e);
              const r = canvas.current?.getBoundingClientRect();
              setCursor(q && r ? { q, x: e.clientX - r.left, y: e.clientY - r.top, shift: e.shiftKey } : null);
            } else if (annTool) {
              const q = toSheet(e);
              setHover(q ? snap(q) : null);
            }
          }}
          onPointerLeave={() => {
            setHover(null);
            setCursor(null);
          }}
          onPointerUp={() => (drag.current = null)}
          onDoubleClick={annTool ? undefined : fit}
        >
          <div className="absolute inset-0 opacity-[0.18]" style={{ backgroundImage: "radial-gradient(circle,#fff 1px,transparent 1px)", backgroundSize: "22px 22px" }} />
          {res && (
            <div
              className="absolute left-0 top-0 origin-top-left bg-white shadow-[0_18px_60px_rgba(0,0,0,.45)] [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
              style={{ width: res.sheet.w * view.z, height: res.sheet.h * view.z, transform: `translate(${view.x}px,${view.y}px)` }}
              dangerouslySetInnerHTML={{ __html: (out ?? res).svg }}
            />
          )}
          {/* překryv: rozpracovaná kóta/poznámka a přichycený bod */}
          {res && annTool && annTool !== "dim" && (
            <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={res.sheet.w * view.z} height={res.sheet.h * view.z} style={{ transform: `translate(${view.x}px,${view.y}px)` }} viewBox={`0 0 ${res.sheet.w} ${res.sheet.h}`}>
              {annPts.map((p, i) => (
                <circle key={i} cx={p[0]} cy={p[1]} r={1.6 / Math.max(0.3, view.z / 3)} fill="#E03930" />
              ))}
              {hover && <circle cx={hover[0]} cy={hover[1]} r={1.4 / Math.max(0.3, view.z / 3)} fill="none" stroke="#f59e0b" strokeWidth={0.5 / Math.max(0.3, view.z / 3)} />}
              {annPts.length > 0 && hover && <polyline points={[...annPts, hover].map((p) => p.join(",")).join(" ")} fill="none" stroke="#E03930" strokeWidth={0.35 / Math.max(0.3, view.z / 3)} strokeDasharray="1.2 0.8" />}
            </svg>
          )}
          {res && lostGeom && (
            <svg data-dim-lost className="pointer-events-none absolute left-0 top-0 overflow-visible" width={res.sheet.w * view.z} height={res.sheet.h * view.z} style={{ transform: `translate(${view.x}px,${view.y}px)` }} viewBox={`0 0 ${res.sheet.w} ${res.sheet.h}`} fontFamily="Roboto, Arial, Helvetica, sans-serif">
              <GeomOverlay g={lostGeom} color="#d97706" width={Math.max(0.35, 1.5 / view.z)} />
            </svg>
          )}
          {/* nástroj Kóta: vybraná geometrie (červeně), co by se vybralo pod kurzorem (oranžově) a náhled kóty */}
          {res && annTool === "dim" && (
            <svg data-dim-overlay className="pointer-events-none absolute left-0 top-0 overflow-visible" width={res.sheet.w * view.z} height={res.sheet.h * view.z} style={{ transform: `translate(${view.x}px,${view.y}px)` }} viewBox={`0 0 ${res.sheet.w} ${res.sheet.h}`} fontFamily="Roboto, Arial, Helvetica, sans-serif">
              {dimSel.map((x, i) => (
                <PickMark key={i} pick={pickSheet(x)} color="#E03930" px={1 / view.z} />
              ))}
              {dimHover?.target && <PickMark pick={dimHover.target} color="#f59e0b" px={1 / view.z} hover />}
              {dimHover?.rubber && <polyline points={dimHover.rubber.map((q) => q.join(",")).join(" ")} fill="none" stroke="#E03930" strokeWidth={1 / view.z} strokeDasharray={`${4 / view.z} ${3 / view.z}`} />}
              {dimHover?.preview && (
                <g data-dim-preview opacity={0.85}>
                  <GeomOverlay g={dimHover.preview} color="#E03930" width={Math.max(LAYER_STYLE.dim.w, 1 / view.z)} />
                </g>
              )}
            </svg>
          )}
          {annTool === "dim" && cursor && dimHover?.label && (
            <div data-dim-hover className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11.5px] text-white shadow-lg" style={{ left: cursor.x + 16, top: cursor.y + 18 }}>
              {dimHover.label}
            </div>
          )}
          {!res && !error && (
            <div className="absolute inset-0 grid place-items-center text-white/80">
              <div className="text-center">
                <span className="mx-auto block h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                <p className="mt-3 text-[13px]">{tr("Promítám pohledy…")}</p>
              </div>
            </div>
          )}
          {error && <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-lg bg-brand px-4 py-2 text-[13px] text-white shadow-lg">{error}</div>}
          {toast && <div className="absolute bottom-12 left-1/2 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[13px] text-white shadow-xl">{toast}</div>}

          {/* zoom */}
          <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg bg-white/95 p-1 shadow-lg" onPointerDown={(e) => e.stopPropagation()}>
            <ZoomBtn onClick={() => setViewTf((v) => zoomAt(v, 1 / 1.25, canvas.current))}>−</ZoomBtn>
            <span className="w-12 text-center font-mono text-[11px] text-ink-700/70">{Math.round((view.z / 3.78) * 100)} %</span>
            <ZoomBtn onClick={() => setViewTf((v) => zoomAt(v, 1.25, canvas.current))}>+</ZoomBtn>
            <button type="button" className="rounded-md px-2 py-1 text-[11.5px] font-medium hover:bg-steel-100" onClick={fit} title={tr("Přizpůsobit (F)")}>
              {tr("Celý list")}
            </button>
          </div>

          {/* stavový řádek */}
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2 font-mono text-[11px]">
            <span className="rounded-full bg-white/90 px-3 py-1 text-ink-700/70">{busy ? tr("Přepočítávám…") : res ? tr("{0} {1}×{2} mm · {3} · {4} ms", res.sheet.name, res.sheet.w, res.sheet.h, res.scale, ms) : "—"}</span>
            {res?.warnings.map((w) => (
              <span key={w} className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">
                {w}
              </span>
            ))}
            {flagged > 0 && (
              <span data-ann-flagged className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">
                {tr("Kóty a poznámky bez geometrie: {0} (⚠ v seznamu)", flagged)}
              </span>
            )}
          </div>
        </main>
      </div>
      {prompt && <AnnPrompt key={prompt.id} kind={prompt.kind} x={prompt.x} y={prompt.y} onDone={prompt.done} onCancel={() => prompt.done({})} />}
      {dimBox &&
        (() => {
          const cur = ann.find((x): x is DimAnn => x.id === dimBox.id && x.type === "dim");
          if (!cur || !res) return null;
          return <DimBox key={dimBox.id} x={dimBox.x} y={dimBox.y} title={annotationGeometry(res, [cur]).texts[0]?.s ?? ""} suffix={dimBox.suffix} offset={dimBox.offset} offsetLabel={offsetLabel(cur)} onChange={editDimBox} onOk={() => setDimBox(null)} onCancel={cancelDimBox} />;
        })()}
    </div>
  );
}

/** Geometrie kót (čáry, šipky, texty v mm listu) jednou barvou – náhled vkládané kóty a zvýraznění kót bez geometrie. */
function GeomOverlay({ g, color, width }: { g: ReturnType<typeof annotationGeometry>; color: string; width: number }) {
  return (
    <>
      {g.polys.map((pl, i) => (pl.fill ? <polygon key={`p${i}`} points={pl.pts.map((q) => q.join(",")).join(" ")} fill={color} /> : <polyline key={`p${i}`} points={pl.pts.map((q) => q.join(",")).join(" ")} fill="none" stroke={color} strokeWidth={width} />))}
      {g.texts.map((t, i) => (
        <text key={`t${i}`} x={t.x} y={t.y} fontSize={t.size} textAnchor={t.anchor ?? "start"} transform={t.rotate ? `rotate(${t.rotate} ${t.x} ${t.y})` : undefined} fill={color}>
          {t.s}
        </text>
      ))}
    </>
  );
}

/** Zvýraznění vybrané / nabízené geometrie kóty v souřadnicích listu (`px` = 1 px náhledu v mm listu). */
function PickMark({ pick, color, px, hover }: { pick: SheetPick; color: string; px: number; hover?: boolean }) {
  const w = (hover ? 3 : 2.2) * px;
  if (pick.kind === "line") return <line data-pick="line" x1={pick.a[0]} y1={pick.a[1]} x2={pick.b[0]} y2={pick.b[1]} stroke={color} strokeWidth={w} strokeLinecap="round" opacity={0.85} />;
  if (pick.kind === "circle") return <circle data-pick="circle" cx={pick.c[0]} cy={pick.c[1]} r={pick.r} fill="none" stroke={color} strokeWidth={w} opacity={0.85} />;
  return <circle data-pick="point" cx={pick.p[0]} cy={pick.p[1]} r={(hover ? 5 : 3.5) * px} fill={hover ? "none" : color} stroke={color} strokeWidth={1.5 * px} />;
}

/** Malé pole u kurzoru po vložení kóty: tolerance / přípona a odsazení. Hodnoty se propisují do kóty hned; Enter potvrdí, Esc vrátí výchozí. */
function DimBox({ x, y, title, suffix, offset, offsetLabel, onChange, onOk, onCancel }: { x: number; y: number; title: string; suffix: string; offset: string; offsetLabel: string; onChange: (p: { suffix?: string; offset?: string }) => void; onOk: () => void; onCancel: () => void }) {
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
    const t = setTimeout(() => first.current?.focus(), 60); // po případném přesunu fokusu výchozí akcí kliknutí
    return () => clearTimeout(t);
  }, []);
  const left = Math.max(8, Math.min(x + 14, window.innerWidth - 250));
  const top = Math.max(8, Math.min(y + 14, window.innerHeight - 190));
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onOk();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };
  const cap = "mb-0.5 block text-[10.5px] font-semibold uppercase tracking-wider text-ink-700/50";
  return (
    <div data-dim-box className="fixed z-[60] w-60 space-y-1.5 rounded-lg border border-ink-700/15 bg-white p-2.5 shadow-2xl" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
      <p data-dim-box-title className="truncate font-mono text-[13px] font-semibold text-brand">
        {title}
      </p>
      <label className="block">
        <span className={cap}>{tr("Tolerance / přípona")}</span>
        <input ref={first} data-dim-suffix autoFocus value={suffix} placeholder={tr("H8 / ±0,1")} onChange={(e) => onChange({ suffix: e.target.value })} onKeyDown={onKey} className={inputCls} />
      </label>
      <label className="block">
        <span className={cap}>{offsetLabel}</span>
        <input data-dim-offset value={offset} inputMode="decimal" onChange={(e) => onChange({ offset: e.target.value })} onKeyDown={onKey} className={cn(inputCls, "font-mono")} />
      </label>
      <p className="text-[10.5px] leading-snug text-ink-700/50">{tr("Enter potvrdí · Esc ponechá výchozí · později lze upravit v seznamu")}</p>
    </div>
  );
}

/** Odsazení kóty v seznamu (potvrzení Enterem nebo opuštěním pole). */
function OffsetInput({ value, title, onCommit }: { value: number; title: string; onCommit: (n: number) => void }) {
  const shown = fmtOffset(value);
  const [t, setT] = useState(shown);
  useEffect(() => setT(shown), [shown]);
  const commit = () => {
    const n = parseNum(t);
    if (n != null && t !== shown) onCommit(n);
    else setT(shown);
  };
  return <input data-dim-list-offset value={t} inputMode="decimal" title={title} aria-label={tr("Odsazení kóty")} onChange={(e) => setT(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} className="w-10 shrink-0 rounded border border-ink-700/15 px-1 py-0.5 text-right font-mono text-[10.5px]" />;
}

/** Malý formulář u kurzoru pro text poznámky / drsnost / geometrickou toleranci. */
function AnnPrompt({ kind, x, y, onDone, onCancel }: { kind: AnnTool; x: number; y: number; onDone: (v: Record<string, string>) => void; onCancel: () => void }) {
  const [v, setV] = useState<Record<string, string>>((): Record<string, string> => (kind === "roughness" ? { ra: "Ra 3,2" } : kind === "gdt" ? { symbol: "pos", value: "0,1", datum: "" } : kind === "text" ? { text: "", size: "3.5" } : { text: "" }));
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
    const t = setTimeout(() => first.current?.focus(), 60); // po případném přesunu fokusu výchozí akcí kliknutí
    return () => clearTimeout(t);
  }, []);
  const left = Math.min(x + 8, window.innerWidth - 300);
  const top = Math.min(y + 8, window.innerHeight - 200);
  const submit = () => onDone(v);
  const field = (k: string, label: string, placeholder = "") => (
    <label className="block">
      <span className="mb-0.5 block text-[10.5px] font-semibold uppercase tracking-wider text-ink-700/50">{label}</span>
      <input ref={k === "text" || k === "ra" || (kind === "gdt" && k === "value") ? first : undefined} autoFocus={k === "text" || k === "ra" || (kind === "gdt" && k === "value")} value={v[k] ?? ""} placeholder={placeholder} onChange={(e) => setV({ ...v, [k]: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }} className={inputCls} />
    </label>
  );
  return (
    <div className="fixed z-[60] w-72 space-y-2 rounded-lg border border-ink-700/15 bg-white p-3 shadow-2xl" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
      {kind === "note" && field("text", tr("Text poznámky"), tr("např. Ostré hrany srazit 0,5×45°"))}
      {kind === "text" && (
        <>
          {field("text", "Text", tr("např. Kalit 58 ± 2 HRC"))}
          {field("size", tr("Výška písma [mm]"))}
        </>
      )}
      {kind === "roughness" && field("ra", "Drsnost", tr("Ra 3,2 / Rz 25"))}
      {kind === "gdt" && (
        <>
          <label className="block">
            <span className="mb-0.5 block text-[10.5px] font-semibold uppercase tracking-wider text-ink-700/50">{tr("Charakteristika")}</span>
            <select value={v.symbol} onChange={(e) => setV({ ...v, symbol: e.target.value })} className={inputCls}>
              {(Object.keys(GDT_LABEL) as GdtSymbol[]).map((k) => (
                <option key={k} value={k}>
                  {tr(GDT_LABEL[k])}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {field("value", "Tolerance", "0,05")}
            {field("datum", tr("Základna"), "A")}
          </div>
        </>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Btn onClick={onCancel}>{tr("Storno")}</Btn>
        <Btn primary onClick={submit}>
          OK
        </Btn>
      </div>
    </div>
  );
}

function zoomAt(v: { x: number; y: number; z: number }, k: number, el: HTMLDivElement | null) {
  const cx = (el?.clientWidth ?? 0) / 2;
  const cy = (el?.clientHeight ?? 0) / 2;
  const z = Math.min(40, Math.max(0.3, v.z * k));
  return { z, x: cx - ((cx - v.x) * z) / v.z, y: cy - ((cy - v.y) * z) / v.z };
}

// ---------- další modely na listu ----------

const MODEL_VIEWS: (ViewKey | "iso")[] = ["front", "top", "left", "right", "back", "bottom", "iso"];

/**
 * Pohledy dalších modelů na listu: komponenty sestavy (podle id – sledují změny dílu) a dokumenty vložené ze souboru
 * (kopie uložená v definici výkresu). Každý model má vlastní pohled a měřítko s popiskem pod pohledem.
 */
function ModelsSection({ doc, models, onChange, flash }: { doc: CadDoc; models: ModelView[]; onChange: (m: ModelView[]) => void; flash: (m: string) => void }) {
  const comps = doc.kind === "assembly" ? (doc.components ?? []) : [];
  const [pick, setPick] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const upd = (id: string, patch: Partial<ModelView>) => onChange(models.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const add = (m: Omit<ModelView, "id" | "view" | "scale">) => onChange([...models, { id: uid(), view: "front", scale: "auto", ...m }]);
  const addComp = () => {
    const c = comps.find((x) => x.id === (pick || comps[0]?.id));
    if (c) add({ name: c.name, source: { kind: "component", compId: c.id } });
  };
  const addFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const d = JSON.parse(await f.text()) as CadDoc;
      if (d.app !== "mnastrojarna-cad" || !Array.isArray(d.features)) throw new Error();
      // do výkresu se ukládá jen geometrie dokumentu (jeho vlastní výkresy ne)
      const { drawings: _d, ...rest } = d;
      void _d;
      add({ name: d.name || f.name, source: { kind: "doc", doc: rest } });
      flash(tr("Model {0} přidán na list.", d.name || f.name));
    } catch {
      flash(tr("Soubor není platný projekt Mnástrojárna CAD."));
    }
  };
  const sel = "min-w-0 flex-1 rounded border border-ink-700/15 bg-white px-1 py-0.5 text-[11.5px]";
  return (
    <Section title={tr("Další modely na listu")}>
      {models.map((m) => (
        <div key={m.id} data-model-row={m.id} className="space-y-1 rounded-md bg-steel-100/60 px-2 py-1.5 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-medium" title={m.name}>
              {m.name}
            </span>
            <span className="shrink-0 text-[10.5px] text-ink-700/45">{m.source.kind === "component" ? tr("komponenta") : tr("ze souboru")}</span>
            <button type="button" title={tr("Odebrat model z listu")} onClick={() => onChange(models.filter((x) => x.id !== m.id))} className="text-ink-700/40 hover:text-brand">
              ×
            </button>
          </div>
          <div className="flex gap-1">
            <select className={sel} aria-label={tr("Pohled modelu")} value={m.view} onChange={(e) => upd(m.id, { view: e.target.value as ModelView["view"] })}>
              {MODEL_VIEWS.map((k) => (
                <option key={k} value={k}>
                  {tr(VIEW_LABEL[k])}
                </option>
              ))}
            </select>
            <select className={sel} aria-label={tr("Měřítko modelu")} value={String(m.scale)} onChange={(e) => upd(m.id, { scale: e.target.value === "auto" ? "auto" : Number(e.target.value) })}>
              <option value="auto">{tr("Automaticky")}</option>
              {STANDARD_SCALES.map((x) => (
                <option key={x} value={String(x)}>
                  {scaleLabel(x)}
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}
      {comps.length > 0 && (
        <div className="flex items-center gap-1">
          <select className={sel} aria-label={tr("Komponenta sestavy")} value={pick || comps[0].id} onChange={(e) => setPick(e.target.value)}>
            {comps.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Btn onClick={addComp} title={tr("Přidat pohled komponenty na list")}>
            {tr("Přidat")}
          </Btn>
        </div>
      )}
      <Btn onClick={() => file.current?.click()} title={tr("Kopie dokumentu se uloží do výkresu")}>
        {tr("Vložit model ze souboru (.mncad)…")}
      </Btn>
      <input
        ref={file}
        type="file"
        accept=".mncad,.json"
        className="hidden"
        data-model-file
        onChange={(e) => {
          void addFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <p className="text-[10.5px] leading-snug text-ink-700/50">{tr("Pohled komponenty sestavy nebo jiného dílu ze souboru na tomtéž listu – každý ve vlastním měřítku uvedeném pod pohledem.")}</p>
    </Section>
  );
}

// ---------- drobné ovládací prvky ----------

const inputCls = "w-full rounded-md border border-ink-700/15 bg-white px-2 py-1 text-[12.5px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/15";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-b border-ink-700/10 px-4 py-3">
      <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-700/45">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <span className="mb-0.5 block text-[11px] text-ink-700/55">{label}</span>
      {children}
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-md bg-steel-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={cn("flex-1 rounded px-1.5 py-1 text-[11.5px] transition", value === o.v ? "bg-white font-semibold text-ink-700 shadow-sm" : "text-ink-700/60 hover:text-ink-700")}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

function Check({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-steel-100", disabled && "cursor-default opacity-60 hover:bg-transparent")}>
      <input type="checkbox" className="h-3.5 w-3.5 accent-[#E03930]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-[12px]">{children}</span>
    </label>
  );
}

function TextInput({ value, onChange, onBlur, placeholder }: { value: string; onChange: (v: string) => void; onBlur?: () => void; placeholder?: string }) {
  return <input className={inputCls} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />;
}

function NumInput({ value, onChange, suffix }: { value: number; onChange: (v: number) => void; suffix?: string }) {
  const [t, setT] = useState(String(value));
  useEffect(() => setT(String(value)), [value]);
  const commit = () => {
    const n = Number(t.replace(",", "."));
    if (Number.isFinite(n)) onChange(n);
    else setT(String(value));
  };
  return (
    <span className="flex items-center rounded-md border border-ink-700/15 focus-within:border-brand">
      <input className="w-full min-w-0 bg-transparent px-2 py-1 font-mono text-[12.5px] outline-none" value={t} inputMode="decimal" onChange={(e) => setT(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
      {suffix && <span className="pr-2 font-mono text-[11px] text-ink-700/40">{suffix}</span>}
    </span>
  );
}

function Btn({ children, onClick, primary, disabled, title }: { children: React.ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition disabled:opacity-40",
        primary ? "bg-brand text-white hover:bg-brand-600" : "border border-ink-700/12 bg-white text-ink-700 hover:bg-steel-100",
      )}
    >
      {children}
    </button>
  );
}

function ZoomBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="grid h-7 w-7 place-items-center rounded-md text-[15px] font-semibold hover:bg-steel-100">
      {children}
    </button>
  );
}
