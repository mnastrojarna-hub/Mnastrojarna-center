"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cad } from "@/cad/client";
import { EXAMPLES, FEATURE_LABEL, newFeature, nextName, planeLabel } from "@/cad/defaults";
import { sketchToDxf } from "@/cad/sketch";
import { emptyDoc, uid, type BuildResult, type CadDoc, type Feature, type FeatureType, type SketchEntity, type SketchPlane } from "@/cad/types";
import { MATERIALS, fmtNum, massKg } from "@/lib/mesh-metrics";
import { handoffFiles } from "@/lib/file-handoff";
import { cn } from "@/lib/cn";
import { track } from "../analytics";
import { LogoMark } from "../logo";
import { CadIcon, type CadIconName } from "./cad-icons";
import { EntityProps, FeatureProps } from "./props";
import { Sketcher, type SketchTool } from "./sketcher";
import { Viewport, type PickMode, type ViewportHandle } from "./viewport";

const STORE = "mn-cad-doc-v1";
type Hist = { past: CadDoc[]; present: CadDoc; future: CadDoc[] };

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

function safeName(s: string) {
  return (s || "model").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(0, 60);
}

function printSvg(svg: string, sheet: string) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(iframe);
  const d = iframe.contentDocument!;
  d.open();
  d.write(`<!doctype html><html><head><title>Výkres</title><style>@page{size:${sheet} landscape;margin:0}html,body{margin:0}svg{width:100vw;height:auto;display:block}</style></head><body>${svg}</body></html>`);
  d.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 4000);
  }, 300);
}

const PICK_TYPES = new Set<FeatureType>(["fillet", "chamfer", "shell", "hole"]);

