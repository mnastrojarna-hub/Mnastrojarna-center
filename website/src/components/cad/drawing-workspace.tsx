"use client";

/**
 * Výkresové prostředí (jako list výkresu v ZW3D / Inventoru): vlevo nastavení listu, pohledů, řezu,
 * kót a razítka; uprostřed živý náhled listu (kolečko = zoom, tažení = posun); nahoře export PDF / DWG / DXF / SVG / tisk.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cad } from "@/cad/client";
import { bomToCsv, defaultDrawingOptions, GDT_LABEL, scaleLabel, sheetToAnn, STANDARD_SCALES, VIEW_LABEL, viewAt, withAnnotations, type BomItem, type DrawingMeta, type DrawingOptions, type DrawingResult, type SheetName, type ViewKey } from "@/cad/drawing";
import { DWG_VERSIONS, type DwgVersion } from "@/cad/formats/dwg-versions";
import { uid, type CadDoc, type DrawingAnnotation, type DrawingDoc, type GdtSymbol, type PlaneName, type Vec2, type Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";

type Props = {
  doc: CadDoc;
  massKg?: number;
  materialLabel: string;
  onClose: () => void;
  /** kusovník sestavy (volitelné) */
  bom?: BomItem[];
  /** obálka modelu – pro výchozí polohu řezu */
  bbox?: [Vec3, Vec3];
  /** uložení údajů razítka zpět do dokumentu */
  onPropsChange?: (p: NonNullable<CadDoc["props"]>) => void;
  /** výkresy uložené v dokumentu (volby, razítko, kóty a poznámky) */
  drawings?: DrawingDoc[];
  onDrawingsChange?: (d: DrawingDoc[]) => void;
};

type AnnTool = "dim" | "note" | "roughness" | "gdt" | "datum" | "text";
type DimKind = "auto" | "aligned" | "horizontal" | "vertical";
const ANN_TOOLS: { id: AnnTool; label: string; kbd: string; hint: string }[] = [
  { id: "dim", label: "Kóta", kbd: "D", hint: "2 body + umístění kótovací čáry" },
  { id: "note", label: "Poznámka", kbd: "N", hint: "odkazová čára + text" },
  { id: "roughness", label: "Drsnost", kbd: "R", hint: "značka ISO 1302 na povrch" },
  { id: "gdt", label: "Geom. tolerance", kbd: "G", hint: "rámeček ISO 1101 s odkazem" },
  { id: "datum", label: "Základna", kbd: "B", hint: "A, B, C…" },
  { id: "text", label: "Text", kbd: "T", hint: "volný text na listu" },
];
const ANN_LABEL: Record<DrawingAnnotation["type"], string> = { dim: "Kóta", note: "Poznámka", roughness: "Drsnost", gdt: "Tolerance", datum: "Základna", text: "Text" };

const OPTS_KEY = "mn-cad-drawing-opts-v1";

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const safeName = (s: string) => (s || "vykres").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(0, 60);

function printSvg(svg: string, w: number, h: number) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(iframe);
  const d = iframe.contentDocument!;
  d.open();
  d.write(`<!doctype html><html><head><title>Výkres</title><style>@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0}svg{width:${w}mm;height:${h}mm;display:block}</style></head><body>${svg}</body></html>`);
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
    if (raw) {
      const o = JSON.parse(raw) as Partial<DrawingOptions>;
      return { ...defaultDrawingOptions, ...o, views: { ...defaultDrawingOptions.views, ...(o.views ?? {}) }, section: null };
    }
  } catch {
    /* nedostupné úložiště */
  }
  return defaultDrawingOptions;
}

