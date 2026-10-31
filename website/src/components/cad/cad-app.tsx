"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Interference } from "@/cad/asm-kernel";
import { alignFaces, apply3, bomCsv, computeBom, emptyAssembly, ejectorPin, explodeOffset, guideBush, guidePillar, locatingRing, moldBase, partComponent, placementMatrix, rotMatrix, screwISO4762, sourceKey, transformPoint } from "@/cad/assembly";
import { cad } from "@/cad/client";
import { EXAMPLES, FEATURE_LABEL, newFeature, nextName, planeLabel } from "@/cad/defaults";
import { IMPORT_ACCEPT, prepareImport } from "@/cad/formats/import";
import { resolveDoc } from "@/cad/params";
import { sketchToDxf } from "@/cad/sketch";
import { emptyDoc, uid, type AsmComponent, type BuildResult, type CadDoc, type ExportFormat, type Feature, type FeatureType, type SketchEntity, type SketchPlane, type Vec3 } from "@/cad/types";
import { SALES } from "@/content/site";
import { MATERIALS, fmtNum, massKg } from "@/lib/mesh-metrics";
import { cn } from "@/lib/cn";
import { track } from "../analytics";
import { LogoMark } from "../logo";
import { CadIcon, type CadIconName } from "./cad-icons";
import { AsmProps, AsmTree, BomTable, MoldWizard } from "./asm-panel";
import { FEATURE_TONE, Manager } from "./manager";
import { EntityProps, FeatureProps, ParamContext } from "./props";
import { ContextMenu, Dropdown, Ribbon, type RGroup, type RMenuEntry } from "./ribbon";
import { Sketcher, type SketchTool } from "./sketcher";
import { Viewport, type AsmView, type Datum, type DisplayMode, type MouseScheme, type PickMode, type Section, type ViewName, type ViewportHandle } from "./viewport";

const DrawingWorkspace = dynamic(() => import("./drawing-workspace").then((m) => m.DrawingWorkspace), { ssr: false });

const STORE = "mn-cad-doc-v1";
const PREFS = "mn-cad-prefs-v1";
type Hist = { past: CadDoc[]; present: CadDoc; future: CadDoc[] };
type Tab = "create" | "sketch" | "asm" | "tools" | "view" | "drawing" | "data";
type AddType = Exclude<FeatureType, "sketch" | "import" | "pattern">;

const EXPORTS: { f: ExportFormat; label: string; ext: string; mime: string; hint: string }[] = [
  { f: "step", label: "STEP AP214 (.step)", ext: "step", mime: "application/step", hint: "ZW3D, SolidWorks, Inventor, CATIA, Creo, CAM" },
  { f: "brep", label: "OpenCascade BREP (.brep)", ext: "brep", mime: "application/octet-stream", hint: "přesná geometrie OCCT" },
  { f: "stl", label: "STL (.stl)", ext: "stl", mime: "model/stl", hint: "3D tisk" },
  { f: "3mf", label: "3MF (.3mf)", ext: "3mf", mime: "model/3mf", hint: "3D tisk s jednotkami" },
  { f: "obj", label: "Wavefront OBJ (.obj)", ext: "obj", mime: "model/obj", hint: "vizualizace" },
  { f: "glb", label: "glTF binární (.glb)", ext: "glb", mime: "model/gltf-binary", hint: "web, AR, prezentace" },
  { f: "wrl", label: "VRML (.wrl)", ext: "wrl", mime: "model/vrml", hint: "starší prohlížeče" },
];

const BACKGROUNDS: Record<string, { label: string; css: string; dark?: boolean }> = {
  blue: { label: "Modrošedý přechod", css: "linear-gradient(180deg,#9fb1c4 0%,#d3dce6 52%,#f3f5f8 100%)" },
  light: { label: "Světlý", css: "radial-gradient(ellipse at center,#ffffff 0%,#eef1f4 70%,#e1e6eb 100%)" },
  dark: { label: "Grafit", css: "linear-gradient(180deg,#2a3038 0%,#3b434e 60%,#4b5562 100%)", dark: true },
  white: { label: "Bílý (tisk)", css: "#ffffff" },
};

const COLORS = [
  { c: "#b9c2cc", l: "Ocel" },
  { c: "#d6d9dd", l: "Hliník" },
  { c: "#c9a46a", l: "Mosaz" },
  { c: "#7f8a96", l: "Litina" },
  { c: "#4f81bd", l: "Modrá" },
  { c: "#e0b24a", l: "Žlutá" },
  { c: "#e03930", l: "Červená" },
  { c: "#3a3f45", l: "Černá" },
];

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

const PICK_TYPES = new Set<FeatureType>(["fillet", "chamfer", "shell", "hole", "draft"]);

function loadPrefs(): { display: DisplayMode; mouse: MouseScheme; bg: string; ortho: boolean } {
  const d = { display: "shadedEdges" as DisplayMode, mouse: "zw3d" as MouseScheme, bg: "blue", ortho: false };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(PREFS) ?? "{}") };
  } catch {
    return d;
  }
}