export function CadApp() {
  const router = useRouter();
  const [hist, setHist] = useState<Hist>(() => ({ past: [], present: emptyDoc(), future: [] }));
  const doc = hist.present;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sketchId, setSketchId] = useState<string | null>(null);
  const [sketchSel, setSketchSel] = useState<string | null>(null);
  const [tool, setTool] = useState<SketchTool>("line");
  const [snapGrid, setSnapGrid] = useState(true);
  const [planePick, setPlanePick] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [core, setCore] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [panels, setPanels] = useState(false); // na mobilu zavřené, na desktopu je strom vždy vidět (lg:flex)
  const vp = useRef<ViewportHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast((t) => (t === m ? null : t)), 3200);
  };

  // ---------- historie ----------
  const commit = useCallback((next: CadDoc) => setHist((h) => ({ past: [...h.past.slice(-80), h.present], present: next, future: [] })), []);
  const live = useCallback((next: CadDoc) => setHist((h) => ({ ...h, present: next })), []);
  const undo = () => setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h));
  const redo = () => setHist((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h));

  const updateFeature = (id: string, patch: Partial<Feature>, record = true) => {
    const next = { ...doc, features: doc.features.map((f) => (f.id === id ? ({ ...f, ...patch } as Feature) : f)) };
    (record ? commit : live)(next);
  };

  // ---------- načtení / autosave ----------
  useEffect(() => {
    cad.init().then(
      () => setCore("ready"),
      () => setCore("error"),
    );
    try {
      const raw = localStorage.getItem(STORE);
      const d = raw ? (JSON.parse(raw) as CadDoc) : null;
      if (d?.app === "mnastrojarna-cad" && Array.isArray(d.features)) setHist({ past: [], present: d, future: [] });
      else setHist({ past: [], present: EXAMPLES[0].make(), future: [] });
    } catch {
      setHist({ past: [], present: EXAMPLES[0].make(), future: [] });
    }
    loaded.current = true;
    track("cad_open");
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORE, JSON.stringify(doc));
      } catch {
        /* příliš velké / soukromý režim */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [doc]);

  // ---------- přestavba modelu ----------
  const active = doc.features.find((f) => f.id === activeId) ?? null;
  const activeIndex = active ? doc.features.indexOf(active) : -1;
  const rollback = !!active && PICK_TYPES.has(active.type) && active.type !== "hole";
  const buildDocView = useMemo<CadDoc>(() => {
    if (sketchId) {
      const i = doc.features.findIndex((f) => f.id === sketchId);
      return { ...doc, features: doc.features.slice(0, i) };
    }
    if (rollback || active?.type === "hole") return { ...doc, features: doc.features.slice(0, activeIndex) };
    return doc;
  }, [doc, sketchId, rollback, active?.type, activeIndex]);

  const inflight = useRef(false);
  const queued = useRef<CadDoc | null>(null);
  const runBuild = useCallback(async (d: CadDoc) => {
    if (inflight.current) {
      queued.current = d;
      return;
    }
    inflight.current = true;
    setBusy(true);
    try {
      const res = await cad.build(d);
      setResult(res);
    } catch (e) {
      flash((e as Error).message);
    } finally {
      inflight.current = false;
      setBusy(false);
      if (queued.current) {
        const q = queued.current;
        queued.current = null;
        runBuild(q);
      }
    }
  }, []);
  useEffect(() => {
    if (core !== "ready") return;
    const t = setTimeout(() => runBuild(buildDocView), 120);
    return () => clearTimeout(t);
  }, [buildDocView, core, runBuild]);

  // stav prvků z poslední plné stavby
  const statusOf = (id: string) => result?.status.find((s) => s.id === id);

  // ---------- přidávání prvků ----------
  const addFeature = (type: Exclude<FeatureType, "sketch" | "import" | "pattern">) => {
    if ((type === "extrude" || type === "revolve") && !doc.features.some((f) => f.type === "sketch")) {
      flash("Nejdřív nakreslete skicu (profil).");
      return startSketchMenu();
    }
    const f = newFeature(doc, type);
    commit({ ...doc, features: [...doc.features, f] });
    setActiveId(f.id);
    setMenu(null);
    track("cad_feature", { type });
  };
  const addPattern = () => {
    const last = [...doc.features].reverse().find((f) => ["extrude", "revolve", "box", "cylinder", "sphere", "cone", "tube", "hole"].includes(f.type));
    if (!last) return flash("Pole opakuje existující prvek – nejdřív vytvořte díru nebo vysunutí.");
    const f: Feature = { id: uid(), name: nextName(doc, "pattern"), type: "pattern", featureId: last.id, kind: "circular", count: 6, angle: 360, axis: "Z", center: [0, 0, 0] };
    commit({ ...doc, features: [...doc.features, f] });
    setActiveId(f.id);
  };
  const startSketchMenu = () => setMenu("sketch");
  const createSketch = (plane: SketchPlane) => {
    const f: Feature = { id: uid(), name: nextName(doc, "sketch"), type: "sketch", plane, entities: [] };
    commit({ ...doc, features: [...doc.features, f] });
    setMenu(null);
    setPlanePick(false);
    setActiveId(null);
    setSketchId(f.id);
    setTool("line");
  };
  const finishSketch = () => {
    const sk = doc.features.find((f) => f.id === sketchId);
    setSketchId(null);
    setSketchSel(null);
    if (!sk || sk.type !== "sketch") return;
    // Inventor styl: po dokončení skici rovnou nabídnout vysunutí
    const usedBy = doc.features.some((f) => (f.type === "extrude" || f.type === "revolve") && f.sketchId === sk.id);
    if (!usedBy && sk.entities.length) {
      const hasBody = doc.features.some((f) => f.type !== "sketch");
      const ex = newFeature(doc, "extrude", { sketchId: sk.id, mode: hasBody ? "add" : "new" } as Partial<Feature>);
      commit({ ...doc, features: [...doc.features, ex] });
      setActiveId(ex.id);
    }
  };

  const removeFeature = (id: string) => {
    commit({ ...doc, features: doc.features.filter((f) => f.id !== id) });
    if (activeId === id) setActiveId(null);
    if (sketchId === id) setSketchId(null);
  };

  // ---------- výběr v modelu ----------
  const pickMode: PickMode = planePick
    ? "face-plane"
    : active?.type === "fillet" || active?.type === "chamfer"
      ? active.edges === "all"
        ? "none"
        : "edges"
      : active?.type === "shell" || active?.type === "hole"
        ? "faces"
        : "none";

  const onPickEdge = (i: number) => {
    if (!active || (active.type !== "fillet" && active.type !== "chamfer") || active.edges === "all") return;
    const edges = active.edges.includes(i) ? active.edges.filter((x) => x !== i) : [...active.edges, i];
    updateFeature(active.id, { edges } as Partial<Feature>);
  };
  const onPickFace = async (i: number, point?: [number, number, number]) => {
    if (planePick) {
      const info = await cad.face(i);
      if (!info?.planar) return flash("Skicu lze založit jen na rovinné ploše.");
      return createSketch({ kind: "custom", origin: info.origin, normal: info.normal, xDir: info.xDir, label: `Plocha ${i + 1}` });
    }
    if (active?.type === "shell") {
      const faces = active.faces.includes(i) ? active.faces.filter((x) => x !== i) : [...active.faces, i];
      updateFeature(active.id, { faces } as Partial<Feature>);
    }
    if (active?.type === "hole" && point) {
      const info = await cad.face(i);
      if (!info) return;
      const n = info.normal;
      const k = [0, 1, 2].reduce((a, b) => (Math.abs(n[b]) > Math.abs(n[a]) ? b : a), 0);
      const axis = (["X", "Y", "Z"] as const)[k];
      const round = (v: number) => Math.round(v * 100) / 100;
      updateFeature(active.id, { position: point.map(round) as [number, number, number], axis, flip: n[k] < 0 } as Partial<Feature>);
    }
  };

  // ---------- soubory ----------
  const exportFile = async (format: "step" | "stl") => {
    setMenu(null);
    try {
      flash(`Připravuji ${format.toUpperCase()}…`);
      const buf = await cad.exportFile(doc, format);
      download(`${safeName(doc.name)}.${format === "step" ? "step" : "stl"}`, buf, format === "step" ? "application/step" : "model/stl");
      track("cad_export", { format });
    } catch (e) {
      flash((e as Error).message);
    }
  };
  const exportDrawing = async (format: "pdf" | "dxf" | "svg") => {
    setMenu(null);
    try {
      flash("Generuji výkres…");
      const mat = MATERIALS.find((m) => m.id === doc.material);
      const d = await cad.drawing(doc, { name: doc.name, material: mat?.label ?? doc.material, massKg: result?.metrics ? massKg(result.metrics.volume, mat?.density ?? 7.85) : undefined });
      if (format === "svg") download(`${safeName(doc.name)}_vykres.svg`, d.svg, "image/svg+xml");
      if (format === "dxf") download(`${safeName(doc.name)}_vykres.dxf`, d.dxf, "application/dxf");
      if (format === "pdf") printSvg(d.svg, d.sheet);
      track("cad_export", { format: "drawing-" + format });
    } catch (e) {
      flash((e as Error).message);
    }
  };
  const saveProject = () => {
    setMenu(null);
    download(`${safeName(doc.name)}.mncad`, JSON.stringify(doc, null, 1), "application/json");
  };
  const openFile = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "mncad" || ext === "json") {
      try {
        const d = JSON.parse(await file.text()) as CadDoc;
        if (d.app !== "mnastrojarna-cad") throw new Error();
        commit(d);
        setActiveId(null);
        setSketchId(null);
        flash(`Otevřeno: ${d.name}`);
      } catch {
        flash("Soubor není platný projekt Mnástrojárna CAD.");
      }
      return;
    }
    if (ext === "step" || ext === "stp") {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const f: Feature = { id: uid(), name: `Import ${file.name}`, type: "import", fileName: file.name, format: "step", data: btoa(bin) };
      const base = doc.features.length ? doc : { ...emptyDoc(file.name.replace(/\.[^.]+$/, "")) };
      commit({ ...base, features: [...base.features, f] });
      flash("Model importován – můžete na něj navázat dalšími prvky.");
      return;
    }
    flash("Podporované soubory: .mncad (projekt), .step / .stp");
  };
  const toRfq = async () => {
    try {
      flash("Exportuji model do poptávky…");
      const buf = await cad.exportFile(doc, "step");
      handoffFiles([new File([buf], `${safeName(doc.name)}.step`, { type: "application/step" })]);
      track("cad_to_rfq");
      router.push("/poptavka?z=cad");
    } catch (e) {
      flash((e as Error).message);
    }
  };

  // ---------- klávesy ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea,select")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveProject();
      }
      if (!sketchId && e.key === "Escape") {
        setActiveId(null);
        setPlanePick(false);
        setMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const sketch = doc.features.find((f) => f.id === sketchId) as Extract<Feature, { type: "sketch" }> | undefined;
  const sketchesForView = useMemo(
    () => doc.features.filter((f): f is Extract<Feature, { type: "sketch" }> => f.type === "sketch" && !f.suppressed && (f.id === activeId || !doc.features.some((x) => (x.type === "extrude" || x.type === "revolve") && x.sketchId === f.id))),
    [doc.features, activeId],
  );
  const setSketchEntities = useCallback(
    (entities: SketchEntity[], record = true) => {
      if (!sketchId) return;
      const next = { ...doc, features: doc.features.map((f) => (f.id === sketchId ? ({ ...f, entities } as Feature) : f)) };
      (record ? commit : live)(next);
    },
    [doc, sketchId, commit, live],
  );

  const mat = MATERIALS.find((m) => m.id === doc.material) ?? MATERIALS[0];
  const m = result?.metrics;
  const errors = result?.status.filter((s) => !s.ok) ?? [];

  // ---------- UI ----------
  return (
    <div className="fixed inset-0 flex flex-col bg-[#f6f5f4] text-ink-700" onClick={() => menu && setMenu(null)}>
      {/* Horní lišta */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-ink-700/10 bg-white px-3">
        <Link href="/" className="flex items-center gap-2 pr-2" title="Zpět na web">
          <LogoMark className="h-6 w-6" />
          <span className="hidden font-display text-[15px] font-bold uppercase tracking-tight sm:inline">
            Mnástrojárna <span className="text-brand">CAD</span>
          </span>
        </Link>
        <div className="h-6 w-px bg-ink-700/10" />
        <Menu id="file" label="Soubor" open={menu} setOpen={setMenu}>
          <MenuItem icon="new" onClick={() => { commit(emptyDoc()); setActiveId(null); setSketchId(null); setMenu(null); }}>Nový díl</MenuItem>
          <MenuItem icon="open" onClick={() => fileInput.current?.click()}>Otevřít projekt / STEP…</MenuItem>
          <MenuItem icon="save" onClick={saveProject} kbd="Ctrl+S">Uložit projekt (.mncad)</MenuItem>
          <div className="my-1 border-t border-ink-700/10" />
          <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-widest text-ink-700/40">Ukázky</p>
          {EXAMPLES.map((ex) => (
            <MenuItem key={ex.id} icon="cube" onClick={() => { commit(ex.make()); setActiveId(null); setSketchId(null); setMenu(null); setTimeout(() => vp.current?.fit(), 600); }}>
              {ex.label}
            </MenuItem>
          ))}
        </Menu>
        <Menu id="export" label="Export" open={menu} setOpen={setMenu}>
          <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-widest text-ink-700/40">3D model</p>
          <MenuItem icon="cube" onClick={() => exportFile("step")}>STEP (.step) – pro CAD/CAM</MenuItem>
          <MenuItem icon="cube" onClick={() => exportFile("stl")}>STL (.stl) – 3D tisk</MenuItem>
          <div className="my-1 border-t border-ink-700/10" />
          <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-widest text-ink-700/40">2D výkres</p>
          <MenuItem icon="drawing" onClick={() => exportDrawing("pdf")}>Výkres PDF (tisk)</MenuItem>
          <MenuItem icon="drawing" onClick={() => exportDrawing("dxf")}>Výkres DXF</MenuItem>
          <MenuItem icon="drawing" onClick={() => exportDrawing("svg")}>Výkres SVG</MenuItem>
        </Menu>
        <div className="mx-1 flex">
          <IconBtn icon="undo" title="Zpět (Ctrl+Z)" onClick={undo} disabled={!hist.past.length} />
          <IconBtn icon="redo" title="Znovu (Ctrl+Y)" onClick={redo} disabled={!hist.future.length} />
        </div>
        <input
          value={doc.name}
          onChange={(e) => live({ ...doc, name: e.target.value })}
          onBlur={() => commit(doc)}
          className="hidden min-w-0 flex-1 truncate rounded-md px-2 py-1 text-center text-[14px] font-semibold outline-none hover:bg-steel-100 focus:bg-steel-100 md:block"
          aria-label="Název dílu"
        />
        <div className="flex-1 md:hidden" />
        <span className={cn("hidden items-center gap-1.5 font-mono text-[11px] lg:flex", core === "error" ? "text-brand" : "text-ink-700/45")}>
          <span className={cn("h-2 w-2 rounded-full", core === "ready" ? (busy ? "animate-pulse bg-amber-500" : "bg-emerald-500") : core === "loading" ? "animate-pulse bg-amber-500" : "bg-brand")} />
          {core === "loading" ? "Načítám jádro OpenCascade…" : core === "error" ? "Jádro se nenačetlo" : busy ? "Přepočítávám…" : `Jádro připraveno${result ? ` · ${result.ms} ms` : ""}`}
        </span>
        <button type="button" onClick={toRfq} className="btn-primary ml-2 whitespace-nowrap !px-4 !py-1.5 !text-[13px]">
          Poptat<span className="hidden sm:inline"> výrobu</span>
        </button>
        <input ref={fileInput} type="file" accept=".mncad,.json,.step,.stp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ""; setMenu(null); }} />
      </header>

      {/* Pás nástrojů */}
      <div className="flex h-[66px] shrink-0 items-stretch gap-1 overflow-x-auto border-b border-ink-700/10 bg-white px-2">
        {sketch ? (
          <>
            <ToolGroup label="Kreslení">
              {(
                [
                  ["select", "Výběr", "select", "V"],
                  ["line", "Úsečka", "line", "L"],
                  ["rect", "Obdélník", "rect", "R"],
                  ["circle", "Kružnice", "circle", "C"],
                  ["arc", "Oblouk", "arc", "A"],
                  ["polygon", "Mnohoúhelník", "polygon", "P"],
                  ["slot", "Drážka", "slot", "S"],
                ] as [SketchTool, string, CadIconName, string][]
              ).map(([t, l, i, k]) => (
                <Tool key={t} icon={i} label={l} kbd={k} active={tool === t} onClick={() => setTool(t)} />
              ))}
            </ToolGroup>
            <ToolGroup label="Nastavení">
              <Tool icon="grid" label="Přichytit" active={snapGrid} onClick={() => setSnapGrid((v) => !v)} />
              <Tool icon="drawing" label="Export DXF" onClick={() => download(`${safeName(sketch.name)}.dxf`, sketchToDxf(sketch.entities), "application/dxf")} />
            </ToolGroup>
            <div className="flex-1" />
            <div className="flex items-center pr-2">
              <button type="button" onClick={finishSketch} className="btn-primary !px-5 !py-2 !text-[13px]">
                <CadIcon name="check" className="h-4 w-4" /> Dokončit skicu
              </button>
            </div>
          </>
        ) : (
          <>
            <ToolGroup label="Skica">
              <div className="relative">
                <Tool icon="sketch" label="Nová skica" onClick={(e) => { e.stopPropagation(); setMenu(menu === "sketch" ? null : "sketch"); }} active={menu === "sketch" || planePick} />
                {menu === "sketch" && (
                  <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-xl border border-ink-700/10 bg-white p-1.5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                    <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-widest text-ink-700/40">Rovina skici</p>
                    {(["XY", "XZ", "YZ"] as const).map((p) => (
                      <MenuItem key={p} icon="plane" onClick={() => createSketch({ kind: "base", name: p, offset: 0 })}>
                        Rovina {p} {p === "XY" ? "(půdorys)" : p === "XZ" ? "(nárys)" : "(bokorys)"}
                      </MenuItem>
                    ))}
                    <MenuItem icon="face" onClick={() => { setPlanePick(true); setMenu(null); flash("Klikněte na rovinnou plochu modelu."); }} disabled={!result?.mesh}>
                      Na ploše modelu…
                    </MenuItem>
                  </div>
                )}
              </div>
            </ToolGroup>
            <ToolGroup label="Těleso">
              <Tool icon="extrude" label="Vysunout" onClick={() => addFeature("extrude")} />
              <Tool icon="revolve" label="Rotovat" onClick={() => addFeature("revolve")} />
            </ToolGroup>
            <ToolGroup label="Primitiva">
              <Tool icon="box" label="Kvádr" onClick={() => addFeature("box")} />
              <Tool icon="cylinder" label="Válec" onClick={() => addFeature("cylinder")} />
              <Tool icon="tube" label="Trubka" onClick={() => addFeature("tube")} />
              <Tool icon="cone" label="Kužel" onClick={() => addFeature("cone")} />
              <Tool icon="sphere" label="Koule" onClick={() => addFeature("sphere")} />
            </ToolGroup>
            <ToolGroup label="Úpravy">
              <Tool icon="hole" label="Díra" onClick={() => addFeature("hole")} />
              <Tool icon="fillet" label="Zaoblit" onClick={() => addFeature("fillet")} />
              <Tool icon="chamfer" label="Srazit" onClick={() => addFeature("chamfer")} />
              <Tool icon="shell" label="Skořepina" onClick={() => addFeature("shell")} />
            </ToolGroup>
            <ToolGroup label="Kopie">
              <Tool icon="pattern" label="Pole" onClick={addPattern} />
              <Tool icon="mirror" label="Zrcadlit" onClick={() => addFeature("mirror")} />
            </ToolGroup>
            <ToolGroup label="Pohled">
              <Tool icon="iso" label="Izo" onClick={() => vp.current?.setView("iso")} />
              <Tool icon="front" label="Přední" onClick={() => vp.current?.setView("front")} />
              <Tool icon="top" label="Horní" onClick={() => vp.current?.setView("top")} />
              <Tool icon="right" label="Pravý" onClick={() => vp.current?.setView("right")} />
            </ToolGroup>
          </>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* Strom prvků */}
        <aside className={cn("absolute inset-y-0 left-0 z-20 w-64 shrink-0 flex-col border-r border-ink-700/10 bg-white lg:static lg:flex", panels ? "flex" : "hidden")}>
          <div className="flex items-center justify-between px-4 pb-2 pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-700/45">Strom modelu</p>
            <span className="font-mono text-[11px] text-ink-700/35">{doc.features.length}</span>
          </div>
          <ol className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {doc.features.length === 0 && (
              <li className="m-2 rounded-xl border border-dashed border-ink-700/15 p-4 text-[12px] leading-relaxed text-ink-700/55">
                Začněte <strong>novou skicou</strong> nebo vložte primitivum (kvádr, válec…). Případně otevřete ukázku v menu Soubor.
              </li>
            )}
            {doc.features.map((f) => {
              const st = statusOf(f.id);
              const isActive = f.id === activeId || f.id === sketchId;
              return (
                <li key={f.id}>
                  <div
                    className={cn("group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] transition", isActive ? "bg-brand/10 text-ink-700" : "hover:bg-steel-100", f.suppressed && "opacity-45")}
                    onClick={() => {
                      if (f.type === "sketch") {
                        setActiveId(null);
                        setSketchId(f.id);
                        setTool("select");
                      } else {
                        setSketchId(null);
                        setActiveId(f.id === activeId ? null : f.id);
                      }
                    }}
                  >
                    <CadIcon name={f.type as CadIconName} className={cn("h-4 w-4 shrink-0", isActive ? "text-brand" : "text-ink-700/55")} />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    {st && !st.ok && <span className="h-2 w-2 shrink-0 rounded-full bg-brand" title={st.error} />}
                    <button type="button" title={f.suppressed ? "Zapnout" : "Potlačit"} className="hidden rounded p-0.5 text-ink-700/40 hover:text-ink-700 group-hover:block" onClick={(e) => { e.stopPropagation(); updateFeature(f.id, { suppressed: !f.suppressed }); }}>
                      <CadIcon name="eye" className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" title="Smazat" className="hidden rounded p-0.5 text-ink-700/40 hover:text-brand group-hover:block" onClick={(e) => { e.stopPropagation(); removeFeature(f.id); }}>
                      <CadIcon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {st && !st.ok && isActive && <p className="mx-2 mb-1 rounded-md bg-brand/10 px-2 py-1 text-[11px] text-brand-600">{st.error}</p>}
                </li>
              );
            })}
          </ol>
          <div className="border-t border-ink-700/10 p-3">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-ink-700/40">Materiál</label>
            <select value={doc.material} onChange={(e) => commit({ ...doc, material: e.target.value })} className="w-full rounded-lg border border-ink-700/12 bg-white px-2 py-1.5 text-[13px]">
              {MATERIALS.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label} ({x.density} g/cm³)
                </option>
              ))}
            </select>
          </div>
        </aside>

        {/* Pracovní plocha */}
        <main className="relative min-w-0 flex-1 overflow-hidden">
          <div className={cn("absolute inset-0", sketch && "invisible")}>
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,#ffffff_0%,#f3f2f1_70%,#ebe9e7_100%)]" />
            <Viewport
              ref={vp}
              mesh={result?.mesh ?? null}
              sketches={sketchesForView}
              pickMode={pickMode}
              selectedEdges={active && (active.type === "fillet" || active.type === "chamfer") && active.edges !== "all" ? active.edges : []}
              selectedFaces={active?.type === "shell" ? active.faces : []}
              onPickEdge={onPickEdge}
              onPickFace={onPickFace}
            />
          </div>
          {sketch && (
            <>
              <Sketcher
                key={sketch.id}
                entities={sketch.entities}
                onChange={setSketchEntities}
                selected={sketchSel}
                onSelect={setSketchSel}
                tool={tool}
                setTool={setTool}
                snapGrid={snapGrid}
              />
              <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-ink px-4 py-1.5 font-mono text-[11px] uppercase tracking-widest text-white shadow-lg">
                Skica · {planeLabel(sketch.plane)}
              </div>
            </>
          )}

          {(planePick || rollback || active?.type === "hole") && !sketch && (
            <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-ink px-4 py-1.5 text-[12px] text-white shadow-lg">
              {planePick ? "Klikněte na rovinnou plochu pro novou skicu · Esc zruší" : active?.type === "hole" ? "Klikněte na plochu, kam se má vrtat" : active?.type === "shell" ? "Vyberte plochy, které se otevřou" : "Vyberte hrany v modelu"}
            </div>
          )}

          {core === "loading" && (
            <div className="absolute inset-0 grid place-items-center bg-white/70 backdrop-blur-sm">
              <div className="text-center">
                <span className="mx-auto block h-10 w-10 animate-spin rounded-full border-2 border-ink-700/10 border-t-brand" />
                <p className="mt-4 text-[14px] font-semibold">Načítám CAD jádro OpenCascade</p>
                <p className="mt-1 text-[12px] text-ink-700/55">Jen poprvé – poté se načítá z mezipaměti.</p>
              </div>
            </div>
          )}
          {core === "error" && (
            <div className="absolute inset-0 grid place-items-center bg-white/90">
              <p className="max-w-sm text-center text-[14px]">CAD jádro se nepodařilo načíst. Zkuste prosím aktuální Chrome, Edge, Firefox nebo Safari.</p>
            </div>
          )}

          <button type="button" className={cn("absolute top-3 z-30 rounded-lg border border-ink-700/10 bg-white p-2 shadow-sm lg:hidden", panels ? "left-[15rem]" : "left-3")} onClick={() => setPanels((p) => !p)} aria-label="Strom modelu">
            <CadIcon name="tree" className="h-4 w-4" />
          </button>

          {toast && <div className="absolute bottom-14 left-1/2 z-30 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-[13px] text-white shadow-xl">{toast}</div>}

          {/* Stavový řádek */}
          {!sketch && (
            <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap gap-2 font-mono text-[11px] text-ink-700/70">
              {m ? (
                <>
                  <Chip>
                    {fmtNum(m.bbox[1][0] - m.bbox[0][0], 1)} × {fmtNum(m.bbox[1][1] - m.bbox[0][1], 1)} × {fmtNum(m.bbox[1][2] - m.bbox[0][2], 1)} mm
                  </Chip>
                  <Chip>V {fmtNum(m.volume / 1000, 1)} cm³</Chip>
                  <Chip>
                    {mat.label} {fmtNum(massKg(m.volume, mat.density), 3)} kg
                  </Chip>
                  <Chip>
                    {m.faces} ploch · {m.edges} hran
                  </Chip>
                </>
              ) : (
                <Chip>Prázdný model</Chip>
              )}
              {errors.length > 0 && <Chip warn>{errors.length} prvek s chybou</Chip>}
            </div>
          )}
        </main>

        {/* Vlastnosti */}
        {(active || (sketch && sketchSel)) && (
          <aside className="absolute inset-y-0 right-0 z-20 flex w-72 shrink-0 flex-col border-l border-ink-700/10 bg-white lg:static">
            <div className="flex items-center justify-between border-b border-ink-700/10 px-4 py-3">
              <p className="flex items-center gap-2 text-[13px] font-semibold">
                <CadIcon name={(active?.type ?? "sketch") as CadIconName} className="h-4 w-4 text-brand" />
                {active ? FEATURE_LABEL[active.type] : "Entita skici"}
              </p>
              <button type="button" className="rounded p-1 text-ink-700/50 hover:bg-steel-100" onClick={() => (active ? setActiveId(null) : setSketchSel(null))} aria-label="Zavřít">
                <CadIcon name="x" className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {active && <FeatureProps f={active} doc={doc} onChange={(p) => updateFeature(active.id, p)} />}
              {sketch && sketchSel && (() => {
                const e = sketch.entities.find((x) => x.id === sketchSel);
                return e ? (
                  <>
                    <EntityProps e={e} onChange={(n) => setSketchEntities(sketch.entities.map((x) => (x.id === n.id ? n : x)))} />
                    <button type="button" className="mt-5 w-full rounded-lg border border-ink-700/15 py-2 text-[13px] text-brand hover:bg-brand/5" onClick={() => { setSketchEntities(sketch.entities.filter((x) => x.id !== e.id)); setSketchSel(null); }}>
                      Smazat entitu
                    </button>
                  </>
                ) : null;
              })()}
            </div>
            {active && (
              <div className="flex gap-2 border-t border-ink-700/10 p-3">
                <button type="button" className="btn-primary flex-1 !py-2 !text-[13px]" onClick={() => setActiveId(null)}>
                  <CadIcon name="check" className="h-4 w-4" /> Hotovo
                </button>
                <button type="button" className="rounded-full border border-ink-700/15 px-3 text-[13px] text-brand hover:bg-brand/5" onClick={() => removeFeature(active.id)}>
                  Smazat
                </button>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

// ---------- drobné komponenty ----------

function Chip({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return <span className={cn("rounded-full border px-3 py-1 backdrop-blur", warn ? "border-brand/30 bg-brand/10 text-brand-600" : "border-ink-700/10 bg-white/90")}>{children}</span>;
}

function ToolGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col justify-between border-r border-ink-700/10 px-1 pb-1 pt-1.5 last:border-r-0">
      <div className="flex gap-0.5">{children}</div>
      <p className="text-center text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-700/35">{label}</p>
    </div>
  );
}

function Tool({ icon, label, onClick, active, kbd }: { icon: CadIconName; label: string; onClick: (e: React.MouseEvent) => void; active?: boolean; kbd?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={kbd ? `${label} (${kbd})` : label}
      className={cn("flex w-[58px] flex-col items-center gap-0.5 rounded-lg px-1 py-1 text-[10.5px] leading-tight transition", active ? "bg-brand text-white" : "text-ink-700/80 hover:bg-steel-100 hover:text-ink-700")}
    >
      <CadIcon name={icon} className="h-[22px] w-[22px]" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function IconBtn({ icon, title, onClick, disabled }: { icon: CadIconName; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled} className="rounded-md p-1.5 text-ink-700/70 hover:bg-steel-100 disabled:opacity-30">
      <CadIcon name={icon} className="h-4 w-4" />
    </button>
  );
}

function Menu({ id, label, open, setOpen, children }: { id: string; label: string; open: string | null; setOpen: (v: string | null) => void; children: React.ReactNode }) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(open === id ? null : id);
        }}
        className={cn("rounded-md px-2.5 py-1.5 text-[13px] font-medium", open === id ? "bg-steel-100" : "hover:bg-steel-100")}
      >
        {label}
      </button>
      {open === id && (
        <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-xl border border-ink-700/10 bg-white p-1.5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, children, onClick, kbd, disabled }: { icon: CadIconName; children: React.ReactNode; onClick: () => void; kbd?: string; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-steel-100 disabled:opacity-40">
      <CadIcon name={icon} className="h-4 w-4 text-ink-700/55" />
      <span className="flex-1">{children}</span>
      {kbd && <span className="font-mono text-[10px] text-ink-700/40">{kbd}</span>}
    </button>
  );
}