export function DrawingWorkspace({ doc, massKg, materialLabel, onClose, bom, bbox, onPropsChange, drawings, onDrawingsChange }: Props) {
  const [opts, setOpts] = useState<DrawingOptions>(defaultDrawingOptions);
  const [meta, setMeta] = useState<DrawingMeta>(() => ({
    name: doc.name,
    material: materialLabel,
    massKg,
    number: doc.props?.number ?? "",
    author: doc.props?.author ?? "",
    revision: doc.props?.revision ?? "",
    date: new Date().toLocaleDateString("cs-CZ"),
    tolerance: "ISO 2768-mK",
  }));
  const [showBom, setShowBom] = useState(!!bom?.length);
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
  const saved = drawings?.[0];
  const [ann, setAnn] = useState<DrawingAnnotation[]>(() => saved?.annotations ?? []);
  const [annTool, setAnnTool] = useState<AnnTool | null>(null);
  const [dimKind, setDimKind] = useState<DimKind>("auto");
  const [annPts, setAnnPts] = useState<Vec2[]>([]);
  const [hover, setHover] = useState<Vec2 | null>(null);
  const [prompt, setPrompt] = useState<null | { kind: AnnTool; x: number; y: number; done: (v: Record<string, string>) => void }>(null);
  const dirty = useRef(false);

  useEffect(() => {
    if (saved?.options) setOpts({ ...defaultDrawingOptions, ...(saved.options as Partial<DrawingOptions>), views: { ...defaultDrawingOptions.views, ...((saved.options as Partial<DrawingOptions>).views ?? {}) } });
    else setOpts(loadOpts());
    if (saved?.meta) setMeta((m) => ({ ...m, ...(saved.meta as Partial<DrawingMeta>), material: materialLabel, massKg }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // uložení do dokumentu (po změně kót, voleb nebo razítka)
  useEffect(() => {
    if (!dirty.current || !onDrawingsChange) return;
    const t = setTimeout(() => {
      const { bom: _b, massKg: _m, material: _mat, ...metaRest } = meta;
      void _b;
      void _m;
      void _mat;
      onDrawingsChange([{ id: saved?.id ?? "main", name: meta.name, options: { ...opts, section: opts.section } as unknown as Record<string, unknown>, meta: metaRest as unknown as Record<string, unknown>, annotations: ann }]);
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ann, opts, meta]);
  const markDirty = () => (dirty.current = true);
  useEffect(() => {
    try {
      localStorage.setItem(OPTS_KEY, JSON.stringify({ ...opts, section: undefined }));
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
        const d = await cad.drawing(doc, { ...meta, bom: showBom ? bom : undefined }, opts);
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
  }, [doc, meta, opts, bom, showBom]);

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

  // výsledek včetně uživatelských kót a poznámek
  const out = useMemo(() => (res ? withAnnotations(res, ann) : null), [res, ann]);

  // ---------- export ----------
  const base = safeName(meta.name || doc.name);
  const exportPdf = async () => {
    if (!out) return;
    try {
      flash("Generuji PDF…");
      const { drawingToPdf } = await import("@/cad/pdf");
      const blob = await drawingToPdf({ ...out, title: meta.name });
      download(`${base}_vykres.pdf`, blob, "application/pdf");
    } catch (e) {
      flash((e as Error).message || "PDF se nepodařilo vytvořit.");
    }
  };

  const exportDwg = async () => {
    if (!out) return;
    try {
      flash(`Generuji DWG (${dwgVer})…`);
      const { drawingToDwg } = await import("@/cad/formats/dwg");
      const buf = await drawingToDwg(out, { version: dwgVer });
      download(`${base}_vykres.dwg`, buf, "application/acad");
      flash(`DWG ${dwgVer} uloženo (${Math.round(buf.byteLength / 1024)} kB).`);
    } catch (e) {
      flash((e as Error).message || "DWG se nepodařilo vytvořit.");
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea,select")) return;
      if (e.key === "Escape") {
        if (prompt) return setPrompt(null);
        if (annTool) {
          setAnnTool(null);
          setAnnPts([]);
          return;
        }
        return onClose();
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, fit, annTool, prompt, ann.length]);

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
  const ask = (kind: AnnTool, e: { clientX: number; clientY: number }) => new Promise<Record<string, string> | null>((resolve) => setPrompt({ kind, x: e.clientX, y: e.clientY, done: (v) => { setPrompt(null); resolve(v); } }));
  const onCanvasClick = async (e: React.PointerEvent) => {
    if (!annTool || !res) return;
    const raw = toSheet(e);
    if (!raw) return;
    const q = snap(raw);
    const pts = [...annPts, q];
    switch (annTool) {
      case "dim": {
        if (pts.length < 3) return setAnnPts(pts);
        const [A, B, C] = pts;
        const dx = B[0] - A[0];
        const dy = B[1] - A[1];
        let kind: Exclude<DimKind, "auto"> = dimKind === "auto" ? (Math.abs(dx) > 3 * Math.abs(dy) ? "horizontal" : Math.abs(dy) > 3 * Math.abs(dx) ? "vertical" : "aligned") : dimKind;
        if (Math.hypot(dx, dy) < 1e-6) kind = "horizontal";
        let offset: number;
        if (kind === "horizontal") offset = C[1] - A[1];
        else if (kind === "vertical") offset = C[0] - A[0];
        else {
          const l = Math.hypot(dx, dy) || 1;
          offset = (-(dy / l)) * (C[0] - A[0]) + (dx / l) * (C[1] - A[1]);
        }
        const loc = localize([A, B]);
        return addAnn({ id: uid(), view: loc.view, type: "dim", a: loc.pts[0], b: loc.pts[1], kind, offset });
      }
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
    }
  };

  const scaleValue = opts.scale === "auto" ? "auto" : String(opts.scale);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#4b5058] text-[12.5px] text-ink-700">
      {/* horní lišta */}
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-black/10 bg-white px-3">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-brand" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <rect x="3" y="4" width="18" height="16" rx="1" />
          <path d="M3 15h18M13 15v5M6 8h6M6 11h4" />
        </svg>
        <p className="min-w-0 truncate text-[13px] font-semibold">
          Výkres <span className="font-normal text-ink-700/50">· {doc.name}</span>
        </p>
        {res && (
          <span className="hidden rounded-md bg-steel-100 px-2 py-0.5 font-mono text-[11px] text-ink-700/70 sm:inline">
            {res.sheet.name} · {res.scale} · ISO {opts.projection}
          </span>
        )}
        <div className="flex-1" />
        <Btn primary onClick={exportPdf} disabled={!res}>
          PDF
        </Btn>
        <span className="inline-flex items-stretch overflow-hidden rounded-md border border-ink-700/15 bg-white">
          <button type="button" onClick={exportDwg} disabled={!res} title={`DWG ${DWG_VERSIONS.find((v) => v.id === dwgVer)?.hint ?? ""} – přímo do AutoCADu, ZWCADu, BricsCADu`} className="px-3 py-1.5 text-[12.5px] font-medium hover:bg-steel-100 disabled:opacity-40">
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
            aria-label="Verze DWG"
            title="Verze souboru DWG"
            className="border-l border-ink-700/15 bg-steel-100 px-1.5 text-[11px] text-ink-700/80 outline-none"
          >
            {DWG_VERSIONS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </span>
        <Btn onClick={() => out && download(`${base}_vykres.dxf`, out.dxf, "application/dxf")} disabled={!res} title="DXF (AutoCAD R12) – otevře AutoCAD, ZWCAD, DraftSight, LibreCAD">
          DXF
        </Btn>
        <Btn onClick={() => out && download(`${base}_vykres.svg`, out.svg, "image/svg+xml")} disabled={!res}>
          SVG
        </Btn>
        {bom?.length ? <Btn onClick={() => download(`${base}_kusovnik.csv`, bomToCsv(bom), "text/csv;charset=utf-8")}>Kusovník CSV</Btn> : null}
        <Btn onClick={() => out && printSvg(out.svg, out.sheet.w, out.sheet.h)} disabled={!res}>
          Tisk
        </Btn>
        <div className="mx-1 h-6 w-px bg-ink-700/10" />
        <Btn onClick={onClose} title="Zpět do 3D (Esc)">
          Zavřít
        </Btn>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* nastavení */}
        <aside className="w-[272px] shrink-0 overflow-y-auto border-r border-black/10 bg-white">
          <Section title="Kóty a poznámky">
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
              <div className="mt-2 flex rounded-md bg-steel-100 p-0.5">
                {(["auto", "aligned", "horizontal", "vertical"] as DimKind[]).map((k) => (
                  <button key={k} type="button" onClick={() => setDimKind(k)} className={cn("flex-1 rounded px-1 py-0.5 text-[11px]", dimKind === k ? "bg-white shadow-sm" : "text-ink-700/60")}>
                    {k === "auto" ? "Auto" : k === "aligned" ? "Šikmá" : k === "horizontal" ? "Vodor." : "Svislá"}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px] leading-snug text-ink-700/55">
              {annTool ? (annTool === "dim" ? `Klikněte na 2 body geometrie (přichytávání k vrcholům) a pak na místo kótovací čáry. Vybráno ${annPts.length}/3.` : annTool === "note" || annTool === "gdt" ? `1. klik = kam šipka ukazuje, 2. klik = umístění. (${annPts.length}/2)` : "Klikněte na místo ve výkresu.") : "Kóty a poznámky jsou asociativní – drží se geometrie pohledu i po změně modelu. Ukládají se do dokumentu."}
            </p>
            {ann.length > 0 && (
              <ul className="mt-2 max-h-44 space-y-0.5 overflow-y-auto">
                {ann.map((a, i) => (
                  <li key={a.id} className="flex items-center gap-2 rounded px-1.5 py-0.5 text-[11.5px] hover:bg-steel-100">
                    <span className="w-16 shrink-0 text-ink-700/50">{ANN_LABEL[a.type]}</span>
                    <span className="min-w-0 flex-1 truncate">{a.type === "dim" ? `${a.kind === "horizontal" ? "↔" : a.kind === "vertical" ? "↕" : "⤢"} ${a.view}` : a.type === "note" || a.type === "text" ? a.text : a.type === "roughness" ? a.ra : a.type === "gdt" ? `${GDT_LABEL[a.symbol]} ${a.value}${a.datum ? " " + a.datum : ""}` : a.label}</span>
                    <button
                      type="button"
                      title="Smazat"
                      onClick={() => {
                        setAnn((l) => l.filter((_, k) => k !== i));
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
                  markDirty();
                }}
                className="mt-1 text-[11px] text-ink-700/50 hover:text-brand"
              >
                Smazat vše ({ann.length})
              </button>
            )}
          </Section>
          <Section title="List">
            <Row label="Formát">
              <select className={inputCls} value={opts.sheet} onChange={(e) => set("sheet", e.target.value as DrawingOptions["sheet"])}>
                <option value="auto">Automaticky</option>
                {(["A4", "A3", "A2", "A1", "A0"] as SheetName[]).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Row>
            <Seg value={opts.orientation} onChange={(v) => set("orientation", v)} options={[{ v: "landscape", l: "Na šířku" }, { v: "portrait", l: "Na výšku" }]} />
            <Row label="Měřítko">
              <select className={inputCls} value={scaleValue} onChange={(e) => set("scale", e.target.value === "auto" ? "auto" : Number(e.target.value))}>
                <option value="auto">Automaticky</option>
                {STANDARD_SCALES.map((s) => (
                  <option key={s} value={String(s)}>
                    {scaleLabel(s)}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Promítání">
              <Seg value={opts.projection} onChange={(v) => set("projection", v)} options={[{ v: "E", l: "ISO E (EU)" }, { v: "A", l: "ISO A (US)" }]} />
            </Row>
          </Section>

          <Section title="Pohledy">
            <div className="grid grid-cols-2 gap-1">
              {(["front", "top", "left", "right", "back", "bottom", "iso"] as (ViewKey | "iso")[]).map((k) => (
                <Check key={k} checked={opts.views[k]} onChange={(v) => setView(k, v)} disabled={k === "front"}>
                  {VIEW_LABEL[k]}
                </Check>
              ))}
            </div>
          </Section>

          <Section title="Řez A–A">
            <Check
              checked={!!opts.section}
              onChange={(v) => set("section", v ? { plane: "XZ", offset: centerOf("XZ") } : null)}
            >
              Zobrazit řez se šrafováním
            </Check>
            {opts.section && (
              <>
                <Seg
                  value={opts.section.plane}
                  onChange={(p) => set("section", { plane: p, offset: centerOf(p) })}
                  options={[
                    { v: "XZ", l: "XZ (čelní)" },
                    { v: "YZ", l: "YZ (boční)" },
                    { v: "XY", l: "XY (vodor.)" },
                  ]}
                />
                <Row label="Poloha roviny">
                  <NumInput value={opts.section.offset} onChange={(n) => set("section", { ...opts.section!, offset: n })} suffix="mm" />
                </Row>
              </>
            )}
          </Section>

          <Section title="Zobrazení a kóty">
            <Check checked={opts.hidden} onChange={(v) => set("hidden", v)}>
              Skryté hrany (čárkovaně)
            </Check>
            <Check checked={opts.centerLines} onChange={(v) => set("centerLines", v)}>
              Osy děr a válců
            </Check>
            <Row label="Kóty">
              <Seg value={opts.dimensions} onChange={(v) => set("dimensions", v)} options={[{ v: "none", l: "Žádné" }, { v: "overall", l: "Celkové" }, { v: "auto", l: "Auto + Ø" }]} />
            </Row>
            {bom?.length ? (
              <Check checked={showBom} onChange={setShowBom}>
                Kusovník nad razítkem ({bom.length} pol.)
              </Check>
            ) : null}
          </Section>

          <Section title="Razítko">
            <Row label="Název">
              <TextInput value={meta.name} onChange={(v) => setM({ name: v })} />
            </Row>
            <Row label="Číslo výkresu">
              <TextInput value={meta.number ?? ""} onChange={(v) => setM({ number: v })} onBlur={persistProps} placeholder="např. MN-2026-001" />
            </Row>
            <div className="grid grid-cols-2 gap-2">
              <Row label="Kreslil">
                <TextInput value={meta.author ?? ""} onChange={(v) => setM({ author: v })} onBlur={persistProps} />
              </Row>
              <Row label="Revize">
                <TextInput value={meta.revision ?? ""} onChange={(v) => setM({ revision: v })} onBlur={persistProps} placeholder="A" />
              </Row>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Row label="Datum">
                <TextInput value={meta.date ?? ""} onChange={(v) => setM({ date: v })} />
              </Row>
              <Row label="Tolerance">
                <TextInput value={meta.tolerance ?? ""} onChange={(v) => setM({ tolerance: v })} />
              </Row>
            </div>
            <Row label="Materiál">
              <TextInput value={meta.material} onChange={(v) => setM({ material: v })} />
            </Row>
          </Section>
          <p className="px-4 pb-5 text-[11px] leading-relaxed text-ink-700/45">
            DWG se ukládá přímo v prohlížeči (vrstvy OBRYS/SKRYTE/OSY/KOTY, typy a tloušťky čar, verze AutoCAD 2000–2018+). DXF je ve formátu AutoCAD R12 pro starší a open-source programy (LibreCAD, QCAD).
          </p>
        </aside>

        {/* náhled listu */}
        <main
          ref={canvas}
          className={cn("relative min-w-0 flex-1 touch-none overflow-hidden", annTool ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing")}
          onPointerDown={(e) => {
            if (annTool && e.button === 0) {
              void onCanvasClick(e);
              return;
            }
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d) setViewTf((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
            if (annTool) {
              const q = toSheet(e);
              setHover(q ? snap(q) : null);
            }
          }}
          onPointerLeave={() => setHover(null)}
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
          {res && annTool && (
            <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={res.sheet.w * view.z} height={res.sheet.h * view.z} style={{ transform: `translate(${view.x}px,${view.y}px)` }} viewBox={`0 0 ${res.sheet.w} ${res.sheet.h}`}>
              {annPts.map((p, i) => (
                <circle key={i} cx={p[0]} cy={p[1]} r={1.6 / Math.max(0.3, view.z / 3)} fill="#E03930" />
              ))}
              {hover && <circle cx={hover[0]} cy={hover[1]} r={1.4 / Math.max(0.3, view.z / 3)} fill="none" stroke="#f59e0b" strokeWidth={0.5 / Math.max(0.3, view.z / 3)} />}
              {annPts.length > 0 && hover && <polyline points={[...annPts, hover].map((p) => p.join(",")).join(" ")} fill="none" stroke="#E03930" strokeWidth={0.35 / Math.max(0.3, view.z / 3)} strokeDasharray="1.2 0.8" />}
            </svg>
          )}
          {!res && !error && (
            <div className="absolute inset-0 grid place-items-center text-white/80">
              <div className="text-center">
                <span className="mx-auto block h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                <p className="mt-3 text-[13px]">Promítám pohledy…</p>
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
            <button type="button" className="rounded-md px-2 py-1 text-[11.5px] font-medium hover:bg-steel-100" onClick={fit} title="Přizpůsobit (F)">
              Celý list
            </button>
          </div>

          {/* stavový řádek */}
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-2 font-mono text-[11px]">
            <span className="rounded-full bg-white/90 px-3 py-1 text-ink-700/70">{busy ? "Přepočítávám…" : res ? `${res.sheet.name} ${res.sheet.w}×${res.sheet.h} mm · ${res.scale} · ${ms} ms` : "—"}</span>
            {res?.warnings.map((w) => (
              <span key={w} className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">
                {w}
              </span>
            ))}
          </div>
        </main>
      </div>
      {prompt && <AnnPrompt kind={prompt.kind} x={prompt.x} y={prompt.y} onDone={prompt.done} onCancel={() => prompt.done({})} />}
    </div>
  );
}

/** Malý formulář u kurzoru pro text poznámky / drsnost / geometrickou toleranci. */
function AnnPrompt({ kind, x, y, onDone, onCancel }: { kind: AnnTool; x: number; y: number; onDone: (v: Record<string, string>) => void; onCancel: () => void }) {
  const [v, setV] = useState<Record<string, string>>((): Record<string, string> => (kind === "roughness" ? { ra: "Ra 3,2" } : kind === "gdt" ? { symbol: "pos", value: "0,1", datum: "" } : kind === "text" ? { text: "", size: "3.5" } : { text: "" }));
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const left = Math.min(x + 8, window.innerWidth - 300);
  const top = Math.min(y + 8, window.innerHeight - 200);
  const submit = () => onDone(v);
  const field = (k: string, label: string, placeholder = "") => (
    <label className="block">
      <span className="mb-0.5 block text-[10.5px] font-semibold uppercase tracking-wider text-ink-700/50">{label}</span>
      <input ref={k === "text" || k === "ra" || (kind === "gdt" && k === "value") ? first : undefined} value={v[k] ?? ""} placeholder={placeholder} onChange={(e) => setV({ ...v, [k]: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }} className={inputCls} />
    </label>
  );
  return (
    <div className="fixed z-[60] w-72 space-y-2 rounded-lg border border-ink-700/15 bg-white p-3 shadow-2xl" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
      {kind === "note" && field("text", "Text poznámky", "např. Ostré hrany srazit 0,5×45°")}
      {kind === "text" && (
        <>
          {field("text", "Text", "např. Kalit 58 ± 2 HRC")}
          {field("size", "Výška písma [mm]")}
        </>
      )}
      {kind === "roughness" && field("ra", "Drsnost", "Ra 3,2 / Rz 25")}
      {kind === "gdt" && (
        <>
          <label className="block">
            <span className="mb-0.5 block text-[10.5px] font-semibold uppercase tracking-wider text-ink-700/50">Charakteristika</span>
            <select value={v.symbol} onChange={(e) => setV({ ...v, symbol: e.target.value })} className={inputCls}>
              {(Object.keys(GDT_LABEL) as GdtSymbol[]).map((k) => (
                <option key={k} value={k}>
                  {GDT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {field("value", "Tolerance", "0,05")}
            {field("datum", "Základna", "A")}
          </div>
        </>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Btn onClick={onCancel}>Storno</Btn>
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
        "rounded-md px-3 py-1.5 text-[12.5px] font-medium transition disabled:opacity-40",
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