export function CadApp() {
  const [hist, setHist] = useState<Hist>(() => ({ past: [], present: emptyDoc(), future: [] }));
  const doc = hist.present;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editBase, setEditBase] = useState<CadDoc | null>(null);
  const [sketchId, setSketchId] = useState<string | null>(null);
  const [sketchSel, setSketchSel] = useState<string | null>(null);
  const [tool, setTool] = useState<SketchTool>("line");
  const [snapGrid, setSnapGrid] = useState(true);
  const [planePick, setPlanePick] = useState(false);
  const [tab, setTab] = useState<Tab>("create");
  const [result, setResult] = useState<BuildResult | null>(null);
  const [core, setCore] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  const [panels, setPanels] = useState(false);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [section, setSection] = useState<Section>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [measure, setMeasure] = useState(false);
  const [measurePts, setMeasurePts] = useState<Vec3[]>([]);
  const [massOpen, setMassOpen] = useState(false);
  const [drawingOpen, setDrawingOpen] = useState(false);
  const [appMenu, setAppMenu] = useState(false);
  const [ctx, setCtx] = useState<{ x: number; y: number; entries: RMenuEntry[] } | null>(null);
  const [cursor, setCursor] = useState<Vec3 | null>(null);
  // sestavy
  const [asmSel, setAsmSel] = useState<string | null>(null);
  const asmCache = useRef(new Map<string, BuildResult>());
  const [asmVer, setAsmVer] = useState(0);
  const [asmLoading, setAsmLoading] = useState(0);
  const [explode, setExplode] = useState(0);
  const [clashes, setClashes] = useState<Interference[] | null>(null);
  const [mate, setMate] = useState<{ mode: "mate" | "flush" | "center"; compId: string; local?: { origin: Vec3; normal: Vec3 } } | null>(null);
  const [bomOpen, setBomOpen] = useState(false);
  const [moldOpen, setMoldOpen] = useState(false);
  const [parentAsm, setParentAsm] = useState<{ asm: CadDoc; key: string } | null>(null);
  const vp = useRef<ViewportHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast((t) => (t === m ? null : t)), 3600);
  };
  const setPref = <K extends keyof ReturnType<typeof loadPrefs>>(k: K, v: ReturnType<typeof loadPrefs>[K]) =>
    setPrefs((p) => {
      const n = { ...p, [k]: v };
      try {
        localStorage.setItem(PREFS, JSON.stringify(n));
      } catch {
        /* soukromý režim */
      }
      return n;
    });

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
  const rollback = !!active && PICK_TYPES.has(active.type);
  const buildDocView = useMemo<CadDoc>(() => {
    if (sketchId) {
      const i = doc.features.findIndex((f) => f.id === sketchId);
      return { ...doc, features: doc.features.slice(0, i) };
    }
    if (rollback) return { ...doc, features: doc.features.slice(0, activeIndex) };
    return doc;
  }, [doc, sketchId, rollback, activeIndex]);

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
  const isAsm = doc.kind === "assembly";
  useEffect(() => {
    if (core !== "ready") return;
    if (buildDocView.kind === "assembly") {
      setResult(null);
      return;
    }
    const t = setTimeout(() => runBuild(buildDocView), 120);
    return () => clearTimeout(t);
  }, [buildDocView, core, runBuild]);

  const resolved = useMemo(() => resolveDoc(doc), [doc]);

  // ---------- sestava: sítě dílů (mezipaměť podle obsahu) ----------
  const compKeys = useMemo(() => new Map((doc.components ?? []).map((c) => [c.id, sourceKey(c.source)])), [doc.components]);
  useEffect(() => {
    if (core !== "ready" || !isAsm) return;
    const need = new Map<string, AsmComponent["source"]>();
    for (const c of doc.components ?? []) {
      const k = compKeys.get(c.id)!;
      if (!asmCache.current.has(k)) need.set(k, c.source);
    }
    if (!need.size) return;
    let alive = true;
    setAsmLoading((n) => n + 1);
    cad
      .asmParts([...need.entries()].map(([key, source]) => ({ key, source })))
      .then((res) => {
        for (const r of res) asmCache.current.set(r.key, r.result);
        if (alive) setAsmVer((v) => v + 1);
      })
      .catch((e) => flash((e as Error).message))
      .finally(() => setAsmLoading((n) => n - 1));
    return () => {
      alive = false;
    };
  }, [doc.components, compKeys, core, isAsm]);

  const asmViews = useMemo<AsmView[]>(() => {
    if (!isAsm) return [];
    const comps = (doc.components ?? []).filter((c) => !c.hidden);
    const centers = new Map<string, Vec3>();
    for (const c of comps) {
      const r = asmCache.current.get(compKeys.get(c.id)!);
      const b = r?.metrics?.bbox;
      if (b) centers.set(c.id, transformPoint(c.placement, [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2, (b[0][2] + b[1][2]) / 2]));
    }
    const all = [...centers.values()];
    const mid: Vec3 = all.length ? ([0, 1, 2].map((k) => all.reduce((s, v) => s + v[k], 0) / all.length) as Vec3) : [0, 0, 0];
    const clashIds = new Set((clashes ?? []).flatMap((x) => [x.a, x.b]));
    const out: AsmView[] = [];
    for (const c of comps) {
      const key = compKeys.get(c.id)!;
      const r = asmCache.current.get(key);
      if (!r?.mesh) continue;
      const off = explode && centers.has(c.id) ? explodeOffset(mid, centers.get(c.id)!, explode, "Z") : [0, 0, 0];
      const pl = { ...c.placement, position: [c.placement.position[0] + off[0], c.placement.position[1] + off[1], c.placement.position[2] + off[2]] as Vec3 };
      out.push({ id: c.id, key, mesh: r.mesh, matrix: placementMatrix(pl), color: c.color ?? "#b9c2cc", selected: c.id === asmSel || c.id === mate?.compId, dim: !!mate && c.id !== mate.compId && !mate.local ? false : false, clash: clashIds.has(c.id) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAsm, doc.components, compKeys, asmVer, explode, asmSel, mate, clashes]);

  const asmPartInfo = useCallback(
    (c: AsmComponent) => {
      const r = asmCache.current.get(sourceKey(c.source));
      const matId = c.source.kind === "part" ? c.source.doc.material : (c.material ?? "ocel");
      const mt = MATERIALS.find((x) => x.id === matId);
      return { material: (mt?.label ?? matId).split(" – ")[0], massKg: r?.metrics ? massKg(r.metrics.volume, mt?.density ?? 7.85) : undefined };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [asmVer],
  );
  const bom = useMemo(() => (isAsm ? computeBom(doc, asmPartInfo) : []), [isAsm, doc, asmPartInfo]);

  const setComp = (id: string, patch: Partial<AsmComponent>) => commit({ ...doc, components: (doc.components ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const insertComponent = (c: AsmComponent) => {
    const base = isAsm ? doc : emptyAssembly();
    commit({ ...base, components: [...(base.components ?? []), c] });
    setAsmSel(c.id);
    setTab("asm");
    setClashes(null);
  };
  const insertPart = (d: CadDoc, group = "Normálie") => {
    const b = vp.current?.bounds();
    insertComponent(partComponent(d, { position: b && (doc.components?.length ?? 0) > 0 ? [Math.round(b.center[0] + b.radius * 1.2), 0, 0] : [0, 0, 0] }, { group, number: d.props?.number, color: d.color ?? "#b9c2cc" }));
  };
  const editPartInContext = (c: AsmComponent) => {
    if (c.source.kind !== "part") return flash("Importovaný soubor nelze upravovat historií – lze jen umístit.");
    setParentAsm({ asm: doc, key: sourceKey(c.source) });
    commit({ ...c.source.doc, kind: "part" });
    setAsmSel(null);
    setTab("create");
    setTimeout(() => vp.current?.setView("iso"), 700);
  };
  const backToAssembly = () => {
    if (!parentAsm) return;
    const part = { ...doc, kind: "part" as const };
    const comps = (parentAsm.asm.components ?? []).map((c) => (c.source.kind === "part" && sourceKey(c.source) === parentAsm.key ? { ...c, source: { kind: "part" as const, doc: part }, name: c.name } : c));
    commit({ ...parentAsm.asm, components: comps });
    setParentAsm(null);
    setActiveId(null);
    setSketchId(null);
    setTab("asm");
  };
  const compMenu = (c: AsmComponent): RMenuEntry[] => [
    { id: "edit", label: "Upravit díl (v kontextu)", icon: "edit", disabled: c.source.kind !== "part", onClick: () => editPartInContext(c) },
    { id: "hide", label: c.hidden ? "Zobrazit" : "Skrýt", icon: "eye", onClick: () => setComp(c.id, { hidden: !c.hidden }) },
    { id: "iso", label: "Izolovat (skrýt ostatní)", icon: "eye", onClick: () => commit({ ...doc, components: (doc.components ?? []).map((x) => ({ ...x, hidden: x.id !== c.id })) }) },
    { id: "all", label: "Zobrazit vše", icon: "eye", onClick: () => commit({ ...doc, components: (doc.components ?? []).map((x) => ({ ...x, hidden: false })) }) },
    { id: "dup", label: "Duplikovat (+ posun X)", icon: "copy", onClick: () => insertComponent({ ...structuredClone(c), id: uid(), placement: { ...c.placement, position: [c.placement.position[0] + 50, c.placement.position[1], c.placement.position[2]] } }) },
    { id: "fix", label: c.fixed ? "Uvolnit" : "Ukotvit", icon: "lock", onClick: () => setComp(c.id, { fixed: !c.fixed }) },
    { divider: true },
    { id: "mate", label: "Vazba Kontakt…", icon: "datum", tone: "ref", onClick: () => startMate(c.id, "mate") },
    { id: "export", label: "Uložit díl (.mncad)", icon: "save", disabled: c.source.kind !== "part", onClick: () => c.source.kind === "part" && download(`${safeName(c.name)}.mncad`, JSON.stringify(c.source.doc, null, 1), "application/json") },
    { divider: true },
    { id: "del", label: "Odebrat ze sestavy", icon: "trash", tone: "cut", kbd: "Del", onClick: () => { commit({ ...doc, components: (doc.components ?? []).filter((x) => x.id !== c.id) }); setAsmSel(null); } },
  ];
  const startMate = (compId: string, mode: "mate" | "flush" | "center") => {
    const c = doc.components?.find((x) => x.id === compId);
    if (c?.fixed) return flash("Komponenta je ukotvená – nejdřív ji uvolněte.");
    setAsmSel(compId);
    setMate({ mode, compId });
    setMeasure(false);
  };
  const onPickComponent = async (id: string | null, face: number) => {
    if (!mate) return setAsmSel(id);
    if (!id || face < 0) return;
    const comps = doc.components ?? [];
    if (!mate.local) {
      if (id !== mate.compId) return flash("Nejdřív klikněte na plochu vybrané (pohyblivé) komponenty.");
      const info = await cad.asmFace(compKeys.get(id)!, face);
      if (!info?.planar) return flash("Vazby zatím umí rovinné plochy – vyberte rovinnou plochu.");
      setMate({ ...mate, local: { origin: info.origin, normal: info.normal } });
      return;
    }
    if (id === mate.compId) return flash("Teď klikněte na plochu jiné komponenty.");
    const target = comps.find((c) => c.id === id);
    const moving = comps.find((c) => c.id === mate.compId);
    if (!target || !moving) return;
    const info = await cad.asmFace(compKeys.get(id)!, face);
    if (!info?.planar) return flash("Cílová plocha musí být rovinná.");
    const world = { origin: transformPoint(target.placement, info.origin), normal: apply3(rotMatrix(target.placement.rotation), info.normal) };
    setComp(moving.id, { placement: alignFaces(moving.placement, mate.local, world, mate.mode) });
    setMate(null);
    flash("Vazba použita – komponenta zarovnána.");
  };
  const runInterference = async () => {
    flash("Kontroluji kolize…");
    try {
      const res = await cad.interference(doc);
      setClashes(res);
      if (!res.length) flash("Bez kolizí ✓");
    } catch (e) {
      flash((e as Error).message);
    }
  };

  // ---------- prvky ----------
  const beginEdit = (id: string, base: CadDoc) => {
    setSketchId(null);
    setSketchSel(null);
    setActiveId(id);
    setEditBase(base);
    setMeasure(false);
  };
  const addFeature = (type: AddType) => {
    if (isAsm) return flash("V sestavě se prvky nepřidávají – otevřete díl (pravé tlačítko → Upravit díl).");
    if ((type === "extrude" || type === "revolve") && !doc.features.some((f) => f.type === "sketch")) {
      flash("Nejdřív nakreslete skicu (profil).");
      return;
    }
    if ((type === "sweep" || type === "loft") && doc.features.filter((f) => f.type === "sketch").length < 2) {
      flash(type === "sweep" ? "Tažení potřebuje dvě skici: profil a dráhu." : "Šablonování potřebuje alespoň dvě skici v různých rovinách.");
      return;
    }
    const f = newFeature(doc, type);
    commit({ ...doc, features: [...doc.features, f] });
    beginEdit(f.id, doc);
    track("cad_feature", { type });
  };
  const addPattern = () => {
    const last = [...doc.features].reverse().find((f) => ["extrude", "revolve", "box", "cylinder", "sphere", "cone", "tube", "hole", "sweep", "loft", "text"].includes(f.type));
    if (!last) return flash("Pole opakuje existující prvek – nejdřív vytvořte díru nebo vysunutí.");
    const f: Feature = { id: uid(), name: nextName(doc, "pattern"), type: "pattern", featureId: last.id, kind: "circular", count: 6, angle: 360, axis: "Z", center: [0, 0, 0] };
    commit({ ...doc, features: [...doc.features, f] });
    beginEdit(f.id, doc);
  };
  const createSketch = (plane: SketchPlane) => {
    const f: Feature = { id: uid(), name: nextName(doc, "sketch"), type: "sketch", plane, entities: [] };
    commit({ ...doc, features: [...doc.features, f] });
    setPlanePick(false);
    setActiveId(null);
    setSketchId(f.id);
    setTool("line");
    setTab("sketch");
  };
  const finishSketch = () => {
    const sk = doc.features.find((f) => f.id === sketchId);
    setSketchId(null);
    setSketchSel(null);
    setTab("create");
    if (!sk || sk.type !== "sketch") return;
    const usedBy = doc.features.some((f) => (f.type === "extrude" || f.type === "revolve") && f.sketchId === sk.id) || doc.features.some((f) => (f.type === "sweep" && (f.profileId === sk.id || f.pathId === sk.id)) || (f.type === "loft" && f.sketchIds.includes(sk.id)));
    if (!usedBy && sk.entities.length) {
      const hasBody = doc.features.some((f) => f.type !== "sketch" && f.type !== "datum");
      const ex = newFeature(doc, "extrude", { sketchId: sk.id, mode: hasBody ? "add" : "new" } as Partial<Feature>);
      commit({ ...doc, features: [...doc.features, ex] });
      beginEdit(ex.id, doc);
    }
  };
  const cancelSketch = () => {
    const sk = doc.features.find((f) => f.id === sketchId);
    if (sk?.type === "sketch" && sk.entities.length === 0) commit({ ...doc, features: doc.features.filter((f) => f.id !== sk.id) });
    setSketchId(null);
    setSketchSel(null);
    setTab("create");
  };
  const removeFeature = (id: string) => {
    commit({ ...doc, features: doc.features.filter((f) => f.id !== id) });
    if (activeId === id) setActiveId(null);
    if (sketchId === id) setSketchId(null);
  };
  const selectFeature = (f: Feature) => {
    if (f.type === "sketch") {
      setActiveId(null);
      setSketchId(f.id);
      setTool("select");
      setTab("sketch");
    } else if (f.id === activeId) setActiveId(null);
    else beginEdit(f.id, doc);
  };
  const okEdit = () => {
    setActiveId(null);
    setEditBase(null);
  };
  const cancelEdit = () => {
    if (editBase) commit(editBase);
    setActiveId(null);
    setEditBase(null);
  };

  // ---------- výběr v modelu ----------
  const pickMode: PickMode = isAsm
    ? mate
      ? "asmFace"
      : measure
        ? "measure"
        : "component"
    : planePick
    ? "face-plane"
    : measure
      ? "measure"
      : active?.type === "fillet" || active?.type === "chamfer"
        ? active.edges === "all"
          ? "none"
          : "edges"
        : active?.type === "shell" || active?.type === "hole" || active?.type === "draft"
          ? "faces"
          : "none";

  const onPickEdge = (i: number) => {
    if (!active || (active.type !== "fillet" && active.type !== "chamfer") || active.edges === "all") return;
    const edges = active.edges.includes(i) ? active.edges.filter((x) => x !== i) : [...active.edges, i];
    updateFeature(active.id, { edges } as Partial<Feature>);
  };
  const sketchOnFace = async (i: number) => {
    const info = await cad.face(i);
    if (!info?.planar) return flash("Skicu lze založit jen na rovinné ploše.");
    createSketch({ kind: "custom", origin: info.origin, normal: info.normal, xDir: info.xDir, label: `Plocha ${i + 1}` });
  };
  const onPickFace = async (i: number, point?: [number, number, number]) => {
    if (planePick) return sketchOnFace(i);
    if (active?.type === "shell" || active?.type === "draft") {
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
  const exportModel = async (format: ExportFormat) => {
    const meta = EXPORTS.find((e) => e.f === format)!;
    try {
      flash(`Připravuji ${meta.label}…`);
      const buf = await cad.exportFile(doc, format);
      download(`${safeName(doc.name)}.${meta.ext}`, buf, meta.mime);
      track("cad_export", { format });
    } catch (e) {
      flash((e as Error).message);
    }
  };
  const saveProject = () => download(`${safeName(doc.name)}.mncad`, JSON.stringify(doc, null, 1), "application/json");
  const newAssembly = (withCurrent = false) => {
    const a = emptyAssembly(withCurrent ? `Sestava – ${doc.name}` : "Nová sestava");
    if (withCurrent && !isAsm && doc.features.length) a.components = [partComponent(doc, {}, { group: "Díly", fixed: true, color: doc.color ?? "#b9c2cc" })];
    commit(a);
    setActiveId(null);
    setSketchId(null);
    setAsmSel(null);
    setParentAsm(null);
    setTab("asm");
    setTimeout(() => vp.current?.setView("iso"), 900);
  };
  const newDoc = () => {
    setParentAsm(null);
    setAsmSel(null);
    commit(emptyDoc());
    setActiveId(null);
    setSketchId(null);
    setTab("create");
  };
  const openFile = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "mncad" || ext === "json") {
      try {
        const d = JSON.parse(await file.text()) as CadDoc;
        if (d.app !== "mnastrojarna-cad") throw new Error();
        if (isAsm && d.kind !== "assembly") {
          insertPart(d, "Díly");
          flash(`Díl ${d.name} vložen do sestavy.`);
          return;
        }
        commit(d);
        setAsmSel(null);
        setParentAsm(null);
        setActiveId(null);
        setSketchId(null);
        flash(`Otevřeno: ${d.name}`);
        setTimeout(() => vp.current?.setView("iso"), 600);
      } catch {
        flash("Soubor není platný projekt Mnástrojárna CAD.");
      }
      return;
    }
    flash(`Načítám ${file.name}…`);
    try {
      const res = await prepareImport(file);
      if (res.kind === "unsupported") return setNotice({ title: `Formát .${ext} nelze otevřít přímo`, body: res.message });
      const base = doc.features.length ? doc : emptyDoc(file.name.replace(/\.[^.]+$/, ""));
      if (res.kind === "body" && isAsm) {
        insertComponent({ id: uid(), name: res.fileName.replace(/\.[^.]+$/, ""), source: { kind: "file", fileName: res.fileName, format: res.format, data: res.data }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] }, group: "Díly", color: "#9fb4c8" });
        flash("Soubor vložen jako komponenta sestavy.");
        return;
      }
      if (res.kind === "body") {
        const f: Feature = { id: uid(), name: `Import ${res.fileName}`, type: "import", fileName: res.fileName, format: res.format, data: res.data };
        commit({ ...base, features: [...base.features, f] });
        flash(res.note ?? "Model importován – můžete na něj navázat dalšími prvky.");
        setTimeout(() => vp.current?.setView("iso"), 1200);
      } else {
        const f: Feature = { id: uid(), name: res.name, type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: res.entities };
        commit({ ...base, features: [...base.features, f] });
        setSketchId(f.id);
        setTool("select");
        setTab("sketch");
        flash(res.note ?? `Výkres načten jako skica (${res.entities.length} entit).`);
      }
      track("cad_import", { format: ext ?? "" });
    } catch (e) {
      flash((e as Error).message || "Soubor se nepodařilo načíst.");
    }
  };
  const toRfq = async () => {
    try {
      flash("Ukládám model STEP a otevírám e-mail…");
      const buf = await cad.exportFile(doc, "step");
      const file = `${safeName(doc.name)}.step`;
      download(file, buf, "application/step");
      track("cad_to_rfq");
      const body = `Dobrý den,\n\nposílám model z Mnástrojárna CAD – soubor ${file} jsem si stáhl do počítače a přikládám ho.\n\nMnožství:\nMateriál:\nTermín:\n\nS pozdravem\n`;
      setTimeout(() => {
        window.location.href = `mailto:${SALES.email}?subject=${encodeURIComponent(`Poptávka z webu – ${doc.name}`)}&body=${encodeURIComponent(body)}`;
      }, 600);
    } catch (e) {
      flash((e as Error).message);
    }
  };
  const loadExample = (make: () => CadDoc) => {
    commit(make());
    setActiveId(null);
    setSketchId(null);
    setTab("create");
    setTimeout(() => vp.current?.setView("iso"), 700);
  };

  // ---------- nástroje ----------
  const toggleMeasure = () => {
    setMeasure((m) => !m);
    setMeasurePts([]);
    setActiveId(null);
  };
  const toggleSection = () => {
    if (section) return setSection(null);
    const m = result?.metrics;
    const c = m ? (m.bbox[0][1] + m.bbox[1][1]) / 2 : 0;
    setSection({ axis: "Y", offset: Math.round(c * 100) / 100, flip: false });
  };
  const view = (v: ViewName) => vp.current?.setView(v);

  // ---------- klávesy ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea,select")) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && k === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && k === "s") {
        e.preventDefault();
        saveProject();
        return;
      }
      if (mod && k === "o") {
        e.preventDefault();
        fileInput.current?.click();
        return;
      }
      if (sketchId || mod || e.altKey) return;
      if (e.key === "Escape") {
        if (mate) setMate(null);
        else if (asmSel) setAsmSel(null);
        if (active) cancelEdit();
        setPlanePick(false);
        setMeasure(false);
        setMeasurePts([]);
        setCtx(null);
        return;
      }
      if (e.key === "Enter" && active) return okEdit();
      if ((e.key === "Delete" || e.key === "Backspace") && active) return removeFeature(active.id);
      if ((e.key === "Delete" || e.key === "Backspace") && isAsm && asmSel) {
        commit({ ...doc, components: (doc.components ?? []).filter((x) => x.id !== asmSel) });
        return setAsmSel(null);
      }
      const views: Record<string, ViewName> = { "0": "iso", "1": "front", "2": "top", "3": "right", "4": "back", "5": "bottom", "6": "left" };
      if (views[e.key]) return view(views[e.key]);
      if (k === "f") vp.current?.fit();
      if (k === "e" && !isAsm) addFeature("extrude");
      if (k === "h" && !isAsm) addFeature("hole");
      if (k === "m") toggleMeasure();
      if (k === "x") toggleSection();
      if (k === "p") setPref("ortho", !prefs.ortho);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const sketch = doc.features.find((f) => f.id === sketchId) as Extract<Feature, { type: "sketch" }> | undefined;
  const sketchesForView = useMemo(
    () =>
      doc.features.filter(
        (f): f is Extract<Feature, { type: "sketch" }> =>
          f.type === "sketch" &&
          !f.suppressed &&
          (f.id === activeId ||
            !doc.features.some((x) => ((x.type === "extrude" || x.type === "revolve") && x.sketchId === f.id) || (x.type === "sweep" && x.profileId === f.id) || (x.type === "loft" && x.sketchIds.includes(f.id)))),
      ),
    [doc.features, activeId],
  );
  const datums = useMemo<Datum[]>(
    () => doc.features.flatMap((f) => (f.type === "datum" && !f.suppressed ? [{ id: f.id, name: f.name, origin: f.origin, normal: f.normal, xDir: f.xDir, size: f.size }] : [])),
    [doc.features],
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
  const bg = BACKGROUNDS[prefs.bg] ?? BACKGROUNDS.blue;
  const hasBody = isAsm ? asmViews.length > 0 : !!result?.mesh;

  // ---------- pás karet ----------
  const sketchPlanes: RMenuEntry[] = [
    { divider: true, label: "Rovina skici" },
    { id: "xy", label: "Rovina XY (půdorys)", icon: "datum", tone: "ref", onClick: () => createSketch({ kind: "base", name: "XY", offset: 0 }) },
    { id: "xz", label: "Rovina XZ (nárys)", icon: "datum", tone: "ref", onClick: () => createSketch({ kind: "base", name: "XZ", offset: 0 }) },
    { id: "yz", label: "Rovina YZ (bokorys)", icon: "datum", tone: "ref", onClick: () => createSketch({ kind: "base", name: "YZ", offset: 0 }) },
    { id: "face", label: "Na rovinné ploše modelu…", icon: "face", tone: "sketch", disabled: !hasBody, onClick: () => { setPlanePick(true); setActiveId(null); flash("Klikněte na rovinnou plochu modelu."); } },
    ...(datums.length ? ([{ divider: true, label: "Pomocné roviny" }, ...datums.map((d) => ({ id: d.id, label: d.name, icon: "datum" as CadIconName, tone: "ref" as const, onClick: () => createSketch({ kind: "custom", origin: d.origin, normal: d.normal, xDir: d.xDir, label: d.name }) }))] as RMenuEntry[]) : []),
  ];
  const exportEntries: RMenuEntry[] = EXPORTS.map((e) => ({ id: e.f, label: e.label, icon: "export", tone: "file", hint: e.hint, disabled: !hasBody, onClick: () => exportModel(e.f) }));

  const groups: Record<Tab, RGroup[]> = {
    create: [
      { label: "Skica", items: [{ id: "sketch", label: "Skica", icon: "sketch", tone: "sketch", menu: sketchPlanes, active: planePick, hint: "2D profil na rovině nebo ploše" }] },
      {
        label: "Tvar",
        big: 2,
        items: [
          { id: "extrude", label: "Vysunout", icon: "extrude", tone: "create", kbd: "E", onClick: () => addFeature("extrude") },
          { id: "revolve", label: "Rotovat", icon: "revolve", tone: "create", onClick: () => addFeature("revolve") },
          { id: "sweep", label: "Tažení", icon: "sweep", tone: "create", onClick: () => addFeature("sweep"), hint: "profil po dráze" },
          { id: "loft", label: "Šablonovat", icon: "loft", tone: "create", onClick: () => addFeature("loft"), hint: "přechod mezi profily" },
          { id: "text", label: "Text", icon: "text", tone: "create", onClick: () => addFeature("text"), hint: "gravírování / reliéf" },
        ],
      },
      {
        label: "Primitiva",
        big: 0,
        items: [
          { id: "box", label: "Kvádr", icon: "box", tone: "create", onClick: () => addFeature("box") },
          { id: "cylinder", label: "Válec", icon: "cylinder", tone: "create", onClick: () => addFeature("cylinder") },
          { id: "tube", label: "Trubka", icon: "tube", tone: "create", onClick: () => addFeature("tube") },
          { id: "cone", label: "Kužel", icon: "cone", tone: "create", onClick: () => addFeature("cone") },
          { id: "sphere", label: "Koule", icon: "sphere", tone: "create", onClick: () => addFeature("sphere") },
        ],
      },
      {
        label: "Konstrukční prvky",
        big: 1,
        items: [
          { id: "hole", label: "Díra", icon: "hole", tone: "cut", kbd: "H", onClick: () => addFeature("hole"), hint: "vrtaná, zahloubená, se závitem" },
          { id: "thread", label: "Závit", icon: "thread", tone: "cut", onClick: () => addFeature("thread") },
          { id: "split", label: "Rozříznout", icon: "split", tone: "cut", onClick: () => addFeature("split") },
        ],
      },
      {
        label: "Úpravy",
        big: 1,
        items: [
          { id: "fillet", label: "Zaoblit", icon: "fillet", tone: "feature", onClick: () => addFeature("fillet") },
          { id: "chamfer", label: "Srazit", icon: "chamfer", tone: "feature", onClick: () => addFeature("chamfer") },
          { id: "draft", label: "Úkos", icon: "draft", tone: "feature", onClick: () => addFeature("draft") },
          { id: "shell", label: "Skořepina", icon: "shell", tone: "feature", onClick: () => addFeature("shell") },
        ],
      },
      {
        label: "Základní editace",
        big: 0,
        items: [
          { id: "pattern", label: "Pole", icon: "pattern", tone: "pattern", onClick: addPattern },
          { id: "mirror", label: "Zrcadlit", icon: "mirror", tone: "pattern", onClick: () => addFeature("mirror") },
          { id: "transform", label: "Přesunout", icon: "transform", tone: "pattern", onClick: () => addFeature("transform") },
        ],
      },
      { label: "Reference", items: [{ id: "datum", label: "Rovina", icon: "datum", tone: "ref", onClick: () => addFeature("datum"), hint: "pomocná rovina pro skici" }] },
    ],
    asm: [
      {
        label: "Vložit",
        big: 2,
        items: [
          { id: "ins", label: "Vložit díl / model", icon: "open", tone: "file", onClick: () => fileInput.current?.click(), hint: ".mncad díl nebo STEP/IGES/STL… jako komponenta" },
          { id: "newpart", label: "Nový díl", icon: "new", tone: "create", onClick: () => { const d = { ...emptyDoc("Nový díl"), kind: "part" as const }; const c = partComponent(d, {}, { group: "Díly" }); commit({ ...doc, components: [...(doc.components ?? []), c] }); setTimeout(() => editPartInContext(c), 0); } },
        ],
      },
      {
        label: "Normálie",
        big: 0,
        items: [
          { id: "screw", label: "Šroub ISO 4762", icon: "thread", tone: "pattern", menu: (["M6", "M8", "M10", "M12", "M16"] as const).flatMap((m) => [20, 40, 60].map((l) => ({ id: `${m}x${l}`, label: `${m} × ${l}`, icon: "thread" as CadIconName, onClick: () => insertPart(screwISO4762(m, l)) }))) },
          { id: "pillar", label: "Vodicí sloupek", icon: "cylinder", tone: "pattern", menu: [16, 20, 24, 30, 40].map((d) => ({ id: `p${d}`, label: `Ø${d} × ${d * 5}`, icon: "cylinder" as CadIconName, onClick: () => insertPart(guidePillar(d, d * 5), "Vedení") })) },
          { id: "bush", label: "Vodicí pouzdro", icon: "tube", tone: "pattern", menu: [16, 20, 24, 30, 40].map((d) => ({ id: `b${d}`, label: `Ø${d} × ${d * 2}`, icon: "tube" as CadIconName, onClick: () => insertPart(guideBush(d, d * 2), "Vedení") })) },
          { id: "pin", label: "Vyhazovač", icon: "cylinder", tone: "pattern", menu: [3, 4, 5, 6, 8, 10].map((d) => ({ id: `e${d}`, label: `Ø${d} × 150`, icon: "cylinder" as CadIconName, onClick: () => insertPart(ejectorPin(d, 150), "Vyhazování") })) },
          { id: "ring", label: "Středicí kroužek", icon: "tube", tone: "pattern", onClick: () => insertPart(locatingRing(100, 10)) },
        ],
      },
      { label: "Formy", items: [{ id: "mold", label: "Rám formy", icon: "layers", tone: "create", onClick: () => setMoldOpen(true), hint: "kompletní rám vstřikovací formy" }] },
      {
        label: "Vazby",
        big: 0,
        items: [
          { id: "m1", label: "Kontakt", icon: "datum", tone: "ref", disabled: !asmSel, active: mate?.mode === "mate", onClick: () => asmSel && startMate(asmSel, "mate") },
          { id: "m2", label: "Zarovnat", icon: "datum", tone: "ref", disabled: !asmSel, active: mate?.mode === "flush", onClick: () => asmSel && startMate(asmSel, "flush") },
          { id: "m3", label: "Vystředit", icon: "datum", tone: "ref", disabled: !asmSel, active: mate?.mode === "center", onClick: () => asmSel && startMate(asmSel, "center") },
        ],
      },
      {
        label: "Analýza",
        big: 2,
        items: [
          { id: "clash", label: "Kolize", icon: "section", tone: "cut", disabled: !hasBody, active: !!clashes?.length, onClick: runInterference, hint: "kontrola průniků komponent" },
          { id: "bom", label: "Kusovník", icon: "table", tone: "tool", disabled: !bom.length, onClick: () => setBomOpen(true) },
          { id: "exp", label: explode ? "Složit" : "Rozložit", icon: "transform", tone: "pattern", active: explode > 0, onClick: () => setExplode((e) => (e ? 0 : 1.2)) },
        ],
      },
    ],
    sketch: [
      {
        label: "Kreslení",
        big: 7,
        items: (
          [
            ["select", "Výběr", "select", "V"],
            ["line", "Úsečka", "line", "L"],
            ["rect", "Obdélník", "rect", "R"],
            ["circle", "Kružnice", "circle", "C"],
            ["arc", "Oblouk", "arc", "A"],
            ["polygon", "Mnohoúhelník", "polygon", "P"],
            ["slot", "Drážka", "slot", "S"],
          ] as [SketchTool, string, CadIconName, string][]
        ).map(([t, l, i, k]) => ({ id: t, label: l, icon: i, tone: "sketch" as const, kbd: k, active: tool === t, onClick: () => setTool(t) })),
      },
      {
        label: "Nastavení",
        big: 0,
        items: [
          { id: "snap", label: "Přichytit k mřížce", icon: "grid", tone: "view", active: snapGrid, onClick: () => setSnapGrid((v) => !v) },
          { id: "dxf", label: "Export skici DXF", icon: "export", tone: "file", onClick: () => sketch && download(`${safeName(sketch.name)}.dxf`, sketchToDxf(sketch.entities), "application/dxf") },
          { id: "imp", label: "Import DXF…", icon: "open", tone: "file", onClick: () => fileInput.current?.click() },
        ],
      },
    ],
    tools: [
      {
        label: "Analýza",
        big: 2,
        items: [
          { id: "measure", label: "Měřit", icon: "measure", tone: "tool", kbd: "M", active: measure, disabled: !hasBody, onClick: toggleMeasure, hint: "vzdálenost dvou bodů" },
          { id: "mass", label: "Hmotnost", icon: "mass", tone: "tool", disabled: !hasBody, onClick: () => setMassOpen(true), hint: "objem, plocha, hmotnost" },
          { id: "section", label: "Řez", icon: "section", tone: "tool", kbd: "X", active: !!section, disabled: !hasBody, onClick: toggleSection },
        ],
      },
      {
        label: "Parametrizace",
        big: 0,
        items: [
          { id: "vars", label: "Proměnné", icon: "variables", tone: "tool", onClick: () => { setPanels(true); flash("Proměnné najdete v levém panelu – záložka Proměnné."); } },
          { id: "cfg", label: "Stavy dílu", icon: "configs", tone: "tool", onClick: () => { setPanels(true); flash("Stavy (konfigurace) najdete v levém panelu – záložka Stavy."); } },
        ],
      },
    ],
    view: [
      {
        label: "Pohledy",
        big: 1,
        items: [
          { id: "iso", label: "Izometrie", icon: "iso", tone: "view", kbd: "0", onClick: () => view("iso") },
          { id: "front", label: "Přední", icon: "front", tone: "view", kbd: "1", onClick: () => view("front") },
          { id: "top", label: "Horní", icon: "top", tone: "view", kbd: "2", onClick: () => view("top") },
          { id: "right", label: "Pravý", icon: "right", tone: "view", kbd: "3", onClick: () => view("right") },
          { id: "back", label: "Zadní", icon: "back", tone: "view", kbd: "4", onClick: () => view("back") },
          { id: "bottom", label: "Spodní", icon: "bottom", tone: "view", kbd: "5", onClick: () => view("bottom") },
          { id: "left", label: "Levý", icon: "left", tone: "view", kbd: "6", onClick: () => view("left") },
        ],
      },
      {
        label: "Styl zobrazení",
        big: 0,
        items: (
          [
            ["shadedEdges", "Stínovaný s hranami", "shadedEdges"],
            ["shaded", "Stínovaný", "shaded"],
            ["wireframe", "Drátový", "wireframe"],
            ["hiddenLine", "Skryté hrany", "hiddenLine"],
            ["xray", "Průhledný", "xray"],
          ] as [DisplayMode, string, CadIconName][]
        ).map(([d, l, i]) => ({ id: d, label: l, icon: i, tone: "view" as const, active: prefs.display === d, onClick: () => setPref("display", d) })),
      },
      {
        label: "Kamera",
        big: 1,
        items: [
          { id: "fit", label: "Přizpůsobit", icon: "fit", tone: "view", kbd: "F", onClick: () => vp.current?.fit() },
          { id: "persp", label: "Perspektiva", icon: "perspective", tone: "view", active: !prefs.ortho, onClick: () => setPref("ortho", false) },
          { id: "ortho", label: "Pravoúhlá", icon: "ortho", tone: "view", kbd: "P", active: prefs.ortho, onClick: () => setPref("ortho", true) },
          { id: "grid", label: "Mřížka a osy", icon: "grid", tone: "view", active: showGrid, onClick: () => setShowGrid((v) => !v) },
        ],
      },
      {
        label: "Vzhled",
        big: 0,
        items: [
          { id: "color", label: "Barva tělesa", icon: "palette", tone: "view", menu: COLORS.map((c) => ({ id: c.c, label: c.l, icon: "cube" as CadIconName, active: (doc.color ?? COLORS[0].c) === c.c, onClick: () => commit({ ...doc, color: c.c }) })) },
          { id: "bg", label: "Pozadí", icon: "layers", tone: "view", menu: Object.entries(BACKGROUNDS).map(([k, b]) => ({ id: k, label: b.label, icon: "layers" as CadIconName, active: prefs.bg === k, onClick: () => setPref("bg", k) })) },
          {
            id: "mouse",
            label: "Ovládání myši",
            icon: "mouse",
            tone: "view",
            menu: [
              { id: "zw3d", label: "ZW3D – pravé otáčí, prostřední posouvá", icon: "mouse", active: prefs.mouse === "zw3d", onClick: () => setPref("mouse", "zw3d") },
              { id: "solidworks", label: "SolidWorks – prostřední otáčí, Ctrl+prostř. posouvá", icon: "mouse", active: prefs.mouse === "solidworks", onClick: () => setPref("mouse", "solidworks") },
              { id: "simple", label: "Touchpad – levé otáčí, pravé posouvá", icon: "mouse", active: prefs.mouse === "simple", onClick: () => setPref("mouse", "simple") },
            ],
          },
        ],
      },
    ],
    drawing: [
      { label: "Výkresová dokumentace", items: [{ id: "drw", label: "Nový výkres", icon: "drawing", tone: "file", disabled: !hasBody, onClick: () => setDrawingOpen(true), hint: "pohledy, řezy, kóty, razítko → PDF/DXF/SVG" }] },
    ],
    data: [
      {
        label: "Soubor",
        big: 2,
        items: [
          { id: "open", label: "Otevřít / Import", icon: "open", tone: "file", kbd: "Ctrl+O", onClick: () => fileInput.current?.click(), hint: "STEP, IGES, BREP, STL, OBJ, 3MF, glTF, PLY, DXF, .mncad" },
          { id: "save", label: "Uložit projekt", icon: "save", tone: "file", kbd: "Ctrl+S", onClick: saveProject },
        ],
      },
      { label: "Export 3D", items: [{ id: "export", label: "Export", icon: "export", tone: "file", menu: exportEntries }] },
      {
        label: "Sestava",
        items: [
          {
            id: "asm",
            label: "Sestava",
            icon: "layers",
            tone: "create",
            menu: [
              { id: "na", label: "Nová prázdná sestava", icon: "layers", onClick: () => newAssembly(false) },
              { id: "nc", label: "Sestava z aktuálního dílu", icon: "layers", disabled: isAsm || !doc.features.length, onClick: () => newAssembly(true) },
              { id: "mold", label: "Rám vstřikovací formy…", icon: "layers", onClick: () => setMoldOpen(true) },
            ],
          },
        ],
      },
      { label: "Ukázky", items: [{ id: "ex", label: "Ukázkové díly", icon: "cube", tone: "create", menu: EXAMPLES.map((ex) => ({ id: ex.id, label: ex.label, icon: "cube" as CadIconName, onClick: () => loadExample(ex.make) })) }] },
    ],
  };

  const tabs: [Tab, string][] = [
    isAsm ? ["asm", "Sestava"] : ["create", "Tvorba"],
    ...(sketch ? ([["sketch", "Skica"]] as [Tab, string][]) : []),
    ["tools", "Nástroje"],
    ["view", "Zobrazení"],
    ["drawing", "Výkres"],
    ["data", "Data"],
  ];
  const curTab: Tab = isAsm ? (tab === "create" || tab === "sketch" ? "asm" : tab) : sketch ? (tab === "create" || tab === "asm" ? "sketch" : tab) : tab === "sketch" || tab === "asm" ? "create" : tab;

  // ---------- výzva v řádku příkazů ----------
  const prompt = isAsm
    ? mate
      ? !mate.local
        ? "Vazba: klikněte na rovinnou plochu vybrané (pohyblivé) komponenty · Esc zruší"
        : "Vazba: klikněte na rovinnou plochu cílové komponenty"
      : measure
        ? measurePts.length < 2
          ? "Měření: klikněte na body modelu"
          : "Měření hotovo – kliknutím začnete nové"
        : asmLoading
          ? "Stavím komponenty…"
          : asmSel
            ? "Komponenta vybrána: upravte polohu vpravo, vazbu nastavte tlačítky Kontakt/Zarovnat/Vystředit · pravé tlačítko = nabídka"
            : `Sestava · ${doc.components?.length ?? 0} komponent · klikněte na komponentu pro výběr`
    : planePick
    ? "Vyberte rovinnou plochu, na které se založí skica · Esc zruší"
    : measure
      ? measurePts.length === 0
        ? "Měření: klikněte na první bod (přichytává se k vrcholům)"
        : measurePts.length === 1
          ? "Měření: klikněte na druhý bod"
          : "Měření hotovo – kliknutím začnete nové · Esc ukončí"
      : sketch
        ? `Skica na rovině ${planeLabel(sketch.plane)} · kreslete myší, rozměry upravíte v panelu vpravo`
        : active
          ? active.type === "fillet" || active.type === "chamfer"
            ? active.edges === "all"
              ? "Zaoblí/srazí se všechny hrany · Enter = OK, Esc = Storno"
              : `Vyberte hrany v modelu (vybráno ${active.edges.length}) · Enter = OK`
            : active.type === "shell"
              ? "Vyberte plochy, které se otevřou · Enter = OK"
              : active.type === "draft"
                ? "Vyberte plochy pro úkos · Enter = OK"
                : active.type === "hole"
                  ? "Klikněte na plochu, kam se má vrtat · Enter = OK"
                  : `${FEATURE_LABEL[active.type]}: upravte parametry · Enter = OK, Esc = Storno`
          : "Vyberte příkaz na pásu karet nebo prvek v historii · pravé tlačítko = nabídka";

  const vpContext = (x: number, y: number, face: number) => {
    const selComp = isAsm ? doc.components?.find((c) => c.id === asmSel) : undefined;
    const entries: RMenuEntry[] = [
      ...(selComp ? ([{ divider: true, label: selComp.name }, ...compMenu(selComp), { divider: true }] as RMenuEntry[]) : []),
      { id: "fit", label: "Přizpůsobit", icon: "fit", kbd: "F", onClick: () => vp.current?.fit() },
      { id: "iso", label: "Izometrie", icon: "iso", kbd: "0", onClick: () => view("iso") },
      { divider: true, label: "Pohledy" },
      { id: "front", label: "Přední", icon: "front", kbd: "1", onClick: () => view("front") },
      { id: "top", label: "Horní", icon: "top", kbd: "2", onClick: () => view("top") },
      { id: "right", label: "Pravý", icon: "right", kbd: "3", onClick: () => view("right") },
      { divider: true, label: "Styl" },
      { id: "se", label: "Stínovaný s hranami", icon: "shadedEdges", active: prefs.display === "shadedEdges", onClick: () => setPref("display", "shadedEdges") },
      { id: "wf", label: "Drátový", icon: "wireframe", active: prefs.display === "wireframe", onClick: () => setPref("display", "wireframe") },
      { id: "xr", label: "Průhledný", icon: "xray", active: prefs.display === "xray", onClick: () => setPref("display", "xray") },
      { divider: true },
      ...(face >= 0 ? ([{ id: "sk", label: "Nová skica na této ploše", icon: "sketch", tone: "sketch", onClick: () => sketchOnFace(face) }] as RMenuEntry[]) : []),
      { id: "ms", label: measure ? "Ukončit měření" : "Měřit", icon: "measure", tone: "tool", kbd: "M", disabled: !hasBody, onClick: toggleMeasure },
      { id: "sec", label: section ? "Zrušit řez" : "Řez", icon: "section", tone: "tool", kbd: "X", disabled: !hasBody, onClick: toggleSection },
      ...(active ? ([{ divider: true }, { id: "ok", label: "OK – potvrdit prvek", icon: "check", onClick: okEdit }, { id: "cancel", label: "Storno", icon: "x", onClick: cancelEdit }] as RMenuEntry[]) : []),
    ];
    setCtx({ x, y, entries });
  };

  const paramCtx = useMemo(
    () => ({
      bindings: doc.bindings ?? {},
      values: resolved.values,
      setBinding: (key: string, expr: string | null) => {
        const b = { ...(doc.bindings ?? {}) };
        if (expr == null) delete b[key];
        else b[key] = expr;
        commit({ ...doc, bindings: b });
      },
    }),
    [doc, resolved.values, commit],
  );

  const dist = measurePts.length === 2 ? Math.hypot(measurePts[1][0] - measurePts[0][0], measurePts[1][1] - measurePts[0][1], measurePts[1][2] - measurePts[0][2]) : null;
  const bb = m ? m.bbox : null;

  // ---------- UI ----------
  return (
    <ParamContext.Provider value={paramCtx}>
      <div className="fixed inset-0 flex flex-col bg-[#e9edf1] font-sans text-[#1f2933]">
        {/* Titulní lišta */}
        <header className="flex h-10 shrink-0 items-center gap-1 bg-gradient-to-b from-[#262b31] to-[#1c2025] px-2 text-white/85">
          <Link href="/" className="flex items-center gap-2 pr-2" title="Zpět na web mnastrojarna.cz">
            <LogoMark className="h-6 w-6" />
            <span className="hidden font-display text-[14px] font-bold uppercase tracking-tight text-white sm:inline">
              Mnástrojárna <span className="text-brand">CAD</span>
            </span>
          </Link>
          <div className="mx-1 h-5 w-px bg-white/15" />
          <QBtn icon="new" title="Nový díl" onClick={newDoc} />
          <QBtn icon="open" title="Otevřít / importovat (Ctrl+O)" onClick={() => fileInput.current?.click()} />
          <QBtn icon="save" title="Uložit projekt (Ctrl+S)" onClick={saveProject} />
          <div className="mx-1 h-5 w-px bg-white/15" />
          <QBtn icon="undo" title="Zpět (Ctrl+Z)" onClick={undo} disabled={!hist.past.length} />
          <QBtn icon="redo" title="Znovu (Ctrl+Y)" onClick={redo} disabled={!hist.future.length} />
          <div className="flex min-w-0 flex-1 justify-center">
            <div className="flex min-w-0 items-center gap-2 rounded-t-md border-x border-t border-white/10 bg-white/[0.06] px-3 py-1">
              <CadIcon name="cube" className="h-3.5 w-3.5 shrink-0 text-brand" />
              <input
                value={doc.name}
                onChange={(e) => live({ ...doc, name: e.target.value })}
                onBlur={() => commit(doc)}
                className="w-[min(40vw,260px)] min-w-0 bg-transparent text-center text-[12.5px] font-medium text-white outline-none"
                aria-label="Název dílu"
              />
              {doc.activeConfig && <span className="rounded bg-[#0e7490] px-1.5 text-[10px] font-semibold">{doc.configs?.find((c) => c.id === doc.activeConfig)?.name}</span>}
            </div>
          </div>
          <span className={cn("hidden items-center gap-1.5 font-mono text-[10.5px] lg:flex", core === "error" ? "text-brand" : "text-white/55")}>
            <span className={cn("h-2 w-2 rounded-full", core === "ready" ? (busy ? "animate-pulse bg-amber-400" : "bg-emerald-400") : core === "loading" ? "animate-pulse bg-amber-400" : "bg-brand")} />
            {core === "loading" ? "Načítám jádro OpenCascade…" : core === "error" ? "Jádro se nenačetlo" : busy ? "Přepočítávám…" : `OCCT · ${result ? `${result.ms} ms` : "připraveno"}`}
          </span>
          <button type="button" onClick={toRfq} className="ml-2 whitespace-nowrap rounded bg-brand px-3 py-1 text-[12px] font-semibold text-white shadow hover:bg-brand-600">
            Poptat<span className="hidden sm:inline"> výrobu</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={`.mncad,.json,${IMPORT_ACCEPT}`}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) openFile(f);
              e.target.value = "";
            }}
          />
        </header>

        {/* Záložky pásu */}
        <div className="flex h-8 shrink-0 items-end gap-0.5 border-b border-[#d5dbe2] bg-[#dfe5eb] px-1">
          <div className="relative self-stretch py-1">
            <button type="button" onClick={() => setAppMenu((v) => !v)} className="h-full rounded-sm bg-brand px-3 text-[12px] font-semibold text-white hover:bg-brand-600">
              Soubor
            </button>
            {appMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setAppMenu(false)} />
                <Dropdown
                  close={() => setAppMenu(false)}
                  className="z-50 w-[300px]"
                  entries={[
                    { id: "new", label: "Nový díl", icon: "new", tone: "file", onClick: newDoc },
                    { id: "open", label: "Otevřít / importovat…", icon: "open", tone: "file", kbd: "Ctrl+O", onClick: () => fileInput.current?.click() },
                    { id: "save", label: "Uložit projekt (.mncad)", icon: "save", tone: "file", kbd: "Ctrl+S", onClick: saveProject },
                    { divider: true, label: "Export 3D" },
                    ...exportEntries,
                    { divider: true, label: "Výkres" },
                    { id: "drw", label: "Výkres PDF / DXF / SVG…", icon: "drawing", tone: "file", disabled: !hasBody, onClick: () => setDrawingOpen(true) },
                    { divider: true, label: "Sestavy" },
                    { id: "na", label: "Nová sestava", icon: "layers", tone: "create", onClick: () => newAssembly(false) },
                    { id: "nc", label: "Sestava z aktuálního dílu", icon: "layers", tone: "create", disabled: isAsm || !doc.features.length, onClick: () => newAssembly(true) },
                    { id: "mold", label: "Rám vstřikovací formy…", icon: "layers", tone: "create", onClick: () => setMoldOpen(true) },
                    { divider: true, label: "Ukázky" },
                    ...EXAMPLES.map((ex) => ({ id: ex.id, label: ex.label, icon: "cube" as CadIconName, onClick: () => loadExample(ex.make) })),
                    { divider: true },
                    { id: "help", label: "Klávesové zkratky a ovládání", icon: "help", onClick: () => setNotice({ title: "Ovládání a zkratky", body: HELP }) },
                  ]}
                />
              </>
            )}
          </div>
          {tabs.map(([t, l]) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "rounded-t-md border-x border-t px-3.5 py-1 text-[12px] font-medium",
                curTab === t ? "relative top-px border-[#d5dbe2] bg-[#fbfcfd] text-[#1f2933]" : "border-transparent text-[#4a5664] hover:bg-white/50",
                t === "sketch" && "text-[#2563eb]",
              )}
            >
              {l}
            </button>
          ))}
        </div>

        <Ribbon
          groups={groups[curTab]}
          right={
            sketch ? (
              <div className="flex items-center gap-2 px-3">
                <button type="button" onClick={cancelSketch} className="rounded border border-[#cfd6de] bg-white px-3 py-1.5 text-[12px] hover:bg-[#f3f6f9]">
                  Zavřít
                </button>
                <button type="button" onClick={finishSketch} className="flex items-center gap-1.5 rounded bg-[#16a34a] px-4 py-1.5 text-[12.5px] font-semibold text-white shadow hover:bg-[#15803d]">
                  <CadIcon name="check" className="h-4 w-4" /> Dokončit skicu
                </button>
              </div>
            ) : null
          }
        />

        <div className="relative flex min-h-0 flex-1">
          {/* Správce */}
          <aside className={cn("absolute inset-y-0 left-0 z-20 w-[270px] shrink-0 flex-col border-r border-[#d5dbe2] bg-white shadow-xl lg:static lg:flex lg:shadow-none", panels ? "flex" : "hidden")}>
            {isAsm ? (
              <AsmTree doc={doc} selected={asmSel} onSelect={setAsmSel} onCommit={commit} onContext={(x, y, entries) => setCtx({ x, y, entries })} menuFor={compMenu} />
            ) : (
              <Manager doc={doc} status={result?.status} activeId={activeId} sketchId={sketchId} onSelect={selectFeature} onCommit={commit} onContext={(x, y, entries) => setCtx({ x, y, entries })} />
            )}
          </aside>

          {/* Pracovní plocha */}
          <main className="relative min-w-0 flex-1 overflow-hidden">
            <div className={cn("absolute inset-0", sketch && "invisible")} style={{ background: bg.css }}>
              <Viewport
                ref={vp}
                mesh={result?.mesh ?? null}
                sketches={sketchesForView}
                datums={datums}
                pickMode={pickMode}
                selectedEdges={active && (active.type === "fillet" || active.type === "chamfer") && active.edges !== "all" ? active.edges : []}
                selectedFaces={active?.type === "shell" || active?.type === "draft" ? active.faces : []}
                onPickEdge={onPickEdge}
                onPickFace={onPickFace}
                onMeasurePoint={(p) => setMeasurePts((pts) => (pts.length >= 2 ? [p] : [...pts, p]))}
                measurePts={measurePts}
                onContext={vpContext}
                onCursor={setCursor}
                display={prefs.display}
                ortho={prefs.ortho}
                section={section}
                bodyColor={doc.color}
                mouse={prefs.mouse}
                showGrid={showGrid}
                assembly={isAsm ? asmViews : undefined}
                onPickComponent={onPickComponent}
              />
            </div>
            {sketch && (
              <>
                <Sketcher key={sketch.id} entities={sketch.entities} onChange={setSketchEntities} selected={sketchSel} onSelect={setSketchSel} tool={tool} setTool={setTool} snapGrid={snapGrid} />
                <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded bg-[#2563eb] px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-white shadow-lg">Skica · {planeLabel(sketch.plane)}</div>
              </>
            )}

            {/* Měření */}
            {measure && (
              <FloatPanel title="Měření vzdálenosti" icon="measure" onClose={toggleMeasure}>
                {measurePts.map((p, i) => (
                  <Row key={i} k={`Bod ${i + 1}`} v={p.map((x) => fmtNum(x, 2)).join(" ; ")} />
                ))}
                {dist != null && (
                  <>
                    <Row k="Vzdálenost" v={`${fmtNum(dist, 3)} mm`} strong />
                    <Row k="ΔX / ΔY / ΔZ" v={[0, 1, 2].map((k) => fmtNum(Math.abs(measurePts[1][k] - measurePts[0][k]), 3)).join(" / ")} />
                  </>
                )}
                {measurePts.length === 0 && <p className="text-[11.5px] text-[#6b7785]">Klikněte na dva body modelu.</p>}
                {measurePts.length > 0 && (
                  <button type="button" onClick={() => setMeasurePts([])} className="mt-2 w-full rounded border border-[#cfd6de] py-1 text-[12px] hover:bg-[#f3f6f9]">
                    Nové měření
                  </button>
                )}
              </FloatPanel>
            )}

            {/* Řez */}
            {section && !sketch && (
              <FloatPanel title="Řez modelem" icon="section" onClose={() => setSection(null)} className={measure ? "top-[190px]" : undefined}>
                <div className="mb-2 flex gap-1">
                  {(["X", "Y", "Z"] as const).map((a) => (
                    <button key={a} type="button" onClick={() => setSection({ ...section, axis: a, offset: bb ? Math.round(((bb[0]["XYZ".indexOf(a)] + bb[1]["XYZ".indexOf(a)]) / 2) * 100) / 100 : 0 })} className={cn("flex-1 rounded py-1 text-[12px] font-semibold", section.axis === a ? "bg-[#1f2933] text-white" : "bg-[#eef2f6] hover:bg-[#e3e9f0]")}>
                      {a}
                    </button>
                  ))}
                </div>
                {bb && (
                  <input
                    type="range"
                    min={bb[0]["XYZ".indexOf(section.axis)] - 0.01}
                    max={bb[1]["XYZ".indexOf(section.axis)] + 0.01}
                    step={0.01}
                    value={section.offset}
                    onChange={(e) => setSection({ ...section, offset: Number(e.target.value) })}
                    className="w-full accent-[#E03930]"
                  />
                )}
                <Row k="Poloha" v={`${fmtNum(section.offset, 2)} mm`} />
                <button type="button" onClick={() => setSection({ ...section, flip: !section.flip })} className="mt-2 w-full rounded border border-[#cfd6de] py-1 text-[12px] hover:bg-[#f3f6f9]">
                  Otočit stranu
                </button>
              </FloatPanel>
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

            <button type="button" className={cn("absolute top-3 z-30 rounded border border-[#cfd6de] bg-white p-2 shadow-sm lg:hidden", panels ? "left-[17.5rem]" : "left-3")} onClick={() => setPanels((p) => !p)} aria-label="Správce historie">
              <CadIcon name="tree" className="h-4 w-4" />
            </button>

            {parentAsm && (
              <div className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-3 rounded-md bg-[#2563eb] px-3 py-1.5 text-[12.5px] text-white shadow-lg">
                <span>Úprava dílu v sestavě „{parentAsm.asm.name}“</span>
                <button type="button" onClick={backToAssembly} className="rounded bg-white px-2.5 py-0.5 text-[12px] font-semibold text-[#2563eb] hover:bg-blue-50">
                  ← Zpět do sestavy
                </button>
              </div>
            )}
            {isAsm && explode > 0 && (
              <FloatPanel title="Rozložený pohled" icon="transform" onClose={() => setExplode(0)}>
                <input type="range" min={0} max={3} step={0.05} value={explode} onChange={(e) => setExplode(Number(e.target.value))} className="w-full accent-[#E03930]" />
                <Row k="Rozložení" v={`${Math.round(explode * 100)} %`} />
              </FloatPanel>
            )}
            {isAsm && clashes && clashes.length > 0 && (
              <FloatPanel title={`Kolize (${clashes.length})`} icon="section" onClose={() => setClashes(null)} className={explode > 0 ? "top-[150px]" : undefined}>
                <div className="max-h-56 space-y-1 overflow-y-auto">
                  {clashes.map((x, i) => {
                    const a = doc.components?.find((c) => c.id === x.a);
                    const b = doc.components?.find((c) => c.id === x.b);
                    return (
                      <button key={i} type="button" onClick={() => setAsmSel(x.a)} className="block w-full rounded px-1.5 py-1 text-left text-[11.5px] hover:bg-[#fde3e1]">
                        <span className="font-medium">{a?.name}</span> × <span className="font-medium">{b?.name}</span>
                        <span className="block font-mono text-[10.5px] text-brand-600">{fmtNum(x.volume, 2)} mm³</span>
                      </button>
                    );
                  })}
                </div>
              </FloatPanel>
            )}
            {toast && <div className="absolute bottom-14 left-1/2 z-30 max-w-[90%] -translate-x-1/2 rounded-md bg-[#1f2933] px-4 py-2 text-[12.5px] text-white shadow-xl">{toast}</div>}

            {!sketch && (
              <div className={cn("pointer-events-none absolute bottom-2 left-24 right-24 flex flex-wrap justify-center gap-1.5 font-mono text-[10.5px]", bg.dark ? "text-white/80" : "text-[#26303b]")}>
                {isAsm ? (
                  <>
                    <Chip dark={bg.dark}>{doc.components?.length ?? 0} komponent · {bom.length} položek kusovníku</Chip>
                    <Chip dark={bg.dark}>Hmotnost {fmtNum(bom.reduce((sum, r) => sum + (r.massKg ?? 0) * r.qty, 0), 2)} kg</Chip>
                    {asmLoading > 0 && <Chip dark={bg.dark}>Stavím komponenty…</Chip>}
                  </>
                ) : m ? (
                  <>
                    <Chip dark={bg.dark}>
                      {fmtNum(m.bbox[1][0] - m.bbox[0][0], 1)} × {fmtNum(m.bbox[1][1] - m.bbox[0][1], 1)} × {fmtNum(m.bbox[1][2] - m.bbox[0][2], 1)} mm
                    </Chip>
                    <Chip dark={bg.dark}>V {fmtNum(m.volume / 1000, 1)} cm³</Chip>
                    <Chip dark={bg.dark}>
                      {mat.label} {fmtNum(massKg(m.volume, mat.density), 3)} kg
                    </Chip>
                  </>
                ) : (
                  <Chip dark={bg.dark}>Prázdný model</Chip>
                )}
                {errors.length > 0 && <Chip warn>{errors.length} prvek s chybou</Chip>}
              </div>
            )}
          </main>

          {/* Formulář prvku (jako „Options“ v ZW3D) */}
          {isAsm && asmSel && doc.components?.find((c) => c.id === asmSel) && (
            <aside className="absolute inset-y-0 right-0 z-20 flex w-[300px] shrink-0 flex-col border-l border-[#d5dbe2] bg-white shadow-xl lg:static lg:shadow-none">
              <div className="flex items-center gap-2 border-b border-[#d5dbe2] bg-gradient-to-b from-[#f7f9fb] to-[#eef2f6] px-3 py-2">
                <CadIcon name="cube" tone="create" className="h-5 w-5" />
                <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">Komponenta · {doc.components.find((c) => c.id === asmSel)!.name}</p>
                <button type="button" className="rounded p-1 text-[#6b7785] hover:bg-[#e3e9f0]" onClick={() => setAsmSel(null)} aria-label="Zavřít">
                  <CadIcon name="x" className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <AsmProps c={doc.components.find((c) => c.id === asmSel)!} onChange={(p) => setComp(asmSel, p)} onMate={(mode) => startMate(asmSel, mode)} mating={!!mate} />
              </div>
              <div className="flex gap-2 border-t border-[#d5dbe2] p-3">
                <button type="button" disabled={doc.components.find((c) => c.id === asmSel)!.source.kind !== "part"} onClick={() => editPartInContext(doc.components!.find((c) => c.id === asmSel)!)} className="flex-1 rounded bg-[#2563eb] py-2 text-[12.5px] font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-40">
                  Upravit díl
                </button>
                <button type="button" className="rounded border border-[#cfd6de] px-2 text-brand hover:bg-brand/5" title="Odebrat" onClick={() => { commit({ ...doc, components: (doc.components ?? []).filter((x) => x.id !== asmSel) }); setAsmSel(null); }}>
                  <CadIcon name="trash" className="h-4 w-4" />
                </button>
              </div>
            </aside>
          )}
          {(active || (sketch && sketchSel)) && (
            <aside className="absolute inset-y-0 right-0 z-20 flex w-[300px] shrink-0 flex-col border-l border-[#d5dbe2] bg-white shadow-xl lg:static lg:shadow-none">
              <div className="flex items-center gap-2 border-b border-[#d5dbe2] bg-gradient-to-b from-[#f7f9fb] to-[#eef2f6] px-3 py-2">
                <CadIcon name={(active?.type ?? "sketch") as CadIconName} tone={FEATURE_TONE[active?.type ?? "sketch"] ?? "create"} className="h-5 w-5" />
                <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{active ? `${FEATURE_LABEL[active.type]} · ${active.name}` : "Entita skici"}</p>
                {active ? (
                  <>
                    <button type="button" title="OK (Enter)" onClick={okEdit} className="grid h-7 w-7 place-items-center rounded bg-[#16a34a] text-white shadow-sm hover:bg-[#15803d]">
                      <CadIcon name="check" className="h-4 w-4" />
                    </button>
                    <button type="button" title="Storno (Esc)" onClick={cancelEdit} className="grid h-7 w-7 place-items-center rounded bg-white text-brand ring-1 ring-[#cfd6de] hover:bg-brand/5">
                      <CadIcon name="x" className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <button type="button" className="rounded p-1 text-[#6b7785] hover:bg-[#e3e9f0]" onClick={() => setSketchSel(null)} aria-label="Zavřít">
                    <CadIcon name="x" className="h-4 w-4" />
                  </button>
                )}
              </div>
              {active && statusOf(result, active.id) && !statusOf(result, active.id)!.ok && (
                <p className="mx-3 mt-3 rounded border border-brand/30 bg-brand/10 px-2.5 py-1.5 text-[12px] text-brand-600">{statusOf(result, active.id)!.error}</p>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {active && <FeatureProps f={active} doc={doc} onChange={(p) => updateFeature(active.id, p)} />}
                {sketch &&
                  sketchSel &&
                  (() => {
                    const e = sketch.entities.find((x) => x.id === sketchSel);
                    return e ? (
                      <>
                        <EntityProps e={e} onChange={(n) => setSketchEntities(sketch.entities.map((x) => (x.id === n.id ? n : x)))} />
                        <button
                          type="button"
                          className="mt-5 w-full rounded border border-[#cfd6de] py-2 text-[12.5px] text-brand hover:bg-brand/5"
                          onClick={() => {
                            setSketchEntities(sketch.entities.filter((x) => x.id !== e.id));
                            setSketchSel(null);
                          }}
                        >
                          Smazat entitu
                        </button>
                      </>
                    ) : null;
                  })()}
              </div>
              {active && (
                <div className="flex gap-2 border-t border-[#d5dbe2] p-3">
                  <button type="button" className="flex flex-1 items-center justify-center gap-1.5 rounded bg-[#16a34a] py-2 text-[12.5px] font-semibold text-white hover:bg-[#15803d]" onClick={okEdit}>
                    <CadIcon name="check" className="h-4 w-4" /> OK
                  </button>
                  <button type="button" className="rounded border border-[#cfd6de] px-3 text-[12.5px] hover:bg-[#f3f6f9]" onClick={cancelEdit}>
                    Storno
                  </button>
                  <button type="button" className="rounded border border-[#cfd6de] px-2 text-brand hover:bg-brand/5" title="Smazat prvek" onClick={() => removeFeature(active.id)}>
                    <CadIcon name="trash" className="h-4 w-4" />
                  </button>
                </div>
              )}
            </aside>
          )}
        </div>

        {/* Řádek příkazů / stav */}
        <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-[#c9d1da] bg-[#eef2f6] px-3 text-[11.5px] text-[#3c4856]">
          <span className="font-semibold text-brand">»</span>
          <span className="min-w-0 flex-1 truncate">{prompt}</span>
          {cursor && !sketch && <span className="hidden font-mono text-[10.5px] text-[#5b6776] md:inline">X {fmtNum(cursor[0], 2)} · Y {fmtNum(cursor[1], 2)} · Z {fmtNum(cursor[2], 2)}</span>}
          <span className="hidden font-mono text-[10.5px] text-[#5b6776] sm:inline">mm · {prefs.ortho ? "pravoúhlá" : "perspektiva"}</span>
          <span className="hidden text-[10.5px] text-[#5b6776] lg:inline">{prefs.mouse === "zw3d" ? "Otáčení: pravé tl. · Posun: prostřední" : prefs.mouse === "solidworks" ? "Otáčení: prostřední · Posun: Ctrl+prostřední" : "Otáčení: levé · Posun: pravé"}</span>
        </footer>

        {ctx && <ContextMenu x={ctx.x} y={ctx.y} entries={ctx.entries} close={() => setCtx(null)} />}

        {/* Hmotnostní vlastnosti */}
        {massOpen && m && (
          <Modal title="Hmotnostní vlastnosti" icon="mass" onClose={() => setMassOpen(false)}>
            <label className="mb-3 block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#6b7785]">Materiál</span>
              <select value={doc.material} onChange={(e) => commit({ ...doc, material: e.target.value })} className="w-full rounded border border-[#cfd6de] bg-white px-2 py-1.5 text-[13px]">
                {MATERIALS.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label} ({x.density} g/cm³)
                  </option>
                ))}
              </select>
            </label>
            <Row k="Hmotnost" v={`${fmtNum(massKg(m.volume, mat.density), 4)} kg`} strong />
            <Row k="Objem" v={`${fmtNum(m.volume, 2)} mm³ (${fmtNum(m.volume / 1000, 3)} cm³)`} />
            <Row k="Povrch" v={`${fmtNum(m.area, 2)} mm² (${fmtNum(m.area / 100, 2)} cm²)`} />
            <Row k="Hustota" v={`${mat.density} g/cm³`} />
            <Row k="Rozměry (X × Y × Z)" v={`${fmtNum(m.bbox[1][0] - m.bbox[0][0], 3)} × ${fmtNum(m.bbox[1][1] - m.bbox[0][1], 3)} × ${fmtNum(m.bbox[1][2] - m.bbox[0][2], 3)} mm`} />
            <Row k="Min. bod" v={m.bbox[0].map((v) => fmtNum(v, 3)).join(" ; ")} />
            <Row k="Max. bod" v={m.bbox[1].map((v) => fmtNum(v, 3)).join(" ; ")} />
            <Row k="Topologie" v={`${m.faces} ploch · ${m.edges} hran`} />
          </Modal>
        )}

        {bomOpen && (
          <Modal title={`Kusovník – ${doc.name}`} icon="table" onClose={() => setBomOpen(false)}>
            <BomTable
              rows={bom}
              onCsv={() => download(`${safeName(doc.name)}_kusovnik.csv`, bomCsv(bom), "text/csv;charset=utf-8")}
              onDrawing={() => {
                setBomOpen(false);
                setDrawingOpen(true);
              }}
            />
          </Modal>
        )}
        {moldOpen && (
          <Modal title="Rám vstřikovací formy" icon="layers" onClose={() => setMoldOpen(false)}>
            <MoldWizard
              onCreate={(p) => {
                setMoldOpen(false);
                commit(moldBase(p, `Rám formy ${p.width}×${p.length}`));
                setAsmSel(null);
                setParentAsm(null);
                setActiveId(null);
                setSketchId(null);
                setTab("asm");
                flash("Stavím rám formy…");
                setTimeout(() => vp.current?.setView("iso"), 2500);
              }}
            />
          </Modal>
        )}
        {notice && (
          <Modal title={notice.title} icon="info" onClose={() => setNotice(null)}>
            <div className="whitespace-pre-line text-[13px] leading-relaxed text-[#26303b]">{notice.body}</div>
          </Modal>
        )}

        {drawingOpen && (isAsm || result?.metrics) && (
          <DrawingWorkspace
            doc={doc}
            massKg={isAsm ? bom.reduce((sum, r) => sum + (r.massKg ?? 0) * r.qty, 0) : massKg(result!.metrics!.volume, mat.density)}
            materialLabel={isAsm ? "dle kusovníku" : mat.label}
            bom={isAsm ? bom.map((r) => ({ pos: r.pos, name: r.name, number: r.number, qty: r.qty, material: r.material, massKg: r.massKg })) : undefined}
            onClose={() => setDrawingOpen(false)}
          />
        )}
      </div>
    </ParamContext.Provider>
  );
}

const HELP = `Myš (lze přepnout na kartě Zobrazení → Ovládání myši):
• ZW3D: pravé tlačítko táhnout = otáčení, prostřední = posun, kolečko = zoom k kurzoru, pravý klik = nabídka
• SolidWorks: prostřední = otáčení, Ctrl+prostřední = posun
• Touchpad: levé = otáčení, pravé = posun

Klávesy:
0 izometrie · 1 přední · 2 horní · 3 pravý · 4 zadní · 5 spodní · 6 levý
F přizpůsobit · P pravoúhlá/perspektiva · M měření · X řez
E vysunutí · H díra · Enter = OK · Esc = Storno · Delete = smazat prvek
Ctrl+Z / Ctrl+Y zpět / znovu · Ctrl+S uložit · Ctrl+O otevřít

Skica: V výběr · L úsečka · R obdélník · C kružnice · A oblouk · P mnohoúhelník · S drážka

Parametry: do pole lze psát výrazy (25/2) nebo vazby na proměnné (=d1*2).`;

function statusOf(result: BuildResult | null, id: string) {
  return result?.status.find((s) => s.id === id);
}

// ---------- drobné komponenty ----------

function QBtn({ icon, title, onClick, disabled }: { icon: CadIconName; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled} className="rounded p-1.5 text-white/75 hover:bg-white/10 hover:text-white disabled:opacity-30">
      <CadIcon name={icon} className="h-4 w-4" />
    </button>
  );
}

function Chip({ children, warn, dark }: { children: React.ReactNode; warn?: boolean; dark?: boolean }) {
  return <span className={cn("rounded border px-2 py-0.5 backdrop-blur", warn ? "border-brand/40 bg-brand/15 text-brand-600" : dark ? "border-white/15 bg-black/30" : "border-[#c9d1da] bg-white/85")}>{children}</span>;
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[#edf1f5] py-1 text-[12px] last:border-0">
      <span className="text-[#6b7785]">{k}</span>
      <span className={cn("text-right font-mono", strong ? "text-[14px] font-bold text-[#0b1f33]" : "text-[#26303b]")}>{v}</span>
    </div>
  );
}

function FloatPanel({ title, icon, onClose, children, className }: { title: string; icon: CadIconName; onClose: () => void; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("absolute left-3 top-3 z-20 w-[260px] rounded-md border border-[#cfd6de] bg-white/95 shadow-xl backdrop-blur", className)}>
      <div className="flex items-center gap-2 border-b border-[#e3e8ee] px-3 py-1.5">
        <CadIcon name={icon} tone="tool" className="h-4 w-4" />
        <p className="flex-1 text-[12.5px] font-semibold">{title}</p>
        <button type="button" onClick={onClose} className="rounded p-0.5 text-[#6b7785] hover:bg-[#eef2f6]" aria-label="Zavřít">
          <CadIcon name="x" className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function Modal({ title, icon, onClose, children }: { title: string; icon: CadIconName; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-[#0b1220]/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg border border-[#cfd6de] bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 rounded-t-lg border-b border-[#e3e8ee] bg-gradient-to-b from-[#f7f9fb] to-[#eef2f6] px-4 py-2.5">
          <CadIcon name={icon} tone="tool" className="h-5 w-5" />
          <p className="flex-1 text-[13.5px] font-semibold">{title}</p>
          <button type="button" onClick={onClose} className="rounded p-1 text-[#6b7785] hover:bg-[#e3e9f0]" aria-label="Zavřít">
            <CadIcon name="x" className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
